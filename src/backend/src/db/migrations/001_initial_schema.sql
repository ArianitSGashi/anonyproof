-- ============================================================================
-- AnonyProof – Initial Database Schema
-- Migration: 001_initial_schema
-- PostgreSQL 17+
-- ============================================================================
--
-- TYPE DECISION: BYTEA(32) for all cryptographic values
-- ─────────────────────────────────────────────────────
-- • Storage:  32 bytes vs 66 bytes (VARCHAR hex) — 51 % smaller
-- • Indexing: Fixed-width binary compares faster than variable-length text
-- • Hashing:  PostgreSQL hash indexes work natively on BYTEA
-- • Joins:    FK lookups on BYTEA(32) are measurably faster at scale
-- • Trade-off: Harder to eyeball in psql; mitigated by a helper view and
--              encode(col,'hex') in debug queries.
--
-- PRIVACY INVARIANTS enforced at the schema level:
--   1. Content tables (posts, comments, votes) have NO user_id / author_id.
--   2. Different action types use different external_nullifiers → un-correlatable.
--   3. Comments inherit group_id from parent post (trigger-enforced).
--   4. Conditional-state columns validated via CHECK constraints.
--   5. Credential issuance lives in the `onboarding` schema, never joins content.
-- ============================================================================

-- ── 0. Extensions & Schemas ─────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid(), crypt(), etc.
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive text for emails

CREATE SCHEMA IF NOT EXISTS onboarding;    -- isolated credential issuance data

-- ── Helper: updated_at trigger function ─────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION set_updated_at() IS
  'Generic trigger function that stamps updated_at = now() on every UPDATE.';


-- ============================================================================
-- CATEGORY 1: ZERO-KNOWLEDGE PROOF INFRASTRUCTURE
-- ============================================================================

-- ── Table 1: semaphore_groups ───────────────────────────────────────────────

CREATE TABLE semaphore_groups (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    BYTEA       NOT NULL CHECK (octet_length(group_id) = 32),     -- stable external ZKP identifier (32 bytes)
  name        TEXT        NOT NULL,                     -- e.g. "Stanford University 2024"
  description TEXT,                                     -- optional long-form description
  depth       INTEGER     NOT NULL CHECK (depth BETWEEN 10 AND 32),  -- Merkle tree depth (immutable)
  zero_value  BYTEA       NOT NULL CHECK (octet_length(zero_value) = 32),   -- hash for empty leaf positions
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_semaphore_groups_group_id UNIQUE (group_id)
);

CREATE TRIGGER trg_semaphore_groups_updated_at
  BEFORE UPDATE ON semaphore_groups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Prevent changing depth after creation (would invalidate all proofs).
CREATE OR REPLACE FUNCTION prevent_depth_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.depth IS DISTINCT FROM NEW.depth THEN
    RAISE EXCEPTION 'depth is immutable once the group is created';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_semaphore_groups_immutable_depth
  BEFORE UPDATE ON semaphore_groups
  FOR EACH ROW EXECUTE FUNCTION prevent_depth_change();

COMMENT ON TABLE  semaphore_groups IS
  'Defines anonymous Semaphore groups (universities, courses, communities). '
  'Each group owns a Merkle tree whose leaves are identity commitments.';
COMMENT ON COLUMN semaphore_groups.group_id IS
  'Stable external identifier used as public input in ZKP verification circuits.';
COMMENT ON COLUMN semaphore_groups.depth IS
  'Merkle tree depth. max_members = 2^depth. IMMUTABLE after creation — '
  'changing it would restructure the tree and invalidate every existing proof.';
COMMENT ON COLUMN semaphore_groups.zero_value IS
  'Poseidon hash used for empty (unfilled) leaf positions in the Merkle tree.';


-- ── Table 2: semaphore_members ──────────────────────────────────────────────

CREATE TABLE semaphore_members (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id             BYTEA       NOT NULL
                        REFERENCES semaphore_groups(group_id) ON DELETE CASCADE,
  identity_commitment  BYTEA       NOT NULL CHECK (octet_length(identity_commitment) = 32),  -- Poseidon(secret); one-way, public
  leaf_index           INTEGER     NOT NULL CHECK (leaf_index >= 0),
  is_revoked           BOOLEAN     NOT NULL DEFAULT FALSE,
  revoked_at           TIMESTAMPTZ,
  revoked_reason       TEXT,
  metadata_encrypted   TEXT,                             -- encrypted JSON, e.g. {"role":"student"}
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- State consistency: revoked → must have timestamp
  CONSTRAINT chk_revoked_has_timestamp
    CHECK (NOT is_revoked OR revoked_at IS NOT NULL),

  -- One identity commitment per group position
  CONSTRAINT uq_semaphore_members_group_leaf
    UNIQUE (group_id, leaf_index),

  -- Unique commitment per group (same person can join multiple groups with same commitment)
  CONSTRAINT uq_semaphore_members_group_commitment
    UNIQUE (group_id, identity_commitment)
);

