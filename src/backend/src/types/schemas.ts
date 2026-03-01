/**
 * Zod validation schemas for Phase 3 API endpoints.
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

// ─── Groups ──────────────────────────────────────────────────────────────────

export const createGroupSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(200, "Name must be 200 characters or fewer"),
  description: z
    .string()
    .max(2000, "Description must be 2000 characters or fewer")
    .optional(),
  depth: z
    .number()
    .int()
    .min(16, "Depth must be at least 16")
    .max(32, "Depth must be at most 32"),
});

// ─── Admin ───────────────────────────────────────────────────────────────────

export const adminLoginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

export const createAdminSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(50, "Username must be 50 characters or fewer")
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      "Username can only contain letters, numbers, hyphens, and underscores",
    ),
  email: z.string().email("Must be a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: z.enum(["moderator", "admin", "superadmin"]),
});

export const auditLogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  adminId: z.string().uuid().optional(),
  actionType: z.string().optional(),
  targetType: z.string().optional(),
});

// ─── Moderation Queue ────────────────────────────────────────────────────────

export const moderationQueueQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["pending", "approved", "rejected", "escalated"]).optional(),
  minScore: z.coerce.number().min(0).max(1).optional(),
});

export const moderationDecisionSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  notes: z.string().max(2000).optional(),
});

// ─── Credentials (Blind Signature Flow) ──────────────────────────────────────

export const blindCredentialRequestSchema = z.object({
  universityEmail: z.string().email("Must be a valid email address"),
  groupId: hex32Bytes,
  blindedCommitment: z
    .string()
    .min(1, "Blinded commitment is required")
    .regex(/^[0-9a-fA-F]+$/, "Must be a hex string"),
});

export const commitmentRegistrationSchema = z.object({
  groupId: hex32Bytes,
  commitment: hex32Bytes,
  signature: z
    .string()
    .min(1, "Signature is required")
    .regex(/^[0-9a-fA-F]+$/, "Must be a hex string"),
});

export const credentialRejectSchema = z.object({
  reason: z
    .string()
    .min(1, "Reason is required")
    .max(1000, "Reason must be 1000 characters or fewer"),
});

export const batchApproveSchema = z.object({
  requestIds: z
    .array(z.string().uuid())
    .min(1, "At least one request ID is required"),
});
