/**
 * Kysely Database Interface — hand-written to match the PostgreSQL schema.
 *
 * Matches migrations:
 *   001_initial_schema.sql  — 12 tables across public + onboarding schemas
 *   002_blind_signature_support.sql — blind_signature & server_key_hash columns
 *
 * Conventions:
 *   - Buffer for all BYTEA columns (group_id, identity_commitment, hash_value, …)
 *   - string for UUID, TEXT, CITEXT, INET columns
 *   - number for INTEGER and NUMERIC(p,s) columns
 *   - Date for TIMESTAMPTZ and DATE columns
 *   - Literal union types for CHECK-constrained enums
 *   - Generated<T> for columns with DEFAULT values (optional on INSERT)
 *   - GeneratedAlways<T> for GENERATED ALWAYS AS columns (never insertable/updateable)
 *   - JsonValue for JSONB columns
 *
 * Schema mapping:
 *   - Tables 1–10 and 12 live in the `public` schema (default)
 *   - Table 11 (credential_issuance_requests) lives in the `onboarding` schema
 *     → query with: db.withSchema('onboarding').selectFrom('credential_issuance_requests')
 *
 * NOTE: PostgreSQL's `pg` driver returns NUMERIC as string at runtime.
 * We type NUMERIC columns as `number` per project convention. A type parser
 * (pg.types.setTypeParser) should be configured if runtime correctness is needed.
 */

import type {
  ColumnType,
  Generated,
  GeneratedAlways,
  Insertable,
  Selectable,
  Updateable,
} from "kysely";

// Re-export ColumnType for consumers that need custom column typing
export type { ColumnType, Generated, GeneratedAlways };

// ─── JSON Value Type ─────────────────────────────────────────────────────────

/** Recursive JSON-compatible value (matches PostgreSQL JSONB) */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

// ─── Enum Types (matching CHECK constraints) ─────────────────────────────────

/** Posts & comments: AI moderation lifecycle */
export type ModerationStatus = "pending" | "approved" | "flagged" | "rejected";

/** Votes: direction */
export type VoteType = "upvote" | "downvote";

/** Admin users: role hierarchy (moderator < admin < superadmin) */
export type AdminRole = "moderator" | "admin" | "superadmin";

/** Moderation queue: review workflow */
export type ModerationQueueStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "escalated";

/** Credential issuance: request lifecycle */
export type CredentialRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "issued";

// ─── Database Interface ──────────────────────────────────────────────────────

/**
 * Root database interface mapping table names to their column types.
 *
 * For the `onboarding` schema, use `.withSchema('onboarding')` before
 * `.selectFrom('credential_issuance_requests')` so PostgreSQL resolves
 * the correct schema at runtime.
 */
export interface Database {
  // ── Public Schema (Tables 1–10, 12) ────────────────────────────────
  semaphore_groups: SemaphoreGroupsTable;
  semaphore_members: SemaphoreMembersTable;
  merkle_tree_nodes: MerkleTreeNodesTable;
  posts: PostsTable;
  comments: CommentsTable;
  votes: VotesTable;
  admin_users: AdminUsersTable;
  moderation_queue: ModerationQueueTable;
  admin_actions: AdminActionsTable;
  analytics_daily_snapshots: AnalyticsDailySnapshotsTable;
  ai_model_versions: AiModelVersionsTable;

  // ── Onboarding Schema (Table 11) ──────────────────────────────────
  // Query with: db.withSchema('onboarding').selectFrom('credential_issuance_requests')
  credential_issuance_requests: CredentialIssuanceRequestsTable;
}

// ═════════════════════════════════════════════════════════════════════════════
// TABLE INTERFACES
// ═════════════════════════════════════════════════════════════════════════════
//
// NULLABLE COLUMN CONVENTION:
// PostgreSQL implicitly defaults nullable columns to NULL when omitted from INSERT.
// These are typed as Generated<T | null> so Kysely's Insertable makes them optional,
// matching actual PostgreSQL behavior. On SELECT they resolve to T | null.