-- Active members in a group (not covered by UNIQUE constraints)
CREATE INDEX idx_semaphore_members_group_active
  ON semaphore_members (group_id, is_revoked);

-- NOTE: idx on (group_id, identity_commitment) and (group_id, leaf_index)
-- intentionally omitted — already covered by uq_semaphore_members_group_commitment
-- and uq_semaphore_members_group_leaf UNIQUE constraints.

COMMENT ON TABLE  semaphore_members IS
  'Identity commitments of verified group members – the leaves of the Merkle tree. '
  'A commitment = Poseidon(secret). Only the owner knows the secret; the commitment '
  'is public and one-way. Even with full DB access you cannot determine who this '
  'commitment belongs to, nor which posts the member created.';
COMMENT ON COLUMN semaphore_members.identity_commitment IS
  'Poseidon hash of the member''s private secret. One-way: impossible to derive the secret.';
COMMENT ON COLUMN semaphore_members.leaf_index IS
  'Position (0-indexed) of this commitment in the Merkle tree. Required by the user '
  'to construct the Merkle path when generating a proof. Public info — does not '
  'compromise privacy because commitments are one-way hashes.';
COMMENT ON COLUMN semaphore_members.is_revoked IS
  'TRUE = credential revoked (banned). The commitment can no longer generate valid proofs. '
  'Banning does not reveal the member''s real identity.';
COMMENT ON COLUMN semaphore_members.metadata_encrypted IS
  'Optional AES-encrypted JSON (e.g. {"role":"student"}). Encrypted at rest so even '
  'a DB leak does not reveal role mappings. Used for aggregate analytics only.';


-- ── Table 3: merkle_tree_nodes ──────────────────────────────────────────────

CREATE TABLE merkle_tree_nodes (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id        BYTEA       NOT NULL
                    REFERENCES semaphore_groups(group_id) ON DELETE CASCADE,
  level           INTEGER     NOT NULL CHECK (level >= 0),       -- 0 = leaves, depth = root
  index_at_level  INTEGER     NOT NULL CHECK (index_at_level >= 0),
  hash_value      BYTEA       NOT NULL CHECK (octet_length(hash_value) = 32),  -- Poseidon hash at this position
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One hash per (group, level, position)
  CONSTRAINT uq_merkle_tree_node_position
    UNIQUE (group_id, level, index_at_level)
);

-- NOTE: (group_id, level, index_at_level) index intentionally omitted —
-- already covered by uq_merkle_tree_node_position UNIQUE constraint.

COMMENT ON TABLE  merkle_tree_nodes IS
  'Full Merkle tree for each Semaphore group. Level 0 = identity commitments (leaves). '
  'Each parent = Poseidon(left_child, right_child). The root (level = depth) represents '
  'the entire membership set. Stored to allow O(1) sibling look-ups during proof generation '
  'instead of O(n) recomputation.';
COMMENT ON COLUMN merkle_tree_nodes.level IS
  'Tree level: 0 = leaf (commitment), 1 = hash(leaf_i, leaf_{i+1}), …, depth = single root hash.';
COMMENT ON COLUMN merkle_tree_nodes.index_at_level IS
  '0-indexed position within this level. Nodes at level L: 2^(depth - L).';
COMMENT ON COLUMN merkle_tree_nodes.hash_value IS
  'Poseidon hash. At level 0 this equals the identity_commitment; above that, '
  'hash(left_child, right_child).';


-- ============================================================================
-- CATEGORY 2: ANONYMOUS CONTENT
-- ============================================================================

-- ── Table 4: posts ──────────────────────────────────────────────────────────

