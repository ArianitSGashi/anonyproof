import { useEffect, useState } from "react";
import { FileKey2, CheckCircle, XCircle, Layers } from "lucide-react";
import type {
  PendingCredentialRequest,
  BlindCredentialApprovalResponse,
} from "@repo/shared";
import { api } from "../../lib/api";
import { ApiRequestError } from "../../lib/api";
import {
  PageHeader,
  Card,
  Button,
  Badge,
  Spinner,
  EmptyState,
  Input,
} from "../../components/ui";

export function AdminCredentials() {
  const [requests, setRequests] = useState<PendingCredentialRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  async function loadRequests() {
    try {
      const data = await api.get<PendingCredentialRequest[]>(
        "/admin/credentials/requests",
      );
      setRequests(data);
    } catch {
      // handled silently
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRequests();
  }, []);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  const [batchLoading, setBatchLoading] = useState(false);
  const [batchError, setBatchError] = useState("");

  async function handleBatchApprove() {
    if (selected.size === 0) return;
    setBatchError("");
    setBatchLoading(true);
    try {
      await api.post<BlindCredentialApprovalResponse[]>(
        "/admin/credentials/batch-approve",
        { requestIds: Array.from(selected) },
      );
      setSelected(new Set());
      void loadRequests();
    } catch (err) {
      setBatchError(
        err instanceof ApiRequestError
          ? err.message
          : "Batch approval failed",
      );
    } finally {
      setBatchLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  const pendingRequests = requests.filter((r) => r.status === "pending");

  return (
    <div>
      <PageHeader
        title="Credential Requests"
        description={`${pendingRequests.length} pending requests`}
        action={
          pendingRequests.length > 0 ? (
            <Button
              onClick={() => void handleBatchApprove()}
              loading={batchLoading}
              disabled={selected.size === 0}
            >
              <Layers className="h-4 w-4" />
              Batch Approve ({selected.size})
            </Button>
          ) : undefined
        }
      />

      {batchError && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {batchError}
        </div>
      )}

      <p className="mb-4 text-sm text-slate-500">
        Batch approval issues blind signatures simultaneously for timing
        anonymity — the approval timestamps cannot be correlated to individual
        students.
      </p>

      {pendingRequests.length === 0 ? (
        <EmptyState
          icon={<FileKey2 className="h-12 w-12" />}
          title="No pending requests"
          description="All credential requests have been processed."
        />
      ) : (
        <div className="space-y-3">
          {pendingRequests.map((req) => (
            <CredentialCard
              key={req.id}
              request={req}
              isSelected={selected.has(req.id)}
              onToggle={() => toggleSelect(req.id)}
              onDecided={() => void loadRequests()}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CredentialCard({
  request,
  isSelected,
  onToggle,
  onDecided,
}: {
  request: PendingCredentialRequest;
  isSelected: boolean;
  onToggle: () => void;
  onDecided: () => void;
}) {
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function handleApprove() {
    setError("");
    setLoading("approve");
    try {
      await api.post(`/admin/credentials/${request.id}/approve`);
      onDecided();
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Approval failed",
      );
    } finally {
      setLoading(null);
    }
  }

  async function handleReject() {
    if (!rejectReason.trim()) return;
    setError("");
    setLoading("reject");
    try {
      await api.post(`/admin/credentials/${request.id}/reject`, {
        reason: rejectReason,
      });
      onDecided();
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Rejection failed",
      );
    } finally {
      setLoading(null);
    }
  }

  return (
    <Card>
      <div className="flex items-start gap-4">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggle}
          className="mt-1 h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500 cursor-pointer"
        />
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-slate-900">
                {request.universityEmail}
              </p>
              <p className="mt-0.5 text-xs text-slate-400 font-mono truncate">
                Group: {request.groupId}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="warning">{request.status}</Badge>
              <span className="text-xs text-slate-400">
                {new Date(request.createdAt).toLocaleDateString()}
              </span>
            </div>
          </div>

          {error && (
            <div className="mt-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="mt-3 flex items-center gap-2">
            <Button
              size="sm"
              loading={loading === "approve"}
              onClick={() => void handleApprove()}
            >
              <CheckCircle className="h-3.5 w-3.5" />
              Approve
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => setShowReject(!showReject)}
            >
              <XCircle className="h-3.5 w-3.5" />
              Reject
            </Button>
          </div>

          {showReject && (
            <div className="mt-3 flex gap-2">
              <Input
                placeholder="Reason for rejection"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="flex-1"
              />
              <Button
                variant="danger"
                size="sm"
                loading={loading === "reject"}
                onClick={() => void handleReject()}
                disabled={!rejectReason.trim()}
              >
                Confirm
              </Button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