// ─── Table 1: semaphore_groups ───────────────────────────────────────────────

export interface SemaphoreGroupsTable {
  /** UUID PRIMARY KEY DEFAULT gen_random_uuid() */
  id: Generated<string>;
  /** BYTEA NOT NULL — stable external ZKP identifier (32 bytes) */
  group_id: Buffer;
  /** TEXT NOT NULL — e.g. "Stanford University 2024" */
  name: string;
  /** TEXT — optional long-form description */
  description: Generated<string | null>;
  /** INTEGER NOT NULL — Merkle tree depth (immutable after creation) */
  depth: number;
  /** BYTEA NOT NULL — Poseidon hash for empty leaf positions (32 bytes) */
  zero_value: Buffer;
  /** TIMESTAMPTZ NOT NULL DEFAULT now() */
  created_at: Generated<Date>;
  /** TIMESTAMPTZ NOT NULL DEFAULT now() — auto-updated by trigger */
  updated_at: Generated<Date>;
}

// ─── Table 2: semaphore_members ──────────────────────────────────────────────

export interface SemaphoreMembersTable {
  /** UUID PRIMARY KEY DEFAULT gen_random_uuid() */
  id: Generated<string>;
  /** BYTEA NOT NULL — FK → semaphore_groups.group_id */
  group_id: Buffer;
  /** BYTEA NOT NULL — Poseidon(secret), one-way public commitment (32 bytes) */
  identity_commitment: Buffer;
  /** INTEGER NOT NULL — 0-indexed position in the Merkle tree */
  leaf_index: number;
  /** BOOLEAN NOT NULL DEFAULT FALSE */
  is_revoked: Generated<boolean>;
  /** TIMESTAMPTZ — required when is_revoked = TRUE */
  revoked_at: Generated<Date | null>;
  /** TEXT — reason for revocation */
  revoked_reason: Generated<string | null>;
  /** TEXT — AES-encrypted JSON metadata */
  metadata_encrypted: Generated<string | null>;
  /** TIMESTAMPTZ NOT NULL DEFAULT now() */
  created_at: Generated<Date>;
}

// ─── Table 3: merkle_tree_nodes ──────────────────────────────────────────────

export interface MerkleTreeNodesTable {
  /** UUID PRIMARY KEY DEFAULT gen_random_uuid() */
  id: Generated<string>;
  /** BYTEA NOT NULL — FK → semaphore_groups.group_id */
  group_id: Buffer;
  /** INTEGER NOT NULL — 0 = leaves, depth = root */
  level: number;
  /** INTEGER NOT NULL — 0-indexed position within this level */
  index_at_level: number;
  /** BYTEA NOT NULL — Poseidon hash at this position (32 bytes) */
  hash_value: Buffer;
  /** TIMESTAMPTZ NOT NULL DEFAULT now() */
  created_at: Generated<Date>;
}

// ─── Table 4: posts ──────────────────────────────────────────────────────────

export interface PostsTable {
  /** UUID PRIMARY KEY DEFAULT gen_random_uuid() */
  id: Generated<string>;
  /** BYTEA NOT NULL — FK → semaphore_groups.group_id */
  group_id: Buffer;
  /** TEXT NOT NULL — 1–10000 chars */
  content: string;

  // ZKP anonymity
  /** BYTEA NOT NULL — hash(user_secret, external_nullifier) (32 bytes) */
  nullifier_hash: Buffer;
  /** TEXT NOT NULL — uniqueness scope, must include group_id */
  external_nullifier: string;
  /** BOOLEAN NOT NULL DEFAULT FALSE */
  proof_verified: Generated<boolean>;
  /** JSONB — full serialised ZKP for audit */
  proof_data: Generated<JsonValue | null>;