CREATE TABLE posts (
  id                       UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id                 BYTEA         NOT NULL
                             REFERENCES semaphore_groups(group_id) ON DELETE CASCADE,
  content                  TEXT          NOT NULL
                             CHECK (char_length(content) BETWEEN 1 AND 10000),

  -- ZKP anonymity fields
  nullifier_hash           BYTEA         NOT NULL CHECK (octet_length(nullifier_hash) = 32),
  external_nullifier       TEXT          NOT NULL,   -- scope: "post_creation_{group_id_hex}_..." etc.
  proof_verified           BOOLEAN       NOT NULL DEFAULT FALSE,
  proof_data               JSONB,                    -- full ZKP for audit

  -- AI moderation
  ai_moderation_status     TEXT          NOT NULL DEFAULT 'pending'
                             CHECK (ai_moderation_status IN ('pending','approved','flagged','rejected')),
  ai_toxicity_score        NUMERIC(3,2)
                             CHECK (ai_toxicity_score IS NULL OR ai_toxicity_score BETWEEN 0 AND 1),
  ai_moderation_categories JSONB,
  moderated_at             TIMESTAMPTZ,
  moderation_model_version TEXT,

  -- Cached vote aggregates (updated by application layer)
  upvotes                  INTEGER       NOT NULL DEFAULT 0 CHECK (upvotes   >= 0),
  downvotes                INTEGER       NOT NULL DEFAULT 0 CHECK (downvotes >= 0),
  vote_score               INTEGER       GENERATED ALWAYS AS (upvotes - downvotes) STORED,

  -- Soft delete
  is_deleted               BOOLEAN       NOT NULL DEFAULT FALSE,
  deleted_at               TIMESTAMPTZ,

  -- Timestamps
  created_at               TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ   NOT NULL DEFAULT now(),

  -- ── State-consistency constraints ──
  -- Deleted → must have timestamp
  CONSTRAINT chk_post_deleted_has_timestamp
    CHECK (NOT is_deleted OR deleted_at IS NOT NULL),
  -- Moderated → must have timestamp
  CONSTRAINT chk_post_moderated_has_timestamp
    CHECK (ai_moderation_status = 'pending' OR moderated_at IS NOT NULL),
  -- One proof per scope (spam prevention)
  CONSTRAINT uq_post_nullifier_scope
    UNIQUE (nullifier_hash, external_nullifier)
);

CREATE TRIGGER trg_posts_updated_at
  BEFORE UPDATE ON posts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Feed: recent posts in a group
CREATE INDEX idx_posts_group_created
  ON posts (group_id, created_at DESC);

-- Approved feed
CREATE INDEX idx_posts_approved_feed
  ON posts (group_id, ai_moderation_status, is_deleted, created_at DESC);

-- Trending (partial – only approved & visible)
CREATE INDEX idx_posts_trending
  ON posts (group_id, vote_score DESC, created_at DESC)
  WHERE ai_moderation_status = 'approved' AND NOT is_deleted;

-- Moderation queue
CREATE INDEX idx_posts_flagged
  ON posts (ai_moderation_status, created_at)
  WHERE ai_moderation_status = 'flagged';

COMMENT ON TABLE  posts IS
  'Anonymous posts. CRITICAL PRIVACY: No user_id, author_id, or any stable identifier '
  'linking to a real person. Even with full DB access, posts cannot be de-anonymised. '
  'The nullifier_hash prevents spam (same user + same scope = same hash → rejected as '
  'duplicate) while maintaining anonymity (different scopes → different hashes → '
  'un-correlatable).';
COMMENT ON COLUMN posts.nullifier_hash IS
  'hash(user_secret, external_nullifier). Deterministic per scope so duplicates are '
  'detected, but different across scopes so actions cannot be correlated.';
COMMENT ON COLUMN posts.external_nullifier IS
  'Defines the uniqueness scope. CRITICAL: Must ALWAYS include the group_id to prevent '
  'cross-group nullifier correlation. Without group_id in the scope, the same user '
  'posting in two groups on the same day produces the SAME nullifier_hash in both rows, '
  'allowing a DBA to correlate them ("same person posted in Group A and Group B"). '
  'Required format: "post_creation_{group_id_hex}[_optional_time_scope]". '
  'Examples: "post_creation_ab01ff..._2024-02-08" (once per day per group), '
  '"post_creation_ab01ff..." (once ever per group), '
  '"post_creation_ab01ff..._{random_uuid}" (unlimited per group).';
COMMENT ON COLUMN posts.ai_moderation_status IS
  'Lifecycle: pending → (AI analyzes) → approved | flagged → (human review) → approved | rejected.';
COMMENT ON COLUMN posts.vote_score IS
  'GENERATED ALWAYS AS (upvotes - downvotes). Used for trending sort.';


