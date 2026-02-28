import { describe, it, expect, vi, beforeEach } from "vitest";
import { PostService } from "./post.service.js";
import type { SemaphoreService, SemaphoreProof } from "./semaphore.service.js";
import type { MerkleService } from "./merkle.service.js";
import type { GroupService } from "./group.service.js";

// ─── Mock DB ──────────────────────────────────────────────────────────────────

const mockExecuteTakeFirstOrThrow = vi.fn();
const mockExecuteTakeFirst = vi.fn();
const mockExecute = vi.fn();

const mockQueryBuilder = {
  insertInto: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returningAll: vi.fn().mockReturnThis(),
  selectFrom: vi.fn().mockReturnThis(),
  selectAll: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  whereRef: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  offset: vi.fn().mockReturnThis(),
  updateTable: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  fn: {
    countAll: vi.fn().mockReturnValue({
      as: vi.fn().mockReturnValue("count"),
    }),
  },
  as: vi.fn().mockReturnValue("comment_count"),
  executeTakeFirstOrThrow: mockExecuteTakeFirstOrThrow,
  executeTakeFirst: mockExecuteTakeFirst,
  execute: mockExecute,
};

vi.mock("../db/index.js", () => ({
  getDb: () => mockQueryBuilder,
}));

// ─── Mock Proof ──────────────────────────────────────────────────────────────