  // AI moderation
  /** TEXT NOT NULL DEFAULT 'pending' — lifecycle status */
  ai_moderation_status: Generated<ModerationStatus>;
  /** NUMERIC(3,2) — 0.00–1.00 toxicity score */
  ai_toxicity_score: Generated<number | null>;
  /** JSONB — category breakdown from AI model */
  ai_moderation_categories: Generated<JsonValue | null>;
  /** TIMESTAMPTZ — when AI/human moderated */
  moderated_at: Generated<Date | null>;
  /** TEXT — which model version produced the score */
  moderation_model_version: Generated<string | null>;

  // Vote aggregates (cached, updated by app layer)
  /** INTEGER NOT NULL DEFAULT 0 */
  upvotes: Generated<number>;
  /** INTEGER NOT NULL DEFAULT 0 */
  downvotes: Generated<number>;
  /** INTEGER GENERATED ALWAYS AS (upvotes - downvotes) STORED */
  vote_score: GeneratedAlways<number>;

  // Soft delete
  /** BOOLEAN NOT NULL DEFAULT FALSE */
  is_deleted: Generated<boolean>;
  /** TIMESTAMPTZ — required when is_deleted = TRUE */
  deleted_at: Generated<Date | null>;

  /** TIMESTAMPTZ NOT NULL DEFAULT now() */
  created_at: Generated<Date>;
  /** TIMESTAMPTZ NOT NULL DEFAULT now() — auto-updated by trigger */
  updated_at: Generated<Date>;
}

// ─── Table 5: comments ──────────────────────────────────────────────────────

export interface CommentsTable {
  /** UUID PRIMARY KEY DEFAULT gen_random_uuid() */
  id: Generated<string>;
  /** UUID NOT NULL — FK → posts.id */
  post_id: string;
  /** UUID — NULL = top-level comment, non-NULL = threaded reply */
  parent_comment_id: Generated<string | null>;
  /** BYTEA NOT NULL — FK → semaphore_groups.group_id (must match post's group) */
  group_id: Buffer;
  /** TEXT NOT NULL — 1–5000 chars */
  content: string;

  // ZKP anonymity
  /** BYTEA NOT NULL (32 bytes) */
  nullifier_hash: Buffer;
  /** TEXT NOT NULL — must include group_id */
  external_nullifier: string;
  /** BOOLEAN NOT NULL DEFAULT FALSE */
  proof_verified: Generated<boolean>;
  /** JSONB */
  proof_data: Generated<JsonValue | null>;

  // AI moderation (mirrors posts)
  /** TEXT NOT NULL DEFAULT 'pending' */
  ai_moderation_status: Generated<ModerationStatus>;
  /** NUMERIC(3,2) — 0.00–1.00 */
  ai_toxicity_score: Generated<number | null>;
  /** JSONB */
  ai_moderation_categories: Generated<JsonValue | null>;
  /** TIMESTAMPTZ */
  moderated_at: Generated<Date | null>;
  /** TEXT */
  moderation_model_version: Generated<string | null>;

  // Vote aggregates
  /** INTEGER NOT NULL DEFAULT 0 */
  upvotes: Generated<number>;
  /** INTEGER NOT NULL DEFAULT 0 */
  downvotes: Generated<number>;
  /** INTEGER GENERATED ALWAYS AS (upvotes - downvotes) STORED */
  vote_score: GeneratedAlways<number>;

  // Soft delete
  /** BOOLEAN NOT NULL DEFAULT FALSE */
  is_deleted: Generated<boolean>;
  /** TIMESTAMPTZ */
  deleted_at: Generated<Date | null>;

  /** TIMESTAMPTZ NOT NULL DEFAULT now() */
  created_at: Generated<Date>;
  /** TIMESTAMPTZ NOT NULL DEFAULT now() */
  updated_at: Generated<Date>;
}

// ─── Table 6: votes ──────────────────────────────────────────────────────────