-- ── Table 5: comments ───────────────────────────────────────────────────────

CREATE TABLE comments (
  id                       UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id                  UUID          NOT NULL
                             REFERENCES posts(id) ON DELETE CASCADE,
  parent_comment_id        UUID,
  group_id                 BYTEA         NOT NULL
                             REFERENCES semaphore_groups(group_id) ON DELETE CASCADE,
  content                  TEXT          NOT NULL
                             CHECK (char_length(content) BETWEEN 1 AND 5000),

  -- ZKP anonymity
  nullifier_hash           BYTEA         NOT NULL CHECK (octet_length(nullifier_hash) = 32),
  external_nullifier       TEXT          NOT NULL,
  proof_verified           BOOLEAN       NOT NULL DEFAULT FALSE,
  proof_data               JSONB,

  -- AI moderation (mirrors posts)
  ai_moderation_status     TEXT          NOT NULL DEFAULT 'pending'
                             CHECK (ai_moderation_status IN ('pending','approved','flagged','rejected')),
  ai_toxicity_score        NUMERIC(3,2)
                             CHECK (ai_toxicity_score IS NULL OR ai_toxicity_score BETWEEN 0 AND 1),
  ai_moderation_categories JSONB,
  moderated_at             TIMESTAMPTZ,
  moderation_model_version TEXT,

  -- Cached vote aggregates
  upvotes                  INTEGER       NOT NULL DEFAULT 0 CHECK (upvotes   >= 0),
  downvotes                INTEGER       NOT NULL DEFAULT 0 CHECK (downvotes >= 0),
  vote_score               INTEGER       GENERATED ALWAYS AS (upvotes - downvotes) STORED,

  -- Soft delete
  is_deleted               BOOLEAN       NOT NULL DEFAULT FALSE,
  deleted_at               TIMESTAMPTZ,

  -- Timestamps
  created_at               TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ   NOT NULL DEFAULT now(),

  -- ── State-consistency constraints ──
  CONSTRAINT chk_comment_deleted_has_timestamp
    CHECK (NOT is_deleted OR deleted_at IS NOT NULL),
  CONSTRAINT chk_comment_moderated_has_timestamp
    CHECK (ai_moderation_status = 'pending' OR moderated_at IS NOT NULL),
  CONSTRAINT chk_comment_no_self_reference
    CHECK (parent_comment_id IS NULL OR parent_comment_id != id),
  CONSTRAINT uq_comment_nullifier_scope
    UNIQUE (nullifier_hash, external_nullifier),

  -- Required as composite FK target so child comments can reference (id, post_id)
  CONSTRAINT uq_comment_id_post
    UNIQUE (id, post_id),

  -- Parent comment must belong to the same post (composite FK)
  CONSTRAINT fk_comment_parent_same_post
    FOREIGN KEY (parent_comment_id, post_id)
    REFERENCES comments(id, post_id) ON DELETE CASCADE
);

CREATE TRIGGER trg_comments_updated_at
  BEFORE UPDATE ON comments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- NOTE: group_id consistency (comment.group_id must match post.group_id) is
-- enforced at the application layer during ZKP verification, NOT via trigger.
-- The app validates group membership before insert; keeping the check in app
-- code avoids a hidden SELECT per comment and keeps workflow logic visible.

-- Comments on a post (chronological)
CREATE INDEX idx_comments_post_created
  ON comments (post_id, created_at DESC);

-- Thread loading
CREATE INDEX idx_comments_parent
  ON comments (parent_comment_id)
  WHERE parent_comment_id IS NOT NULL;

-- Approved comments for a post
CREATE INDEX idx_comments_approved
  ON comments (post_id, ai_moderation_status)
  WHERE ai_moderation_status = 'approved' AND NOT is_deleted;

COMMENT ON TABLE  comments IS
  'Anonymous threaded comments. group_id MUST match the parent post''s group_id — '
  'enforced at the application layer during ZKP verification. This prevents '
  'cross-group pollution and ZKP group-membership correlation attacks. '
  'The external_nullifier MUST include group_id (same rule as posts) to prevent '
  'cross-group nullifier correlation.';
COMMENT ON COLUMN comments.parent_comment_id IS
  'NULL = top-level comment on the post. Non-NULL = threaded reply. '
  'ON DELETE CASCADE removes the entire reply sub-tree.';


-- ── Table 6: votes ──────────────────────────────────────────────────────────

