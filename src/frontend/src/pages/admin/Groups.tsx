import { useEffect, useState, type FormEvent } from "react";
import { Plus, Users } from "lucide-react";
import type { GroupResponse, CreateGroupRequest } from "@repo/shared";
import { api } from "../../lib/api";
import { ApiRequestError } from "../../lib/api";
import {
  PageHeader,
  Card,
  Button,
  Input,
  Badge,
  Spinner,
  EmptyState,
} from "../../components/ui";

export function AdminGroups() {
  const [groups, setGroups] = useState<GroupResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  async function loadGroups() {
    try {
      const data = await api.get<GroupResponse[]>("/groups");
      setGroups(data);
    } catch {
      // handled silently
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadGroups();
  }, []);

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
        title="Groups"
        description="Manage Semaphore groups for university communities"
        action={
          <Button onClick={() => setShowForm(!showForm)}>
            <Plus className="h-4 w-4" />
            New Group
          </Button>
        }
      />

      {showForm && (
        <CreateGroupForm
          onCreated={() => {
            setShowForm(false);
            void loadGroups();
          }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {groups.length === 0 ? (
        <EmptyState
          icon={<Users className="h-12 w-12" />}
          title="No groups yet"
          description="Create your first Semaphore group to get started."
          action={
            <Button onClick={() => setShowForm(true)}>
              <Plus className="h-4 w-4" /> Create Group
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {groups.map((g) => (
            <Card key={g.id}>
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-slate-900">{g.name}</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    {g.description ?? "No description"}
                  </p>
                </div>
                <Badge variant="info">{g.memberCount} members</Badge>
              </div>
              <div className="mt-4 flex items-center gap-3 text-xs text-slate-400">
                <span>Depth: {g.depth}</span>
                <span>&middot;</span>
                <span>Max: {Math.pow(2, g.depth).toLocaleString()}</span>
                <span>&middot;</span>
                <span>Created {new Date(g.createdAt).toLocaleDateString()}</span>
              </div>
              <p className="mt-2 font-mono text-xs text-slate-400 truncate">
                ID: {g.groupId}
              </p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function CreateGroupForm({
  onCreated,
  onCancel,
}: {
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [depth, setDepth] = useState("20");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const body: CreateGroupRequest = {
        name,
        ...(description ? { description } : {}),
        depth: parseInt(depth, 10),
      };
      await api.post("/groups", body);
      onCreated();
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Failed to create group",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="mb-8">
      <h3 className="text-lg font-semibold text-slate-900 mb-4">
        Create New Group
      </h3>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
        <Input
          label="Group Name"
          placeholder="e.g. University of Prishtina"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <Input
          label="Description"
          placeholder="Optional description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Input
          label="Merkle Tree Depth"
          type="number"
          min={16}
          max={32}
          value={depth}
          onChange={(e) => setDepth(e.target.value)}
        />
        <p className="text-xs text-slate-400">
          Depth {depth} supports up to{" "}
          {Math.pow(2, parseInt(depth, 10) || 20).toLocaleString()} members
        </p>
        <div className="flex gap-3 justify-end">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" loading={loading}>
            Create Group
          </Button>
        </div>
      </form>
    </Card>
  );
}
