import { useEffect, useState } from "react";
import { useParams, Link } from "react-router";
import {
  ArrowLeft,
  ThumbsUp,
  ThumbsDown,
  MessageSquare,
  Clock,
  Send,
} from "lucide-react";
import type { PostResponse, CommentResponse } from "@repo/shared";
import { api } from "../lib/api";
import {
  Card,
  Button,
  Badge,
  Spinner,
  Textarea,
  EmptyState,
} from "../components/ui";

export function PostDetail() {
  const { id } = useParams();
  const [post, setPost] = useState<PostResponse | null>(null);
  const [comments, setComments] = useState<CommentResponse[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [postRes, commentsRes] = await Promise.all([
          api.get<PostResponse>(`/posts/${id}`),
          api.get<CommentResponse[]>(`/posts/${id}/comments`),
        ]);
        setPost(postRes);
        setComments(commentsRes);
      } catch {
        // handled silently
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  if (!post) {
    return (
      <EmptyState
        title="Post not found"
        description="This post may have been removed."
        action={
          <Link to="/feed">
            <Button variant="secondary">Back to Feed</Button>
          </Link>
        }
      />
    );
  }

  // Build comment tree
  const topLevel = comments.filter((c) => !c.parentCommentId);
  const childMap = new Map<string, CommentResponse[]>();
  for (const c of comments) {
    if (c.parentCommentId) {
      const existing = childMap.get(c.parentCommentId) ?? [];
      existing.push(c);
      childMap.set(c.parentCommentId, existing);
    }
  }

  return (
    <div>
      <Link
        to="/feed"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-primary-600"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Feed
      </Link>

      {/* Post */}
      <Card className="mb-8">
        <div className="flex items-start gap-4">
          {/* Votes */}
          <VoteWidget score={post.voteScore} />

          <div className="flex-1">
            <p className="text-slate-900 leading-relaxed whitespace-pre-wrap text-base">
              {post.content}
            </p>
            <div className="mt-4 flex items-center gap-3 text-xs text-slate-400">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {new Date(post.createdAt).toLocaleString()}
              </span>
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

      {/* Comment form */}
      <CommentForm postId={post.id} onCommented={() => {
        void api
          .get<CommentResponse[]>(`/posts/${id}/comments`)
          .then(setComments);
      }} />

      {/* Comments */}
      <div className="mt-8">
        <h3 className="mb-4 text-lg font-semibold text-slate-900 flex items-center gap-2">
          <MessageSquare className="h-5 w-5" />
          Comments ({comments.length})
        </h3>

        {topLevel.length === 0 ? (
          <p className="text-sm text-slate-500 py-8 text-center">
            No comments yet. Be the first to reply.
          </p>
        ) : (
          <div className="space-y-4">
            {topLevel.map((c) => (
              <CommentNode
                key={c.id}
                comment={c}
                childMap={childMap}
                depth={0}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function VoteWidget({ score }: { score: number }) {
  return (
    <div className="flex flex-col items-center gap-1 min-w-[48px]">
      <button className="rounded-lg p-1.5 hover:bg-emerald-50 text-slate-400 hover:text-emerald-600 cursor-pointer">
        <ThumbsUp className="h-5 w-5" />
      </button>
      <span
        className={`text-sm font-bold ${
          score > 0
            ? "text-emerald-600"
            : score < 0
              ? "text-red-500"
              : "text-slate-400"
        }`}
      >
        {score}
      </span>
      <button className="rounded-lg p-1.5 hover:bg-red-50 text-slate-400 hover:text-red-500 cursor-pointer">
        <ThumbsDown className="h-5 w-5" />
      </button>
    </div>
  );
}

function CommentNode({
  comment,
  childMap,
  depth,
}: {
  comment: CommentResponse;
  childMap: Map<string, CommentResponse[]>;
  depth: number;
}) {
  const children = childMap.get(comment.id) ?? [];

  return (
    <div className={depth > 0 ? "ml-6 border-l-2 border-slate-100 pl-4" : ""}>
      <div className="rounded-lg bg-white border border-slate-100 p-4">
        <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">
          {comment.content}
        </p>
        <div className="mt-2 flex items-center gap-3 text-xs text-slate-400">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {new Date(comment.createdAt).toLocaleDateString()}
          </span>
          <span className="flex items-center gap-1">
            <ThumbsUp className="h-3 w-3" />
            {comment.voteScore}
          </span>
          {comment.moderationStatus !== "approved" && (
            <Badge
              variant={
                comment.moderationStatus === "pending" ? "warning" : "danger"
              }
            >
              {comment.moderationStatus}
            </Badge>
          )}
        </div>
      </div>
      {children.length > 0 && (
        <div className="mt-2 space-y-2">
          {children.map((child) => (
            <CommentNode
              key={child.id}
              comment={child}
              childMap={childMap}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CommentForm({
  postId: _postId,
  onCommented: _onCommented,
}: {
  postId: string;
  onCommented: () => void;
}) {
  const [content, setContent] = useState("");

  return (
    <Card>
      <h4 className="mb-3 font-medium text-slate-900">Add a comment</h4>
      <Textarea
        placeholder="Write your anonymous comment... (requires ZKP)"
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
      <div className="mt-3 flex justify-end">
        <Button size="sm" disabled={!content.trim()}>
          <Send className="h-3.5 w-3.5" />
          Post Comment
        </Button>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        Posting requires a zero-knowledge proof of group membership.
        Set up your identity first.
      </p>
    </Card>
  );
}