CREATE TABLE votes (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id            UUID        REFERENCES posts(id) ON DELETE CASCADE,
  comment_id         UUID        REFERENCES comments(id) ON DELETE CASCADE,
  vote_type          TEXT        NOT NULL CHECK (vote_type IN ('upvote','downvote')),
  nullifier_hash     BYTEA       NOT NULL CHECK (octet_length(nullifier_hash) = 32),
  external_nullifier TEXT        NOT NULL,    -- "vote_post_{group_id_hex}_{id}" or "vote_comment_{group_id_hex}_{id}"
  proof_verified     BOOLEAN     NOT NULL DEFAULT FALSE,
  proof_data         JSONB,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Exactly one target must be set (exclusive belongs-to)
  CONSTRAINT chk_vote_exactly_one_target
    CHECK ((post_id IS NOT NULL)::int + (comment_id IS NOT NULL)::int = 1),

  -- One vote per user per target
  CONSTRAINT uq_vote_nullifier_scope
    UNIQUE (nullifier_hash, external_nullifier)
);

-- Find votes on a specific post or comment
CREATE INDEX idx_votes_post
  ON votes (post_id) WHERE post_id IS NOT NULL;
CREATE INDEX idx_votes_comment
  ON votes (comment_id) WHERE comment_id IS NOT NULL;

-- NOTE: Vote-count aggregate updates (upvotes/downvotes on posts/comments)
-- are handled at the application layer in a single transaction. This avoids
-- hidden cross-table UPDATEs per vote INSERT and keeps the write path explicit.

COMMENT ON TABLE  votes IS
  'Anonymous votes on posts and comments. Uses the "exclusive belongs-to" pattern: '
  'exactly one of post_id or comment_id is set (enforced by CHECK constraint), with '
  'real FK enforcement and CASCADE deletes on both. Double-voting is prevented by the '
  'nullifier_hash + external_nullifier uniqueness constraint. The external_nullifier '
  'is scoped to the specific target AND group (e.g. "vote_post_{group_id_hex}_{post_uuid}") '
  'so votes on different targets produce different nullifiers and cannot be correlated '
  'across groups. '
  'Votes are stored individually (not just counters) to allow auditing, undoing, '
  'and aggregate recomputation. Cached aggregates on posts/comments are updated '
  'at the application layer in a single transaction.';


-- ============================================================================
-- CATEGORY 3: MODERATION & ADMINISTRATION
-- ============================================================================

-- ── Table 8 (defined first – referenced by Table 7): admin_users ────────────

CREATE TABLE admin_users (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  username      TEXT        NOT NULL,
  email         CITEXT      NOT NULL,
  password_hash TEXT        NOT NULL,   -- bcrypt (~60 chars)
  role          TEXT        NOT NULL DEFAULT 'moderator'
                  CHECK (role IN ('moderator','admin','superadmin')),
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  last_login    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_admin_users_username UNIQUE (username),
  CONSTRAINT uq_admin_users_email    UNIQUE (email)
);

CREATE TRIGGER trg_admin_users_updated_at
  BEFORE UPDATE ON admin_users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE  admin_users IS
  'Platform administrators (moderators, admins, superadmins). Completely separate '
  'from anonymous platform users – these are traditional accounts with password auth. '
  'Role hierarchy: moderator < admin < superadmin.';
COMMENT ON COLUMN admin_users.password_hash IS
  'bcrypt hash. NEVER store or return plaintext passwords.';
COMMENT ON COLUMN admin_users.role IS
  'moderator = review flagged content; admin = moderate + manage credentials + revoke; '
  'superadmin = full access including admin management.';


-- ── Table 7: moderation_queue ───────────────────────────────────────────────

CREATE TABLE moderation_queue (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id               UUID          REFERENCES posts(id) ON DELETE CASCADE,
  comment_id            UUID          REFERENCES comments(id) ON DELETE CASCADE,
  ai_toxicity_score     NUMERIC(3,2)  NOT NULL CHECK (ai_toxicity_score BETWEEN 0 AND 1),
  ai_flagged_categories JSONB,
  status                TEXT          NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','approved','rejected','escalated')),
  reviewed_by_admin_id  UUID
                          REFERENCES admin_users(id) ON DELETE SET NULL,
  review_notes          TEXT,
  reviewed_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),

  -- Exactly one content target must be set (exclusive belongs-to)
  CONSTRAINT chk_modqueue_exactly_one_target
    CHECK ((post_id IS NOT NULL)::int + (comment_id IS NOT NULL)::int = 1),

  -- State consistency: reviewed → must have timestamp
  CONSTRAINT chk_modqueue_reviewed_has_timestamp
    CHECK (status = 'pending' OR reviewed_at IS NOT NULL)
);