function makeMockProof(): SemaphoreProof {
  return {
    merkleTreeDepth: 20,
    merkleTreeRoot: "12345",
    message: "0",
    nullifier: "67890",
    scope: "post:" + "aa".repeat(32),
    points: ["1", "2", "3", "4", "5", "6", "7", "8"],
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("PostService", () => {
  let postService: PostService;
  let mockSemaphoreService: {
    buildExternalNullifier: ReturnType<typeof vi.fn>;
    verifyProof: ReturnType<typeof vi.fn>;
    extractNullifierHash: ReturnType<typeof vi.fn>;
    isNullifierUsed: ReturnType<typeof vi.fn>;
  };
  let mockMerkleService: { getRoot: ReturnType<typeof vi.fn> };
  let mockGroupService: { getGroup: ReturnType<typeof vi.fn> };

  const groupId = Buffer.alloc(32, 0xaa);
  const nullifierHash = Buffer.alloc(32, 0xbb);

  beforeEach(() => {
    vi.clearAllMocks();

    // Re-wire mock chain
    mockQueryBuilder.insertInto = vi.fn().mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.values = vi.fn().mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.returningAll = vi.fn().mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.selectFrom = vi.fn().mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.selectAll = vi.fn().mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.select = vi.fn().mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.where = vi.fn().mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.whereRef = vi.fn().mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.orderBy = vi.fn().mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.limit = vi.fn().mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.offset = vi.fn().mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.updateTable = vi.fn().mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.set = vi.fn().mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.as = vi.fn().mockReturnValue("comment_count");

    mockSemaphoreService = {
      buildExternalNullifier: vi.fn().mockReturnValue("post:" + "aa".repeat(32)),
      verifyProof: vi.fn().mockResolvedValue(true),
      extractNullifierHash: vi.fn().mockReturnValue(nullifierHash),
      isNullifierUsed: vi.fn().mockResolvedValue(false),
    };

    mockMerkleService = {
      getRoot: vi.fn().mockResolvedValue(Buffer.alloc(32, 0xcc)),
    };

    mockGroupService = {
      getGroup: vi.fn().mockResolvedValue({
        id: "uuid-1",
        group_id: groupId,
        name: "Test",
        depth: 20,
      }),
    };

    postService = new PostService(
      mockSemaphoreService as unknown as SemaphoreService,
      mockMerkleService as unknown as MerkleService,
      mockGroupService as unknown as GroupService
    );
  });

  describe("createPost", () => {
    it("creates a post with valid proof", async () => {
      const mockPost = {
        id: "post-uuid-1",
        group_id: groupId,
        content: "Hello anonymous world!",
        nullifier_hash: nullifierHash,
        external_nullifier: "post:" + "aa".repeat(32),
        proof_verified: true,
        proof_data: {},
        ai_moderation_status: "pending",
        ai_toxicity_score: null,
        ai_moderation_categories: null,
        moderated_at: null,
        moderation_model_version: null,
        upvotes: 0,
        downvotes: 0,
        vote_score: 0,
        is_deleted: false,
        deleted_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockExecuteTakeFirstOrThrow.mockResolvedValueOnce(mockPost);

      const result = await postService.createPost({
        groupId,
        content: "Hello anonymous world!",
        proof: makeMockProof(),
      });

      expect(result.id).toBe("post-uuid-1");
      expect(result.content).toBe("Hello anonymous world!");
      expect(mockGroupService.getGroup).toHaveBeenCalledWith(groupId);
      expect(mockSemaphoreService.verifyProof).toHaveBeenCalled();
      expect(mockSemaphoreService.isNullifierUsed).toHaveBeenCalledWith(
        nullifierHash,
        "post:" + "aa".repeat(32)
      );
      expect(mockQueryBuilder.insertInto).toHaveBeenCalledWith("posts");
    });

    it("throws BadRequestError on invalid proof", async () => {
      mockSemaphoreService.verifyProof.mockResolvedValueOnce(false);

      await expect(
        postService.createPost({
          groupId,
          content: "test",
          proof: makeMockProof(),
        })
      ).rejects.toThrow("Invalid ZK proof");
    });

    it("throws ConflictError on duplicate nullifier", async () => {
      mockSemaphoreService.isNullifierUsed.mockResolvedValueOnce(true);

      await expect(
        postService.createPost({
          groupId,
          content: "test",
          proof: makeMockProof(),
        })
      ).rejects.toThrow("Nullifier already used");
    });

    it("throws NotFoundError when group does not exist", async () => {
      mockGroupService.getGroup.mockRejectedValueOnce(
        new Error("Group not found")
      );

      await expect(
        postService.createPost({
          groupId,
          content: "test",
          proof: makeMockProof(),
        })
      ).rejects.toThrow("Group not found");
    });
  });

  describe("getPost", () => {
    it("returns a post with comment count", async () => {
      const mockPost = {
        id: "post-uuid-1",
        group_id: groupId,
        content: "Hello!",
        ai_moderation_status: "approved",
        upvotes: 5,
        downvotes: 1,
        vote_score: 4,
        is_deleted: false,
        comment_count: 3,
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockExecuteTakeFirst.mockResolvedValueOnce(mockPost);

      const result = await postService.getPost("post-uuid-1");
      expect(result.id).toBe("post-uuid-1");
      expect(result.comment_count).toBe(3);
    });

    it("throws NotFoundError when post does not exist", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce(undefined);

      await expect(postService.getPost("nonexistent")).rejects.toThrow(
        "Post not found"
      );
    });
  });

  describe("listGroupPosts", () => {
    it("returns paginated posts", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce({ total: 2 });
      mockExecute.mockResolvedValueOnce([
        {
          id: "p1",
          group_id: groupId,
          content: "Post 1",
          comment_count: 1,
          created_at: new Date(),
        },
        {
          id: "p2",
          group_id: groupId,
          content: "Post 2",
          comment_count: 0,
          created_at: new Date(),
        },
      ]);

      const result = await postService.listGroupPosts(groupId, 1, 20);
      expect(result.total).toBe(2);
      expect(result.posts).toHaveLength(2);
    });

    it("returns empty list when no posts", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce({ total: 0 });
      mockExecute.mockResolvedValueOnce([]);

      const result = await postService.listGroupPosts(groupId, 1, 20);
      expect(result.total).toBe(0);
      expect(result.posts).toHaveLength(0);
    });
  });

  describe("softDeletePost", () => {
    it("soft-deletes an existing post", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce({ numUpdatedRows: 1n });

      await expect(
        postService.softDeletePost("post-uuid-1")
      ).resolves.toBeUndefined();

      expect(mockQueryBuilder.updateTable).toHaveBeenCalledWith("posts");
    });

    it("throws NotFoundError when post not found or already deleted", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce({ numUpdatedRows: 0n });

      await expect(
        postService.softDeletePost("nonexistent")
      ).rejects.toThrow("Post not found or already deleted");
    });
  });
});
