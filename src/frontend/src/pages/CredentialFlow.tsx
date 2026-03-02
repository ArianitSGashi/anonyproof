import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import {
  Mail,
  Shield,
  ArrowRight,
  CheckCircle,
  Clock,
} from "lucide-react";
import type {
  GroupResponse,
  BlindSignaturePublicParams,
  BlindCredentialRequestResponse,
} from "@repo/shared";
import { api } from "../lib/api";
import { ApiRequestError } from "../lib/api";
import {
  PageHeader,
  Card,
  Button,
  Input,
  Badge,
  Spinner,
} from "../components/ui";

type Step = "request" | "pending" | "register";

export function CredentialFlow() {
  const [groups, setGroups] = useState<GroupResponse[]>([]);
  const [publicKey, setPublicKey] = useState<BlindSignaturePublicParams | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<Step>("request");
  const [requestId, setRequestId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [groupsRes, pkRes] = await Promise.all([
          api.get<GroupResponse[]>("/groups"),
          api.get<BlindSignaturePublicParams>("/credentials/public-key"),
        ]);
        setGroups(groupsRes);
        setPublicKey(pkRes);
      } catch {
        // handled silently
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader
        title="Request Credential"
        description="Get verified as a university student using blind signatures — privacy-preserving by design."
      />

      {/* Stepper */}
      <div className="mb-8 flex items-center gap-3">
        {(["request", "pending", "register"] as const).map((s, i) => {
          const labels = ["Submit Request", "Await Approval", "Register"];
          const isCurrent = s === step;
          const isDone =
            (s === "request" && (step === "pending" || step === "register")) ||
            (s === "pending" && step === "register");

          return (
            <div key={s} className="flex items-center gap-3 flex-1">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold flex-shrink-0 ${
                  isDone
                    ? "bg-emerald-100 text-emerald-700"
                    : isCurrent
                      ? "bg-primary-600 text-white"
                      : "bg-slate-100 text-slate-400"
                }`}
              >
                {isDone ? <CheckCircle className="h-4 w-4" /> : i + 1}
              </div>
              <span
                className={`text-sm font-medium ${
                  isCurrent
                    ? "text-slate-900"
                    : isDone
                      ? "text-emerald-700"
                      : "text-slate-400"
                }`}
              >
                {labels[i]}
              </span>
              {i < 2 && (
                <div className="flex-1 h-px bg-slate-200" />
              )}
            </div>
          );
        })}
      </div>

      {/* Step content */}
      {step === "request" && (
        <RequestStep
          groups={groups}
          publicKey={publicKey}
          onSubmitted={(id) => {
            setRequestId(id);
            setStep("pending");
          }}
        />
      )}
      {step === "pending" && (
        <PendingStep requestId={requestId} onContinue={() => setStep("register")} />
      )}
      {step === "register" && <RegisterStep />}
    </div>
  );
}

function RequestStep({
  groups,
  publicKey: _publicKey,
  onSubmitted,
}: {
  groups: GroupResponse[];
  publicKey: BlindSignaturePublicParams | null;
  onSubmitted: (requestId: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [selectedGroup, setSelectedGroup] = useState(
    groups[0]?.groupId ?? "",
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      // Generate a blinded commitment (simulated for UI)
      const blindBytes = new Uint8Array(128);
      crypto.getRandomValues(blindBytes);
      const blindedCommitment = Array.from(blindBytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      const res = await api.post<BlindCredentialRequestResponse>(
        "/credentials/request",
        {
          universityEmail: email,
          groupId: selectedGroup,
          blindedCommitment,
        },
      );
      onSubmitted(res.requestId);
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.message
          : "Failed to submit request",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <div className="flex gap-4 mb-6">
        <div className="rounded-xl bg-primary-50 p-3 text-primary-600 self-start">
          <Mail className="h-6 w-6" />
        </div>
        <div>
          <h3 className="font-semibold text-slate-900">
            Step 1: Submit Your Request
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            Provide your university email and select a group. The system creates
            a blinded commitment — the admin can verify your student status but
            cannot link your email to your anonymous identity.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <Input
          label="University Email"
          type="email"
          placeholder="your.name@uni-pr.edu"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700">
            University Group
          </label>
          <select
            value={selectedGroup}
            onChange={(e) => setSelectedGroup(e.target.value)}
            className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:outline-2 focus:outline-offset-0 focus:outline-primary-500 focus:border-primary-500 bg-white cursor-pointer"
            required
          >
            {groups.map((g) => (
              <option key={g.groupId} value={g.groupId}>
                {g.name}
              </option>
            ))}
          </select>
        </div>

        <div className="rounded-lg bg-slate-50 border border-slate-100 px-4 py-3 text-xs text-slate-500">
          <strong>Privacy note:</strong> A blinded commitment is automatically
          generated. The admin will see your email (to verify enrollment) but
          the blinded value cannot be linked to your real identity commitment.
        </div>

        <Button type="submit" loading={loading} className="w-full" size="lg">
          Submit Credential Request
          <ArrowRight className="h-4 w-4" />
        </Button>
      </form>
    </Card>
  );
}

function PendingStep({
  requestId,
  onContinue,
}: {
  requestId: string | null;
  onContinue: () => void;
}) {
  return (
    <Card>
      <div className="flex flex-col items-center text-center py-8">
        <div className="rounded-full bg-amber-50 p-4 text-amber-600 mb-4">
          <Clock className="h-10 w-10" />
        </div>
        <h3 className="text-lg font-semibold text-slate-900">
          Awaiting Admin Approval
        </h3>
        <p className="mt-2 text-sm text-slate-500 max-w-md">
          Your credential request has been submitted. An admin will verify your
          university email and issue a blind signature. This may be batched with
          other requests for timing anonymity.
        </p>
        {requestId && (
          <div className="mt-4 flex items-center gap-2">
            <Badge variant="info">Request ID</Badge>
            <code className="text-xs text-slate-500 font-mono">
              {requestId.slice(0, 16)}...
            </code>
          </div>
        )}
        <Button className="mt-6" variant="secondary" onClick={onContinue}>
          I have my blind signature — Continue
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  );
}

function RegisterStep() {
  return (
    <Card>
      <div className="flex gap-4 mb-6">
        <div className="rounded-xl bg-emerald-50 p-3 text-emerald-600 self-start">
          <Shield className="h-6 w-6" />
        </div>
        <div>
          <h3 className="font-semibold text-slate-900">
            Step 3: Register Your Commitment
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            Unblind the signature you received and submit your real identity
            commitment. The server verifies the signature is valid but cannot
            link it back to your email — unlinkability is cryptographically
            guaranteed.
          </p>
        </div>
      </div>

      <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-4 py-3 text-sm text-emerald-800">
        <strong>Integration note:</strong> This step requires the Semaphore
        client library to unblind the RSA signature and submit the real
        commitment. The full client-side ZKP integration connects here.
      </div>

      <div className="mt-6">
        <Button disabled size="lg" className="w-full">
          Register Commitment (ZKP integration pending)
        </Button>
      </div>

      <p className="mt-4 text-xs text-slate-400 text-center">
        Once registered, you can{" "}
        <Link to="/feed" className="text-primary-600 hover:underline">
          browse the feed
        </Link>{" "}
        and start posting anonymously.
      </p>
    </Card>
  );
}