export interface VotesTable {
  /** UUID PRIMARY KEY DEFAULT gen_random_uuid() */
  id: Generated<string>;
  /** UUID — FK → posts.id (exactly one of post_id/comment_id must be set) */
  post_id: Generated<string | null>;
  /** UUID — FK → comments.id */
  comment_id: Generated<string | null>;
  /** TEXT NOT NULL — 'upvote' | 'downvote' */
  vote_type: VoteType;
  /** BYTEA NOT NULL (32 bytes) */
  nullifier_hash: Buffer;
  /** TEXT NOT NULL — scoped to target + group */
  external_nullifier: string;
  /** BOOLEAN NOT NULL DEFAULT FALSE */
  proof_verified: Generated<boolean>;
  /** JSONB */
  proof_data: Generated<JsonValue | null>;
  /** TIMESTAMPTZ NOT NULL DEFAULT now() */
  created_at: Generated<Date>;
}

// ─── Table 7: moderation_queue ───────────────────────────────────────────────

export interface ModerationQueueTable {
  /** UUID PRIMARY KEY DEFAULT gen_random_uuid() */
  id: Generated<string>;
  /** UUID — FK → posts.id (exactly one of post_id/comment_id must be set) */
  post_id: Generated<string | null>;
  /** UUID — FK → comments.id */
  comment_id: Generated<string | null>;
  /** NUMERIC(3,2) NOT NULL — 0.00–1.00 */
  ai_toxicity_score: number;
  /** JSONB — category breakdown */
  ai_flagged_categories: Generated<JsonValue | null>;
  /** TEXT NOT NULL DEFAULT 'pending' */
  status: Generated<ModerationQueueStatus>;
  /** UUID — FK → admin_users.id */
  reviewed_by_admin_id: Generated<string | null>;
  /** TEXT */
  review_notes: Generated<string | null>;
  /** TIMESTAMPTZ — required when status != 'pending' */
  reviewed_at: Generated<Date | null>;
  /** TIMESTAMPTZ NOT NULL DEFAULT now() */
  created_at: Generated<Date>;
}

// ─── Table 8: admin_users ────────────────────────────────────────────────────

export interface AdminUsersTable {
  /** UUID PRIMARY KEY DEFAULT gen_random_uuid() */
  id: Generated<string>;
  /** TEXT NOT NULL UNIQUE */
  username: string;
  /** CITEXT NOT NULL UNIQUE */
  email: string;
  /** TEXT NOT NULL — bcrypt hash (~60 chars) */
  password_hash: string;
  /** TEXT NOT NULL DEFAULT 'moderator' */
  role: Generated<AdminRole>;
  /** BOOLEAN NOT NULL DEFAULT TRUE */
  is_active: Generated<boolean>;
  /** TIMESTAMPTZ */
  last_login: Generated<Date | null>;
  /** TIMESTAMPTZ NOT NULL DEFAULT now() */
  created_at: Generated<Date>;
  /** TIMESTAMPTZ NOT NULL DEFAULT now() */
  updated_at: Generated<Date>;
}

// ─── Table 9: admin_actions (append-only audit log) ──────────────────────────

export interface AdminActionsTable {
  /** UUID PRIMARY KEY DEFAULT gen_random_uuid() */
  id: Generated<string>;
  /** UUID — FK → admin_users.id (ON DELETE SET NULL) */
  admin_id: Generated<string | null>;
  /** TEXT NOT NULL — e.g. 'approve_post', 'revoke_credential' */
  action_type: string;
  /** TEXT — e.g. 'post', 'comment', 'credential' */
  target_type: Generated<string | null>;
  /** TEXT — UUID or commitment hash as text */
  target_id: Generated<string | null>;
  /** JSONB — structured context */
  details: Generated<JsonValue | null>;
  /** INET — client IP address */
  ip_address: Generated<string | null>;
  /** TIMESTAMPTZ NOT NULL DEFAULT now() */
  created_at: Generated<Date>;
}

// ─── Table 10: analytics_daily_snapshots ─────────────────────────────────────

