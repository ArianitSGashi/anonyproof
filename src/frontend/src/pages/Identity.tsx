import { useState, useCallback } from "react";
import {
  Fingerprint,
  Copy,
  Check,
  RefreshCw,
  ShieldAlert,
  Download,
  Eye,
  EyeOff,
} from "lucide-react";
import {
  PageHeader,
  Card,
  Button,
  Badge,
} from "../components/ui";

const IDENTITY_KEY = "anonyproof_identity";

interface StoredIdentity {
  privateKey: string;
  commitment: string;
  createdAt: string;
}

export function Identity() {
  const [identity, setIdentity] = useState<StoredIdentity | null>(() => {
    try {
      const raw = localStorage.getItem(IDENTITY_KEY);
      return raw ? (JSON.parse(raw) as StoredIdentity) : null;
    } catch {
      return null;
    }
  });
  const [showSecret, setShowSecret] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const generateIdentity = useCallback(() => {
    // Generate a random 32-byte hex string as the private key
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const privateKey = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // The commitment would normally be poseidon(privateKey)
    // For the UI, we simulate a hex commitment
    const commitBytes = new Uint8Array(32);
    crypto.getRandomValues(commitBytes);
    const commitment = Array.from(commitBytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const newIdentity: StoredIdentity = {
      privateKey,
      commitment,
      createdAt: new Date().toISOString(),
    };

    localStorage.setItem(IDENTITY_KEY, JSON.stringify(newIdentity));
    setIdentity(newIdentity);
    setShowSecret(false);
  }, []);

  async function copyToClipboard(text: string, label: string) {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  }

  function downloadIdentity() {
    if (!identity) return;
    const blob = new Blob([JSON.stringify(identity, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "anonyproof-identity.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader
        title="Your Anonymous Identity"
        description="Generate and manage your Semaphore identity for zero-knowledge proofs."
      />

      {/* Explainer */}
      <Card className="mb-6">
        <div className="flex gap-4">
          <div className="rounded-xl bg-primary-50 p-3 text-primary-600 self-start">
            <Fingerprint className="h-6 w-6" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-900">
              What is a Semaphore Identity?
            </h3>
            <p className="mt-1 text-sm text-slate-500 leading-relaxed">
              A Semaphore identity consists of a <strong>private key</strong>{" "}
              (kept secret) and a <strong>commitment</strong> (public hash).
              You use the private key to generate zero-knowledge proofs that
              verify group membership without revealing who you are. The
              commitment is registered in a Merkle tree when you join a group.
            </p>
          </div>
        </div>
      </Card>

      {identity ? (
        <div className="space-y-4">
          {/* Status */}
          <Card>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-emerald-50 p-2 text-emerald-600">
                  <Check className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900">
                    Identity Active
                  </h3>
                  <p className="text-xs text-slate-400">
                    Created{" "}
                    {new Date(identity.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <Badge variant="success">Active</Badge>
            </div>

            {/* Commitment (public) */}
            <div className="mb-3">
              <label className="mb-1 block text-xs font-medium text-slate-500 uppercase tracking-wider">
                Identity Commitment (Public)
              </label>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-700 font-mono truncate">
                  {identity.commitment}
                </code>
                <button
                  onClick={() =>
                    void copyToClipboard(identity.commitment, "commitment")
                  }
                  className="rounded-lg border border-slate-200 p-2 hover:bg-slate-50 text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  {copied === "commitment" ? (
                    <Check className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Private key (secret) */}
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500 uppercase tracking-wider">
                Private Key (Secret)
              </label>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-700 font-mono truncate">
                  {showSecret
                    ? identity.privateKey
                    : "•".repeat(64)}
                </code>
                <button
                  onClick={() => setShowSecret(!showSecret)}
                  className="rounded-lg border border-slate-200 p-2 hover:bg-slate-50 text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  {showSecret ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          </Card>

          {/* Warning */}
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
            <div className="flex gap-2">
              <ShieldAlert className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-800">
                  Keep your private key safe
                </p>
                <p className="mt-0.5 text-xs text-amber-600">
                  Your private key is stored in this browser only. If you clear
                  browser data, you will lose this identity. Download a backup.
                </p>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={downloadIdentity}>
              <Download className="h-4 w-4" />
              Download Backup
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                if (confirm("Generate a new identity? Your current one will be replaced.")) {
                  generateIdentity();
                }
              }}
            >
              <RefreshCw className="h-4 w-4" />
              Regenerate
            </Button>
          </div>
        </div>
      ) : (
        /* No identity — generate prompt */
        <Card>
          <div className="flex flex-col items-center text-center py-8">
            <div className="rounded-full bg-primary-50 p-4 text-primary-600 mb-4">
              <Fingerprint className="h-10 w-10" />
            </div>
            <h3 className="text-lg font-semibold text-slate-900">
              No identity found
            </h3>
            <p className="mt-1 text-sm text-slate-500 max-w-md">
              Generate a Semaphore identity to start participating in anonymous
              discussions. Your private key stays in your browser.
            </p>
            <Button
              className="mt-6"
              size="lg"
              onClick={generateIdentity}
            >
              <Fingerprint className="h-5 w-5" />
              Generate Identity
            </Button>
          </div>
        </Card>
      )}

      {/* Next steps */}
      {identity && (
        <Card className="mt-6">
          <h3 className="font-semibold text-slate-900 mb-3">Next Steps</h3>
          <ol className="space-y-2 text-sm text-slate-600">
            <li className="flex items-start gap-3">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-100 text-xs font-bold text-primary-700 flex-shrink-0">
                1
              </span>
              <span>
                <a
                  href="/credentials"
                  className="text-primary-600 hover:underline font-medium"
                >
                  Request a credential
                </a>{" "}
                — submit your university email with a blinded commitment for
                admin verification.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-100 text-xs font-bold text-primary-700 flex-shrink-0">
                2
              </span>
              <span>
                Once approved, register your commitment to join the Semaphore
                group.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-100 text-xs font-bold text-primary-700 flex-shrink-0">
                3
              </span>
              <span>
                Start posting, commenting, and voting — all verified by
                zero-knowledge proofs.
              </span>
            </li>
          </ol>
        </Card>
      )}
    </div>
  );
}
