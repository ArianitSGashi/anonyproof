 *
 * Each schema validates the incoming request body or query parameters.
 * Hex strings are validated for length and charset; UUIDs use Zod's .uuid().
 */

import { z } from "zod";

// ─── Shared field schemas ────────────────────────────────────────────────────

/** 64-char lower-case hex string (32 bytes) */
const hex32Bytes = z
  .string()
  .regex(/^[0-9a-f]{64}$/i, "Must be a 64-character hex string (32 bytes)");

/** ZK proof object embedded in content creation requests */
const zkProofSchema = z.object({
  nullifierHash: hex32Bytes,
  externalNullifier: z.string().min(1, "External nullifier is required"),
  proof: z.string().min(1, "Proof is required"),
});

/** Pagination query params — page (1-indexed) and limit */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ─── Posts ───────────────────────────────────────────────────────────────────

export const createPostSchema = z.object({
  groupId: hex32Bytes,
  content: z
    .string()
    .min(1, "Content is required")
    .max(10000, "Content must be 10 000 characters or fewer"),
  proof: zkProofSchema,
});

export const getPostParamsSchema = z.object({
  postId: z.string().uuid("Invalid post ID"),
});

export const listPostsParamsSchema = z.object({
  groupId: hex32Bytes,
});

// ─── Comments ────────────────────────────────────────────────────────────────

export const createCommentSchema = z.object({
  postId: z.string().uuid("Invalid post ID"),
  parentCommentId: z.string().uuid("Invalid parent comment ID").optional(),
  content: z
    .string()
    .min(1, "Content is required")
    .max(5000, "Content must be 5 000 characters or fewer"),
  proof: zkProofSchema,
});

export const getCommentsParamsSchema = z.object({
  postId: z.string().uuid("Invalid post ID"),
});

// ─── Votes ───────────────────────────────────────────────────────────────────

export const castVoteSchema = z
  .object({
    postId: z.string().uuid("Invalid post ID").optional(),
    commentId: z.string().uuid("Invalid comment ID").optional(),
    voteType: z.enum(["upvote", "downvote"]),
    proof: zkProofSchema,
  })
  .refine((data) => !!data.postId !== !!data.commentId, {
    message: "Exactly one of postId or commentId must be provided",
  });
