import { useEffect, useState } from "react";
import { ShieldCheck, CheckCircle, XCircle } from "lucide-react";
import type { ModerationQueueItem, PaginatedResponse } from "@repo/shared";
import { api } from "../../lib/api";
import { ApiRequestError } from "../../lib/api";
import {
  PageHeader,
  Card,
  Button,
  Badge,
  Spinner,
  EmptyState,
  Textarea,
} from "../../components/ui";

export function AdminModeration() {
  const [items, setItems] = useState<ModerationQueueItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  async function loadQueue(p = 1) {
    setLoading(true);
    try {
      const res = await api.get<PaginatedResponse<ModerationQueueItem>>(
        `/admin/moderation/queue?page=${p}&limit=10`,
      );
      setItems(res.data);
      setTotal(res.pagination.total);
      setTotalPages(res.pagination.totalPages);
      setPage(p);
    } catch {
      // handled silently
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadQueue();
  }, []);

  return (
    <div>
      <PageHeader
        title="Moderation Queue"
        description={`${total} items in the queue`}
      />

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Spinner className="h-8 w-8" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck className="h-12 w-12" />}
          title="Queue is empty"
          description="No content is awaiting moderation right now."
        />
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <ModerationCard
              key={item.id}
              item={item}
              onDecided={() => void loadQueue(page)}
            />
          ))}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-4">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => void loadQueue(page - 1)}
              >
                Previous
              </Button>
              <span className="text-sm text-slate-500">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => void loadQueue(page + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ModerationCard({
  item,
  onDecided,
}: {
  item: ModerationQueueItem;
  onDecided: () => void;
}) {
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState("");

  function statusVariant(s: string) {
    switch (s) {
      case "approved":
        return "success" as const;
      case "rejected":
        return "danger" as const;
      case "escalated":
        return "warning" as const;
      default:
        return "default" as const;
    }
  }

  async function decide(decision: "approved" | "rejected") {
    setError("");
    setLoading(decision);
    try {
      await api.post(`/admin/moderation/${item.id}/decision`, {
        decision,
        ...(notes ? { notes } : {}),
      });
      onDecided();
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Decision failed",
      );
    } finally {
      setLoading(null);
    }
  }

  const isPending = item.status === "pending";

  return (
    <Card>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <Badge variant={statusVariant(item.status)}>{item.status}</Badge>
          <Badge variant="default">{item.contentType}</Badge>
          {item.toxicityScore > 0 && (
            <Badge variant={item.toxicityScore > 0.7 ? "danger" : "warning"}>
              Toxicity: {(item.toxicityScore * 100).toFixed(0)}%
            </Badge>
          )}
        </div>
        <span className="text-xs text-slate-400">
          {new Date(item.createdAt).toLocaleString()}
        </span>
      </div>

      <div className="rounded-lg bg-slate-50 border border-slate-100 px-4 py-3 text-sm text-slate-700 whitespace-pre-wrap">
        {item.content}
      </div>

      {error && (
        <div className="mt-3 rounded-lg bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {isPending && (
        <div className="mt-4 space-y-3">
          <Textarea
            placeholder="Optional notes about the decision..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="!min-h-[60px]"
          />
          <div className="flex gap-3 justify-end">
            <Button
              variant="danger"
              size="sm"
              loading={loading === "rejected"}
              onClick={() => void decide("rejected")}
            >
              <XCircle className="h-4 w-4" />
              Reject
            </Button>
            <Button
              size="sm"
              loading={loading === "approved"}
              onClick={() => void decide("approved")}
            >
              <CheckCircle className="h-4 w-4" />
              Approve
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