-- Pending reviews, oldest first
CREATE INDEX idx_modqueue_pending
  ON moderation_queue (status, created_at)
  WHERE status = 'pending';

-- Look up review for a specific post or comment
CREATE INDEX idx_modqueue_post
  ON moderation_queue (post_id) WHERE post_id IS NOT NULL;
CREATE INDEX idx_modqueue_comment
  ON moderation_queue (comment_id) WHERE comment_id IS NOT NULL;

-- Reviews by a specific moderator
CREATE INDEX idx_modqueue_reviewer
  ON moderation_queue (reviewed_by_admin_id)
  WHERE reviewed_by_admin_id IS NOT NULL;

-- NOTE: Propagating moderation decisions back to posts/comments is handled
-- at the application layer (moderation service updates both tables in one
-- transaction). This keeps workflow orchestration visible and extensible
-- (e.g., adding notifications or two-phase approval).

COMMENT ON TABLE  moderation_queue IS
  'Content flagged by AI for human review. Workflow: AI scores content → score > threshold '
  '→ entry created here (status=pending) → moderator reviews → approved/rejected/escalated. '
  'Original AI scores are stored for metrics, threshold tuning, and auditing.';
COMMENT ON COLUMN moderation_queue.status IS
  'pending → (moderator reviews) → approved | rejected | escalated. '
  'Escalated = too difficult, needs senior review.';


-- ── Table 9: admin_actions (append-only audit log) ──────────────────────────

CREATE TABLE admin_actions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    UUID        REFERENCES admin_users(id) ON DELETE SET NULL,
  action_type TEXT        NOT NULL,    -- e.g. 'approve_post', 'revoke_credential'
  target_type TEXT,                    -- e.g. 'post', 'comment', 'credential'
  target_id   TEXT,                    -- UUID or commitment hash as text
  details     JSONB,                   -- structured context
  ip_address  INET,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enforce APPEND-ONLY: block UPDATE and DELETE via trigger
CREATE OR REPLACE FUNCTION prevent_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'admin_actions is an append-only audit log. UPDATE and DELETE are prohibited.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_admin_actions_no_update
  BEFORE UPDATE ON admin_actions
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();

CREATE TRIGGER trg_admin_actions_no_delete
  BEFORE DELETE ON admin_actions
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();

-- Actions by a specific admin
CREATE INDEX idx_admin_actions_admin
  ON admin_actions (admin_id, created_at DESC);

-- Actions of a specific type
CREATE INDEX idx_admin_actions_type
  ON admin_actions (action_type, created_at DESC);

-- Recent activity
CREATE INDEX idx_admin_actions_recent
  ON admin_actions (created_at DESC);

COMMENT ON TABLE  admin_actions IS
  'Immutable, append-only audit log of every admin action. UPDATE and DELETE are '
  'blocked by trigger to ensure admins cannot cover their tracks. Retained '
  'indefinitely for compliance. Even if the admin account is later deleted, the '
  'log entry persists (admin_id becomes NULL via ON DELETE SET NULL).';
COMMENT ON COLUMN admin_actions.action_type IS
  'Free-form action label: approve_post, reject_post, revoke_credential, '
  'delete_comment, create_admin, change_role, etc.';
COMMENT ON COLUMN admin_actions.target_id IS
  'TEXT so it can hold UUIDs, commitment hashes, usernames, etc.';


-- ============================================================================
-- CATEGORY 4: ANALYTICS & ONBOARDING
-- ============================================================================

-- ── Table 10: analytics_daily_snapshots ─────────────────────────────────────

