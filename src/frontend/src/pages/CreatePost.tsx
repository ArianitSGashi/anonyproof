import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Send, ArrowLeft } from "lucide-react";
import type { GroupResponse } from "@repo/shared";
import { api } from "../lib/api";
import {
  PageHeader,
  Card,
  Button,
  Textarea,
  Spinner,
} from "../components/ui";

export function CreatePost() {
  const [groups, setGroups] = useState<GroupResponse[]>([]);
  const [selectedGroup, setSelectedGroup] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const data = await api.get<GroupResponse[]>("/groups");
        setGroups(data);
        if (data.length > 0) {
          setSelectedGroup(data[0]!.groupId);
        }
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
      <Link
        to="/feed"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-primary-600"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Feed
      </Link>

      <PageHeader
        title="Create Anonymous Post"
        description="Your post will be verified with a zero-knowledge proof — no identity revealed."
      />

      <Card>
        <div className="space-y-5">
          {/* Group selector */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-700">
              Select Group
            </label>
            <select
              value={selectedGroup}
              onChange={(e) => setSelectedGroup(e.target.value)}
              className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:outline-2 focus:outline-offset-0 focus:outline-primary-500 focus:border-primary-500 bg-white cursor-pointer"
            >
              {groups.map((g) => (
                <option key={g.groupId} value={g.groupId}>
                  {g.name} ({g.memberCount} members)
                </option>
              ))}
            </select>
          </div>

          {/* Content */}
          <Textarea
            label="Content"
            placeholder="What's on your mind? Share your thoughts anonymously..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="!min-h-[150px]"
          />

          {/* Info */}
          <div className="rounded-lg bg-primary-50 border border-primary-100 px-4 py-3">
            <p className="text-sm text-primary-800">
              <strong>How it works:</strong> When you submit, your browser
              generates a Semaphore zero-knowledge proof that you are a member
              of the selected group — without revealing which member you are.
              The server verifies the proof and publishes the post.
            </p>
          </div>

          <div className="flex justify-end">
            <Button disabled={!content.trim() || !selectedGroup} size="lg">
              <Send className="h-4 w-4" />
              Post Anonymously
            </Button>
          </div>

          <p className="text-xs text-slate-400 text-center">
            Requires an active Semaphore identity and group membership.{" "}
            <Link
              to="/identity"
              className="text-primary-600 hover:underline"
            >
              Set up identity
            </Link>
          </p>
        </div>
      </Card>
    </div>
  );
}
