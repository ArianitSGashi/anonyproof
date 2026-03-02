import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
  MessageSquare,
  ThumbsUp,
  ThumbsDown,
  Plus,
  Clock,
  Users,
} from "lucide-react";
import type { PostResponse, GroupResponse } from "@repo/shared";
import { api } from "../lib/api";
import {
  Card,
  Button,
  Badge,
  Spinner,
  EmptyState,
  PageHeader,
} from "../components/ui";

export function Feed() {
  const [searchParams, setSearchParams] = useSearchParams();
  const groupId = searchParams.get("group");
  const [posts, setPosts] = useState<PostResponse[]>([]);
  const [groups, setGroups] = useState<GroupResponse[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [postsRes, groupsRes] = await Promise.all([
          groupId
            ? api.get<PostResponse[]>(`/posts?groupId=${groupId}`)
            : api.get<PostResponse[]>("/posts"),
          api.get<GroupResponse[]>("/groups"),
        ]);
        setPosts(postsRes);
        setGroups(groupsRes);
      } catch {
        // handled silently
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [groupId]);

  const selectedGroup = groups.find((g) => g.groupId === groupId);

  return (
    <div>
      <PageHeader
        title={selectedGroup ? selectedGroup.name : "Anonymous Feed"}
        description={
          selectedGroup
            ? `${selectedGroup.memberCount} members`
            : "Browse anonymous posts from all groups"
        }
        action={
          <Link to="/create">
            <Button>
              <Plus className="h-4 w-4" />
              New Post
            </Button>
          </Link>
        }
      />

      {/* Group filter chips */}
      {groups.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          <button
            onClick={() => setSearchParams({})}
            className={`rounded-full px-4 py-1.5 text-sm font-medium cursor-pointer ${
              !groupId
                ? "bg-primary-600 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            All
          </button>
          {groups.map((g) => (
            <button
              key={g.groupId}
              onClick={() => setSearchParams({ group: g.groupId })}
              className={`rounded-full px-4 py-1.5 text-sm font-medium cursor-pointer ${
                groupId === g.groupId
                  ? "bg-primary-600 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {g.name}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Spinner className="h-8 w-8" />
        </div>
      ) : posts.length === 0 ? (
        <EmptyState
          icon={<MessageSquare className="h-12 w-12" />}
          title="No posts yet"
          description="Be the first to post anonymously in this group."
          action={
            <Link to="/create">
              <Button>
                <Plus className="h-4 w-4" /> Create Post
              </Button>
            </Link>
          }
        />
      ) : (
        <div className="space-y-4">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} groups={groups} />
          ))}
        </div>
      )}
    </div>
  );
}

function PostCard({
  post,
  groups,
}: {
  post: PostResponse;
  groups: GroupResponse[];
}) {
  const group = groups.find((g) => g.groupId === post.groupId);

  return (
    <Link to={`/post/${post.id}`} className="block">
      <Card className="hover:border-primary-200 hover:shadow-md">
        <div className="flex items-start gap-4">
          {/* Vote column */}
          <div className="flex flex-col items-center gap-1 min-w-[48px]">
            <ThumbsUp className="h-4 w-4 text-slate-400" />
            <span
              className={`text-sm font-bold ${
                post.voteScore > 0
                  ? "text-emerald-600"
                  : post.voteScore < 0
                    ? "text-red-500"
                    : "text-slate-400"
              }`}
            >
              {post.voteScore}
            </span>
            <ThumbsDown className="h-4 w-4 text-slate-400" />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <p className="text-slate-900 leading-relaxed line-clamp-3">
              {post.content}
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-400">
              {group && (
                <span className="flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  {group.name}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {new Date(post.createdAt).toLocaleDateString()}
              </span>
              {post.commentCount != null && post.commentCount > 0 && (
                <span className="flex items-center gap-1">
                  <MessageSquare className="h-3 w-3" />
                  {post.commentCount} comments
                </span>
              )}
              {post.moderationStatus !== "approved" && (
                <Badge
                  variant={
                    post.moderationStatus === "pending"
                      ? "warning"
                      : "danger"
                  }
                >
                  {post.moderationStatus}
                </Badge>
              )}
            </div>
          </div>
        </div>
      </Card>
    </Link>
  );
}
