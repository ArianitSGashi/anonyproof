/**
 * Compile-time type tests for the Database interface.
 *
 * These tests verify that Kysely's type helpers (Selectable, Insertable, Updateable)
 * produce the correct shapes for each table. The tests are assertions that only
 * need to COMPILE — if TypeScript accepts them, the types are correct.
 *
 * Runtime tests use `expect(true).toBe(true)` as a no-op; the real validation
 * is done by the TypeScript compiler during `tsc --noEmit`.
 */

import { describe, it, expect, expectTypeOf } from "vitest";
import type { Kysely } from "kysely";
import type {
  Database,
  // Enum types
  ModerationStatus,
  VoteType,
  AdminRole,
  ModerationQueueStatus,
  CredentialRequestStatus,
  JsonValue,
  // Selectable aliases
  SemaphoreGroup,
  Post,
  Vote,
  AdminUser,
  CredentialIssuanceRequest,
  // Insertable aliases
  NewSemaphoreGroup,
  NewSemaphoreMember,
  NewPost,
  NewVote,
  NewAdminAction,
  NewCredentialIssuanceRequest,
  // Updateable aliases
  PostUpdate,
  SemaphoreMemberUpdate,
  AdminUserUpdate,
  CredentialIssuanceRequestUpdate,
} from "./database.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Compile-time assertion: value is assignable to type T.
 * If this compiles, the type is correct.
 */
function assertType<T>(_value: T): void {
  // Intentionally empty — compile-time only
}