export interface AnalyticsDailySnapshotsTable {
  /** UUID PRIMARY KEY DEFAULT gen_random_uuid() */
  id: Generated<string>;
  /** BYTEA NOT NULL — FK → semaphore_groups.group_id */
  group_id: Buffer;
  /** DATE NOT NULL — snapshot date */
  date: Date;
  /** INTEGER NOT NULL DEFAULT 0 */
  total_posts: Generated<number>;
  /** INTEGER NOT NULL DEFAULT 0 */
  total_comments: Generated<number>;
  /** INTEGER NOT NULL DEFAULT 0 */
  total_votes: Generated<number>;
  /** NUMERIC(3,2) — 0.00–1.00 */
  avg_toxicity_score: Generated<number | null>;
  /** INTEGER NOT NULL DEFAULT 0 */
  flagged_content_count: Generated<number>;
  /** INTEGER — hidden when < k (k-anonymity threshold) */
  active_members_estimate: Generated<number | null>;
  /** NUMERIC(5,2) — 0.00–100.00 percentage */
  sentiment_positive_pct: Generated<number | null>;
  /** JSONB — top discussion topics */
  top_topics: Generated<JsonValue | null>;
  /** TIMESTAMPTZ NOT NULL DEFAULT now() */
  created_at: Generated<Date>;
}

// ─── Table 11: onboarding.credential_issuance_requests ───────────────────────
// Query via: db.withSchema('onboarding').selectFrom('credential_issuance_requests')

export interface CredentialIssuanceRequestsTable {
  /** UUID PRIMARY KEY DEFAULT gen_random_uuid() */
  id: Generated<string>;
  /** UUID NOT NULL DEFAULT gen_random_uuid() — external-facing request ID */
  request_id: Generated<string>;
  /** CITEXT NOT NULL — university email (sensitive, purged after 90 days) */
  email: string;
  /** TEXT — optional student ID for verification */
  student_id: Generated<string | null>;
  /** BYTEA NOT NULL — FK → semaphore_groups.group_id */
  group_id: Buffer;
  /** TEXT NOT NULL DEFAULT 'pending' */
  status: Generated<CredentialRequestStatus>;
  /**
   * BYTEA — In the blind signature protocol, this stores the BLINDED commitment
   * (not the real one). The real commitment is submitted separately in Phase 2.
   * CHECK allows NULL or 32 bytes (will be relaxed for blind signatures).
   */
  identity_commitment: Generated<Buffer | null>;
  /** UUID — FK → admin_users.id (ON DELETE SET NULL) */
  approved_by_admin_id: Generated<string | null>;
  /** TEXT — required when status = 'rejected' */
  rejection_reason: Generated<string | null>;
  /** TIMESTAMPTZ — required when status = 'issued' */
  issued_at: Generated<Date | null>;
  /** TIMESTAMPTZ NOT NULL DEFAULT now() + 90 days */
  purge_after: Generated<Date>;
  /** TIMESTAMPTZ NOT NULL DEFAULT now() */
  created_at: Generated<Date>;
  /** TIMESTAMPTZ NOT NULL DEFAULT now() */
  updated_at: Generated<Date>;

  // ── Added by migration 002 ──────────────────────────────────────
  /** BYTEA — RSA blind signature over the blinded commitment */
  blind_signature: Generated<Buffer | null>;
  /** BYTEA — SHA-256 hash of the server RSA public key used */
  server_key_hash: Generated<Buffer | null>;
}

// ─── Table 12: ai_model_versions ─────────────────────────────────────────────