CREATE TABLE analytics_daily_snapshots (
  id                       UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id                 BYTEA         NOT NULL
                             REFERENCES semaphore_groups(group_id) ON DELETE CASCADE,
  date                     DATE          NOT NULL,
  total_posts              INTEGER       NOT NULL DEFAULT 0 CHECK (total_posts           >= 0),
  total_comments           INTEGER       NOT NULL DEFAULT 0 CHECK (total_comments         >= 0),
  total_votes              INTEGER       NOT NULL DEFAULT 0 CHECK (total_votes            >= 0),
  avg_toxicity_score       NUMERIC(3,2)
                             CHECK (avg_toxicity_score IS NULL OR avg_toxicity_score BETWEEN 0 AND 1),
  flagged_content_count    INTEGER       NOT NULL DEFAULT 0 CHECK (flagged_content_count  >= 0),
  active_members_estimate  INTEGER
                             CHECK (active_members_estimate IS NULL OR active_members_estimate >= 0),
  sentiment_positive_pct   NUMERIC(5,2)
                             CHECK (sentiment_positive_pct IS NULL OR sentiment_positive_pct BETWEEN 0 AND 100),
  top_topics               JSONB,
  created_at               TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT uq_analytics_group_date UNIQUE (group_id, date)
);

-- NOTE: (group_id, date) index intentionally omitted — already covered by
-- uq_analytics_group_date UNIQUE constraint (PG B-trees scan both directions).

-- Latest snapshots across all groups
CREATE INDEX idx_analytics_date
  ON analytics_daily_snapshots (date DESC);

COMMENT ON TABLE  analytics_daily_snapshots IS
  'Pre-aggregated daily statistics per group. Avoids expensive real-time COUNT queries. '
  'Generated by a nightly batch job. Privacy: stats are only exposed when '
  'active_members_estimate >= k (k-anonymity threshold, typically k=5) to prevent '
  'de-anonymisation in small groups.';
COMMENT ON COLUMN analytics_daily_snapshots.active_members_estimate IS
  'Estimated distinct active members (from COUNT(DISTINCT nullifier_hash)). '
  'An estimate because different nullifier scopes make exact counting impossible. '
  'Used as k-anonymity gate: hide stats if value < 5.';
COMMENT ON COLUMN analytics_daily_snapshots.sentiment_positive_pct IS
  'Percentage of content with toxicity_score < 0.3. Range 0.00–100.00.';


-- ── Table 11: credential_issuance_requests (onboarding schema) ──────────────

CREATE TABLE onboarding.credential_issuance_requests (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id            UUID        NOT NULL DEFAULT gen_random_uuid(),
  email                 CITEXT      NOT NULL,
  student_id            TEXT,
  group_id              BYTEA       NOT NULL
                          REFERENCES public.semaphore_groups(group_id) ON DELETE CASCADE,
  status                TEXT        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','approved','rejected','issued')),
  identity_commitment   BYTEA
                          CHECK (identity_commitment IS NULL OR octet_length(identity_commitment) = 32),
  approved_by_admin_id  UUID
                          REFERENCES public.admin_users(id) ON DELETE SET NULL,
  rejection_reason      TEXT,
  issued_at             TIMESTAMPTZ,
  purge_after           TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '90 days'),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_credential_request_id UNIQUE (request_id),

  -- Issued → commitment and timestamp are required
  CONSTRAINT chk_issued_has_commitment_and_timestamp
    CHECK (status != 'issued' OR (identity_commitment IS NOT NULL AND issued_at IS NOT NULL)),

  -- Rejected → reason is required
  CONSTRAINT chk_rejected_has_reason
    CHECK (status != 'rejected' OR rejection_reason IS NOT NULL)
);

CREATE TRIGGER trg_credential_requests_updated_at
  BEFORE UPDATE ON onboarding.credential_issuance_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Admin queue: pending requests
CREATE INDEX idx_credential_requests_pending
  ON onboarding.credential_issuance_requests (status, created_at)
  WHERE status = 'pending';

-- Duplicate email check
CREATE INDEX idx_credential_requests_email
  ON onboarding.credential_issuance_requests (email);

-- Purge job target
CREATE INDEX idx_credential_requests_purge
  ON onboarding.credential_issuance_requests (purge_after)
  WHERE purge_after IS NOT NULL;

-- ── Row-Level Security ──────────────────────────────────────────────────────

ALTER TABLE onboarding.credential_issuance_requests ENABLE ROW LEVEL SECURITY;

-- Revoke everything from public; grant only to admin role
REVOKE ALL ON onboarding.credential_issuance_requests FROM PUBLIC;

-- These GRANT / POLICY statements use roles that must be created by the DBA
-- before the application connects.  Uncomment and adjust to match your setup:
--
-- GRANT SELECT, INSERT, UPDATE ON onboarding.credential_issuance_requests TO app_admin;
-- GRANT SELECT, INSERT, UPDATE ON onboarding.credential_issuance_requests TO app_backend;
--
-- CREATE POLICY admin_full_access
--   ON onboarding.credential_issuance_requests
--   FOR ALL
--   USING (current_setting('app.role') = 'admin');

