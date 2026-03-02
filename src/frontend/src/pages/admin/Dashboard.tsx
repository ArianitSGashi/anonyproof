import { useEffect, useState } from "react";
import { Link } from "react-router";
import {
  Users,
  ShieldCheck,
  FileKey2,
  ClipboardList,
  ArrowRight,
} from "lucide-react";
import type { GroupResponse, PaginatedResponse, ModerationQueueItem } from "@repo/shared";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { PageHeader, StatCard, Card, Spinner, Badge } from "../../components/ui";

export function AdminDashboard() {
  const { admin } = useAuth();
  const [groups, setGroups] = useState<GroupResponse[]>([]);
  const [moderationCount, setModerationCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadStats() {
      try {
        const [groupsRes, modRes] = await Promise.all([
          api.get<GroupResponse[]>("/groups"),
          api.get<PaginatedResponse<ModerationQueueItem>>(
            "/admin/moderation/queue?limit=1",
          ),
        ]);
        setGroups(groupsRes);
        setModerationCount(modRes.pagination.total);
      } catch {
        // Stats are best-effort
      } finally {
        setLoading(false);
      }
    }
    void loadStats();
  }, []);

  const totalMembers = groups.reduce((sum, g) => sum + g.memberCount, 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={`Welcome back, ${admin?.username ?? "Admin"}`}
        description="Here's an overview of your AnonyProof instance."
      />

      {/* Stats Grid */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        <StatCard
          label="Groups"
          value={groups.length}
          icon={<Users className="h-5 w-5" />}
        />
        <StatCard
          label="Total Members"
          value={totalMembers}
          icon={<Users className="h-5 w-5" />}
        />
        <StatCard
          label="Moderation Queue"
          value={moderationCount}
          icon={<ShieldCheck className="h-5 w-5" />}
        />
        <StatCard
          label="Admin Role"
          value={admin?.role ?? "—"}
          icon={<FileKey2 className="h-5 w-5" />}
        />
      </div>

      {/* Quick Links */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <QuickLink
          to="/admin/groups"
          icon={<Users className="h-6 w-6" />}
          title="Manage Groups"
          description="Create and manage university Semaphore groups"
        />
        <QuickLink
          to="/admin/moderation"
          icon={<ShieldCheck className="h-6 w-6" />}
          title="Moderation Queue"
          description={`${moderationCount} items awaiting review`}
        />
        <QuickLink
          to="/admin/credentials"
          icon={<FileKey2 className="h-6 w-6" />}
          title="Credential Requests"
          description="Approve or reject student credential requests"
        />
        <QuickLink
          to="/admin/audit-log"
          icon={<ClipboardList className="h-6 w-6" />}
          title="Audit Log"
          description="View admin action history"
        />
      </div>

      {/* Groups Overview */}
      {groups.length > 0 && (
        <div className="mt-8">
          <h3 className="mb-4 text-lg font-semibold text-slate-900">Groups</h3>
          <Card padding={false}>
            <div className="divide-y divide-slate-100">
              {groups.map((g) => (
                <div
                  key={g.id}
                  className="flex items-center justify-between px-6 py-4"
                >
                  <div>
                    <p className="font-medium text-slate-900">{g.name}</p>
                    <p className="text-sm text-slate-500">
                      {g.description ?? "No description"}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant="info">{g.memberCount} members</Badge>
                    <Badge variant="default">depth {g.depth}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function QuickLink({
  to,
  icon,
  title,
  description,
}: {
  to: string;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Link
      to={to}
      className="group flex items-start gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:border-primary-200 hover:shadow-md"
    >
      <div className="rounded-lg bg-primary-50 p-2.5 text-primary-600 group-hover:bg-primary-100">
        {icon}
      </div>
      <div className="flex-1">
        <h3 className="font-semibold text-slate-900">{title}</h3>
        <p className="mt-0.5 text-sm text-slate-500">{description}</p>
      </div>
      <ArrowRight className="mt-1 h-4 w-4 text-slate-300 group-hover:text-primary-500" />
    </Link>
  );
}