describe("Database type definitions", () => {
  // ─── Enum types ──────────────────────────────────────────────────────

  describe("enum types", () => {
    it("ModerationStatus has correct values", () => {
      const statuses: ModerationStatus[] = [
        "pending",
        "approved",
        "flagged",
        "rejected",
      ];
      expect(statuses).toHaveLength(4);
    });

    it("VoteType has correct values", () => {
      const types: VoteType[] = ["upvote", "downvote"];
      expect(types).toHaveLength(2);
    });

    it("AdminRole has correct values", () => {
      const roles: AdminRole[] = ["moderator", "admin", "superadmin"];
      expect(roles).toHaveLength(3);
    });

    it("ModerationQueueStatus has correct values", () => {
      const statuses: ModerationQueueStatus[] = [
        "pending",
        "approved",
        "rejected",
        "escalated",
      ];
      expect(statuses).toHaveLength(4);
    });

    it("CredentialRequestStatus has correct values", () => {
      const statuses: CredentialRequestStatus[] = [
        "pending",
        "approved",
        "rejected",
        "issued",
      ];
      expect(statuses).toHaveLength(4);
    });
  });

  // ─── Selectable types (SELECT shape) ─────────────────────────────────

  describe("Selectable types", () => {
    it("SemaphoreGroup has correct field types", () => {
      expectTypeOf<SemaphoreGroup>().toHaveProperty("id").toBeString();
      expectTypeOf<SemaphoreGroup>().toHaveProperty("group_id").toEqualTypeOf<Buffer>();
      expectTypeOf<SemaphoreGroup>().toHaveProperty("name").toBeString();
      expectTypeOf<SemaphoreGroup>().toHaveProperty("description").toEqualTypeOf<string | null>();
      expectTypeOf<SemaphoreGroup>().toHaveProperty("depth").toBeNumber();
      expectTypeOf<SemaphoreGroup>().toHaveProperty("zero_value").toEqualTypeOf<Buffer>();
      expectTypeOf<SemaphoreGroup>().toHaveProperty("created_at").toEqualTypeOf<Date>();
      expectTypeOf<SemaphoreGroup>().toHaveProperty("updated_at").toEqualTypeOf<Date>();
    });

    it("Post has BYTEA fields as Buffer", () => {
      expectTypeOf<Post>().toHaveProperty("group_id").toEqualTypeOf<Buffer>();
      expectTypeOf<Post>().toHaveProperty("nullifier_hash").toEqualTypeOf<Buffer>();
    });

    it("Post has Generated fields resolved to plain types", () => {
      expectTypeOf<Post>().toHaveProperty("id").toBeString();
      expectTypeOf<Post>().toHaveProperty("proof_verified").toBeBoolean();
      expectTypeOf<Post>().toHaveProperty("upvotes").toBeNumber();
      expectTypeOf<Post>().toHaveProperty("vote_score").toBeNumber();
      expectTypeOf<Post>().toHaveProperty("ai_moderation_status").toEqualTypeOf<ModerationStatus>();
    });

    it("Post has nullable fields as T | null", () => {
      expectTypeOf<Post>().toHaveProperty("proof_data").toEqualTypeOf<JsonValue | null>();
      expectTypeOf<Post>().toHaveProperty("ai_toxicity_score").toEqualTypeOf<number | null>();
      expectTypeOf<Post>().toHaveProperty("deleted_at").toEqualTypeOf<Date | null>();
    });

    it("Vote has exclusive belongs-to fields", () => {
      expectTypeOf<Vote>().toHaveProperty("post_id").toEqualTypeOf<string | null>();
      expectTypeOf<Vote>().toHaveProperty("comment_id").toEqualTypeOf<string | null>();
      expectTypeOf<Vote>().toHaveProperty("vote_type").toEqualTypeOf<VoteType>();
    });

    it("AdminUser has correct field types", () => {
      expectTypeOf<AdminUser>().toHaveProperty("role").toEqualTypeOf<AdminRole>();
      expectTypeOf<AdminUser>().toHaveProperty("is_active").toBeBoolean();
      expectTypeOf<AdminUser>().toHaveProperty("password_hash").toBeString();
    });

    it("CredentialIssuanceRequest has blind signature fields", () => {
      expectTypeOf<CredentialIssuanceRequest>()
        .toHaveProperty("blind_signature")
        .toEqualTypeOf<Buffer | null>();
      expectTypeOf<CredentialIssuanceRequest>()
        .toHaveProperty("server_key_hash")
        .toEqualTypeOf<Buffer | null>();
      expectTypeOf<CredentialIssuanceRequest>()
        .toHaveProperty("status")
        .toEqualTypeOf<CredentialRequestStatus>();
    });
  });

  // ─── Insertable types (INSERT shape) ──────────────────────────────────

  describe("Insertable types", () => {
    it("NewSemaphoreGroup requires name, group_id, depth, zero_value", () => {
      // Minimal valid insert: Generated fields (id, created_at, updated_at) are optional
      const insert: NewSemaphoreGroup = {
        group_id: Buffer.alloc(32),
        name: "Test Group",
        depth: 20,
        zero_value: Buffer.alloc(32),
      };
      assertType<NewSemaphoreGroup>(insert);
      expect(true).toBe(true);
    });

    it("NewSemaphoreGroup allows optional description", () => {
      const insert: NewSemaphoreGroup = {
        group_id: Buffer.alloc(32),
        name: "Test Group",
        depth: 20,
        zero_value: Buffer.alloc(32),
        description: "A test group",
      };
      assertType<NewSemaphoreGroup>(insert);
      expect(true).toBe(true);
    });

    it("NewSemaphoreMember requires group_id, identity_commitment, leaf_index", () => {
      const insert: NewSemaphoreMember = {
        group_id: Buffer.alloc(32),
        identity_commitment: Buffer.alloc(32),
        leaf_index: 0,
      };
      assertType<NewSemaphoreMember>(insert);
      expect(true).toBe(true);
    });

    it("NewPost requires content fields and ZKP fields", () => {
      const insert: NewPost = {
        group_id: Buffer.alloc(32),
        content: "Hello world",
        nullifier_hash: Buffer.alloc(32),
        external_nullifier: "post_creation_abc_2024-01-01",
      };
      assertType<NewPost>(insert);
      expect(true).toBe(true);
    });

    it("NewPost does NOT require vote_score (GeneratedAlways)", () => {
      // vote_score is GENERATED ALWAYS AS — should be absent from inserts
      const insert: NewPost = {
        group_id: Buffer.alloc(32),
        content: "Test",
        nullifier_hash: Buffer.alloc(32),
        external_nullifier: "scope",
      };
      // @ts-expect-error — vote_score should not be assignable on insert
      const _bad: NewPost = { ...insert, vote_score: 5 };
      expect(true).toBe(true);
    });

    it("NewVote requires vote_type, nullifier_hash, external_nullifier", () => {
      const postVote: NewVote = {
        post_id: "uuid",
        vote_type: "upvote",
        nullifier_hash: Buffer.alloc(32),
        external_nullifier: "vote_post_abc_uuid",
      };
      assertType<NewVote>(postVote);
      expect(true).toBe(true);
    });

    it("NewAdminAction only requires action_type", () => {
      // All other fields are Generated (nullable → optional on insert)
      const insert: NewAdminAction = {
        action_type: "test_action",
      };
      assertType<NewAdminAction>(insert);
      expect(true).toBe(true);
    });

    it("NewAdminAction accepts all optional fields", () => {
      const insert: NewAdminAction = {
        admin_id: "uuid",
        action_type: "approve_post",
        target_type: "post",
        target_id: "uuid",
        details: { note: "approved" },
        ip_address: "127.0.0.1",
      };
      assertType<NewAdminAction>(insert);
      expect(true).toBe(true);
    });

    it("NewCredentialIssuanceRequest requires email and group_id only", () => {
      const insert: NewCredentialIssuanceRequest = {
        email: "student@university.edu",
        group_id: Buffer.alloc(32),
      };
      assertType<NewCredentialIssuanceRequest>(insert);
      expect(true).toBe(true);
    });
  });

  // ─── Updateable types (UPDATE shape) ──────────────────────────────────

  describe("Updateable types", () => {
    it("PostUpdate allows partial updates", () => {
      // All fields are optional in updates
      const update: PostUpdate = { content: "Updated content" };
      assertType<PostUpdate>(update);
      expect(true).toBe(true);
    });

    it("PostUpdate does NOT allow vote_score (GeneratedAlways)", () => {
      // @ts-expect-error — vote_score is GENERATED ALWAYS
      const _bad: PostUpdate = { vote_score: 10 };
      expect(true).toBe(true);
    });

    it("SemaphoreMemberUpdate allows revoking", () => {
      const update: SemaphoreMemberUpdate = {
        is_revoked: true,
        revoked_at: new Date(),
        revoked_reason: "Policy violation",
      };
      assertType<SemaphoreMemberUpdate>(update);
      expect(true).toBe(true);
    });

    it("AdminUserUpdate allows role change", () => {
      const update: AdminUserUpdate = { role: "admin" };
      assertType<AdminUserUpdate>(update);
      expect(true).toBe(true);
    });

    it("CredentialIssuanceRequestUpdate allows status transitions", () => {
      const approve: CredentialIssuanceRequestUpdate = {
        status: "approved",
        approved_by_admin_id: "admin-uuid",
        blind_signature: Buffer.alloc(256),
      };
      assertType<CredentialIssuanceRequestUpdate>(approve);
      expect(true).toBe(true);
    });
  });

  // ─── Database interface shape ──────────────────────────────────────────

  describe("Database interface", () => {
    it("has all 12 table keys", () => {
      type DbKeys = keyof Database;
      const keys: DbKeys[] = [
        "semaphore_groups",
        "semaphore_members",
        "merkle_tree_nodes",
        "posts",
        "comments",
        "votes",
        "admin_users",
        "moderation_queue",
        "admin_actions",
        "analytics_daily_snapshots",
        "credential_issuance_requests",
        "ai_model_versions",
      ];
      expect(keys).toHaveLength(12);
    });

    it("Kysely<Database> infers correct selectFrom tables", () => {
      // This is a pure type-level test — no runtime Kysely instance needed
      type SelectableTables = Parameters<Kysely<Database>["selectFrom"]>[0];

      // These should be valid table references
      assertType<SelectableTables>("semaphore_groups" as const);
      assertType<SelectableTables>("posts" as const);
      assertType<SelectableTables>("credential_issuance_requests" as const);
      expect(true).toBe(true);
    });
  });
});