-- ── Auto-purge function (called by pg_cron or application scheduler) ────────

CREATE OR REPLACE FUNCTION onboarding.purge_expired_credential_requests()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM onboarding.credential_issuance_requests
   WHERE purge_after < now();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Restrict EXECUTE on this SECURITY DEFINER function to avoid PUBLIC running
-- privileged deletes on onboarding.credential_issuance_requests.
REVOKE EXECUTE ON FUNCTION onboarding.purge_expired_credential_requests() FROM PUBLIC;

COMMENT ON TABLE  onboarding.credential_issuance_requests IS
  'ISOLATED in the onboarding schema. The ONLY place where real identities (email) '
  'temporarily link to cryptographic commitments. MUST NEVER be joined with content '
  'tables. Auto-purged after 90 days to destroy the identity↔commitment link forever. '
  'Protected by Row-Level Security: only admin roles can access.';
COMMENT ON COLUMN onboarding.credential_issuance_requests.email IS
  'University email – the sensitive linkage between real identity and commitment. '
  'Purged after 90 days to limit exposure window.';
COMMENT ON COLUMN onboarding.credential_issuance_requests.purge_after IS
  'Defaults to now() + 90 days. The purge_expired_credential_requests() function '
  'deletes rows past this date, permanently destroying the identity link.';
COMMENT ON FUNCTION onboarding.purge_expired_credential_requests() IS
  'Deletes expired credential issuance requests. Should be scheduled via pg_cron '
  'or application-level cron. Returns the number of purged rows.';


-- ── Table 12: ai_model_versions ─────────────────────────────────────────────

CREATE TABLE ai_model_versions (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  model_name         TEXT        NOT NULL,
  version            TEXT        NOT NULL,
  description        TEXT,
  threshold_toxicity NUMERIC(3,2) NOT NULL DEFAULT 0.70
                       CHECK (threshold_toxicity BETWEEN 0 AND 1),
  is_active          BOOLEAN     NOT NULL DEFAULT TRUE,
  activated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deactivated_at     TIMESTAMPTZ,

  -- One version string per model
  CONSTRAINT uq_ai_model_version UNIQUE (model_name, version)
);

-- Enforce at most ONE active version per model_name
CREATE UNIQUE INDEX idx_ai_model_active
  ON ai_model_versions (model_name) WHERE is_active = TRUE;

COMMENT ON TABLE  ai_model_versions IS
  'Registry of AI moderation models and versions. Enables reproducibility, '
  'A/B testing, and debugging. The partial unique index on (model_name) WHERE '
  'is_active=true enforces that only one version per model can be active.';
COMMENT ON COLUMN ai_model_versions.threshold_toxicity IS
  'Score threshold for flagging content: toxicity_score >= threshold → flag. '
  'Different models may use different thresholds.';
COMMENT ON COLUMN ai_model_versions.is_active IS
  'Only one version per model_name may be active at any time (enforced by '
  'partial unique index). Deployment: old.is_active=false, new.is_active=true.';


-- ── Seed data ───────────────────────────────────────────────────────────────

INSERT INTO ai_model_versions (model_name, version, description, threshold_toxicity, is_active)
VALUES
  ('perspective-api', 'v1', 'Google Perspective API – production', 0.70, TRUE),
  ('detoxify',        'v0.5', 'Detoxify multilingual model',      0.75, FALSE);


-- ============================================================================
-- UTILITY VIEWS (for debugging – wrap BYTEA in hex for readability)
-- ============================================================================

CREATE OR REPLACE VIEW v_semaphore_groups AS
SELECT id,
       encode(group_id, 'hex')    AS group_id_hex,
       name,
       depth,
       encode(zero_value, 'hex')  AS zero_value_hex,
       created_at
  FROM semaphore_groups;

CREATE OR REPLACE VIEW v_semaphore_members AS
SELECT id,
       encode(group_id, 'hex')             AS group_id_hex,
       encode(identity_commitment, 'hex')  AS commitment_hex,
       leaf_index,
       is_revoked,
       created_at
  FROM semaphore_members;

COMMENT ON VIEW v_semaphore_groups IS
  'Debug view: renders BYTEA columns as hex strings for human readability.';
COMMENT ON VIEW v_semaphore_members IS
  'Debug view: renders BYTEA columns as hex strings for human readability.';


-- ============================================================================
-- DONE
-- ============================================================================
