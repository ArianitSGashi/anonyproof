import { useEffect, useState } from "react";
import { ClipboardList, Search } from "lucide-react";
import type { AuditLogEntry, PaginatedResponse } from "@repo/shared";
import { api } from "../../lib/api";
import {
  PageHeader,
  Card,
  Button,
  Badge,
  Spinner,
  EmptyState,
  Input,
} from "../../components/ui";

export function AdminAuditLog() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState("");

  async function loadEntries(p = 1, action = "") {
    setLoading(true);
    try {
      let url = `/admin/audit-log?page=${p}&limit=15`;
      if (action) url += `&actionType=${encodeURIComponent(action)}`;
      const res = await api.get<PaginatedResponse<AuditLogEntry>>(url);
      setEntries(res.data);
      setPage(res.pagination.page);
      setTotalPages(res.pagination.totalPages);
      setTotal(res.pagination.total);
    } catch {
      // handled silently
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadEntries();
  }, []);

  function handleSearch() {
    void loadEntries(1, actionFilter);
  }

  function actionBadge(action: string) {
    if (action.includes("created") || action.includes("approved"))
      return "success" as const;
    if (action.includes("rejected") || action.includes("deleted"))
      return "danger" as const;
    if (action.includes("login")) return "info" as const;
    return "default" as const;
  }

  return (
    <div>
      <PageHeader
        title="Audit Log"
        description={`${total} recorded admin actions`}
      />

      {/* Filter */}
      <div className="mb-6 flex gap-3">
        <Input
          placeholder="Filter by action type (e.g. admin_created)"
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="max-w-sm"
        />
        <Button variant="secondary" onClick={handleSearch}>
          <Search className="h-4 w-4" />
          Filter
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Spinner className="h-8 w-8" />
        </div>
      ) : entries.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="h-12 w-12" />}
          title="No audit entries"
          description="Admin actions will appear here."
        />
      ) : (
        <>
          <Card padding={false}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                    <th className="px-6 py-3">Action</th>
                    <th className="px-6 py-3">Target</th>
                    <th className="px-6 py-3">Details</th>
                    <th className="px-6 py-3">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {entries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-slate-50/50">
                      <td className="px-6 py-4">
                        <Badge variant={actionBadge(entry.actionType)}>
                          {entry.actionType}
                        </Badge>
                      </td>
                      <td className="px-6 py-4 text-slate-600">
                        {entry.targetType ?? "—"}
                        {entry.targetId && (
                          <span className="ml-1 text-xs text-slate-400 font-mono">
                            {entry.targetId.slice(0, 8)}...
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-slate-500 max-w-xs truncate">
                        {entry.details
                          ? JSON.stringify(entry.details).slice(0, 60)
                          : "—"}
                      </td>
                      <td className="px-6 py-4 text-slate-400 whitespace-nowrap">
                        {new Date(entry.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-6">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => void loadEntries(page - 1, actionFilter)}
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
                onClick={() => void loadEntries(page + 1, actionFilter)}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