export interface AiModelVersionsTable {
  /** UUID PRIMARY KEY DEFAULT gen_random_uuid() */
  id: Generated<string>;
  /** TEXT NOT NULL — e.g. 'perspective-api', 'detoxify' */
  model_name: string;
  /** TEXT NOT NULL — e.g. 'v1', 'v0.5' */
  version: string;
  /** TEXT */
  description: Generated<string | null>;
  /** NUMERIC(3,2) NOT NULL DEFAULT 0.70 */
  threshold_toxicity: Generated<number>;
  /** BOOLEAN NOT NULL DEFAULT TRUE — only one active per model_name */
  is_active: Generated<boolean>;
  /** TIMESTAMPTZ NOT NULL DEFAULT now() */
  activated_at: Generated<Date>;
  /** TIMESTAMPTZ */
  deactivated_at: Generated<Date | null>;
}

// ═════════════════════════════════════════════════════════════════════════════
// CONVENIENCE TYPE ALIASES
// ═════════════════════════════════════════════════════════════════════════════
// Selectable<T> → all columns as their SELECT types (runtime shape)
// Insertable<T> → Generated columns optional, GeneratedAlways omitted
// Updateable<T> → all columns optional (partial update)

// Table 1: semaphore_groups
export type SemaphoreGroup = Selectable<SemaphoreGroupsTable>;
export type NewSemaphoreGroup = Insertable<SemaphoreGroupsTable>;
export type SemaphoreGroupUpdate = Updateable<SemaphoreGroupsTable>;

// Table 2: semaphore_members
export type SemaphoreMember = Selectable<SemaphoreMembersTable>;
export type NewSemaphoreMember = Insertable<SemaphoreMembersTable>;
export type SemaphoreMemberUpdate = Updateable<SemaphoreMembersTable>;

// Table 3: merkle_tree_nodes
export type MerkleTreeNode = Selectable<MerkleTreeNodesTable>;
export type NewMerkleTreeNode = Insertable<MerkleTreeNodesTable>;
export type MerkleTreeNodeUpdate = Updateable<MerkleTreeNodesTable>;

// Table 4: posts
export type Post = Selectable<PostsTable>;
export type NewPost = Insertable<PostsTable>;
export type PostUpdate = Updateable<PostsTable>;

// Table 5: comments
export type Comment = Selectable<CommentsTable>;
export type NewComment = Insertable<CommentsTable>;
export type CommentUpdate = Updateable<CommentsTable>;

// Table 6: votes (no Update — votes are immutable)
export type Vote = Selectable<VotesTable>;
export type NewVote = Insertable<VotesTable>;

// Table 7: moderation_queue
export type ModerationQueueEntry = Selectable<ModerationQueueTable>;
export type NewModerationQueueEntry = Insertable<ModerationQueueTable>;
export type ModerationQueueEntryUpdate = Updateable<ModerationQueueTable>;

// Table 8: admin_users
export type AdminUser = Selectable<AdminUsersTable>;
export type NewAdminUser = Insertable<AdminUsersTable>;
export type AdminUserUpdate = Updateable<AdminUsersTable>;

// Table 9: admin_actions (append-only — no Update type)
export type AdminAction = Selectable<AdminActionsTable>;
export type NewAdminAction = Insertable<AdminActionsTable>;

// Table 10: analytics_daily_snapshots
export type AnalyticsDailySnapshot = Selectable<AnalyticsDailySnapshotsTable>;
export type NewAnalyticsDailySnapshot = Insertable<AnalyticsDailySnapshotsTable>;
export type AnalyticsDailySnapshotUpdate = Updateable<AnalyticsDailySnapshotsTable>;

// Table 11: credential_issuance_requests
export type CredentialIssuanceRequest = Selectable<CredentialIssuanceRequestsTable>;
export type NewCredentialIssuanceRequest = Insertable<CredentialIssuanceRequestsTable>;
export type CredentialIssuanceRequestUpdate = Updateable<CredentialIssuanceRequestsTable>;

// Table 12: ai_model_versions
export type AiModelVersion = Selectable<AiModelVersionsTable>;
export type NewAiModelVersion = Insertable<AiModelVersionsTable>;
export type AiModelVersionUpdate = Updateable<AiModelVersionsTable>;
