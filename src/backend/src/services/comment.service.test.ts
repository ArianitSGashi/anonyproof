import { describe, it, expect, vi, beforeEach } from "vitest";
import { CommentService } from "./comment.service.js";
import type { SemaphoreService, SemaphoreProof } from "./semaphore.service.js";
import type { MerkleService } from "./merkle.service.js";

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
  orderBy: vi.fn().mockReturnThis(),
  updateTable: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
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
    scope: "comment:post-uuid-1:" + "aa".repeat(32),
    points: ["1", "2", "3", "4", "5", "6", "7", "8"],
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("CommentService", () => {
  let commentService: CommentService;
  let mockSemaphoreService: {
    buildExternalNullifier: ReturnType<typeof vi.fn>;
    verifyProof: ReturnType<typeof vi.fn>;
    extractNullifierHash: ReturnType<typeof vi.fn>;
    isNullifierUsed: ReturnType<typeof vi.fn>;
  };
  let mockMerkleService: { getRoot: ReturnType<typeof vi.fn> };

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
    mockQueryBuilder.orderBy = vi.fn().mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.updateTable = vi.fn().mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.set = vi.fn().mockReturnValue(mockQueryBuilder);

    mockSemaphoreService = {
      buildExternalNullifier: vi
        .fn()
        .mockReturnValue("comment:post-uuid-1:" + "aa".repeat(32)),
      verifyProof: vi.fn().mockResolvedValue(true),
      extractNullifierHash: vi.fn().mockReturnValue(nullifierHash),
      isNullifierUsed: vi.fn().mockResolvedValue(false),
    };

    mockMerkleService = {
      getRoot: vi.fn().mockResolvedValue(Buffer.alloc(32, 0xcc)),
    };

    commentService = new CommentService(
      mockSemaphoreService as unknown as SemaphoreService,
      mockMerkleService as unknown as MerkleService
    );
  });

  describe("createComment", () => {
    it("creates a top-level comment with valid proof", async () => {
      // Mock: post exists
      mockExecuteTakeFirst.mockResolvedValueOnce({
        id: "post-uuid-1",
        group_id: groupId,
        is_deleted: false,
      });

      const mockComment = {
        id: "comment-uuid-1",
        post_id: "post-uuid-1",
        parent_comment_id: null,
        group_id: groupId,
        content: "Great post!",
        nullifier_hash: nullifierHash,
        external_nullifier: "comment:post-uuid-1:" + "aa".repeat(32),
        proof_verified: true,
        proof_data: {},
        ai_moderation_status: "pending",
        upvotes: 0,
        downvotes: 0,
        vote_score: 0,
        is_deleted: false,
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockExecuteTakeFirstOrThrow.mockResolvedValueOnce(mockComment);

      const result = await commentService.createComment({
        postId: "post-uuid-1",
        content: "Great post!",
        proof: makeMockProof(),
      });

      expect(result.id).toBe("comment-uuid-1");
      expect(result.content).toBe("Great post!");
      expect(mockSemaphoreService.verifyProof).toHaveBeenCalled();
      expect(mockQueryBuilder.insertInto).toHaveBeenCalledWith("comments");
    });

    it("creates a threaded reply with valid parent", async () => {
      // Mock: post exists
      mockExecuteTakeFirst
        .mockResolvedValueOnce({
          id: "post-uuid-1",
          group_id: groupId,
          is_deleted: false,
        })
        // Mock: parent comment exists
        .mockResolvedValueOnce({
          id: "comment-uuid-1",
          post_id: "post-uuid-1",
          is_deleted: false,
        });

      const mockComment = {
        id: "comment-uuid-2",
        post_id: "post-uuid-1",
        parent_comment_id: "comment-uuid-1",
        group_id: groupId,
        content: "I agree!",
        nullifier_hash: nullifierHash,
        external_nullifier: "comment:post-uuid-1:" + "aa".repeat(32),
        proof_verified: true,
        proof_data: {},
        ai_moderation_status: "pending",
        upvotes: 0,
        downvotes: 0,
        vote_score: 0,
        is_deleted: false,
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockExecuteTakeFirstOrThrow.mockResolvedValueOnce(mockComment);

      const result = await commentService.createComment({
        postId: "post-uuid-1",
        parentCommentId: "comment-uuid-1",
        content: "I agree!",
        proof: makeMockProof(),
      });

      expect(result.parent_comment_id).toBe("comment-uuid-1");
    });

    it("throws NotFoundError when post does not exist", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce(undefined);

      await expect(
        commentService.createComment({
          postId: "nonexistent",
          content: "test",
          proof: makeMockProof(),
        })
      ).rejects.toThrow("Post not found");
    });

    it("throws NotFoundError when post is deleted", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce({
        id: "post-uuid-1",
        group_id: groupId,
        is_deleted: true,
      });

      await expect(
        commentService.createComment({
          postId: "post-uuid-1",
          content: "test",
          proof: makeMockProof(),
        })
      ).rejects.toThrow("Post not found");
    });

    it("throws NotFoundError when parent comment not found", async () => {
      // Post exists
      mockExecuteTakeFirst
        .mockResolvedValueOnce({
          id: "post-uuid-1",
          group_id: groupId,
          is_deleted: false,
        })
        // Parent not found
        .mockResolvedValueOnce(undefined);

      await expect(
        commentService.createComment({
          postId: "post-uuid-1",
          parentCommentId: "nonexistent",
          content: "test",
          proof: makeMockProof(),
        })
      ).rejects.toThrow("Parent comment not found");
    });

    it("throws BadRequestError when parent comment belongs to different post", async () => {
      // Post exists
      mockExecuteTakeFirst
        .mockResolvedValueOnce({
          id: "post-uuid-1",
          group_id: groupId,
          is_deleted: false,
        })
        // Parent exists but different post
        .mockResolvedValueOnce({
          id: "comment-uuid-1",
          post_id: "different-post",
          is_deleted: false,
        });

      await expect(
        commentService.createComment({
          postId: "post-uuid-1",
          parentCommentId: "comment-uuid-1",
          content: "test",
          proof: makeMockProof(),
        })
      ).rejects.toThrow("Parent comment does not belong to the specified post");
    });

    it("throws BadRequestError on invalid proof", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce({
        id: "post-uuid-1",
        group_id: groupId,
        is_deleted: false,
      });
      mockSemaphoreService.verifyProof.mockResolvedValueOnce(false);

      await expect(
        commentService.createComment({
          postId: "post-uuid-1",
          content: "test",
          proof: makeMockProof(),
        })
      ).rejects.toThrow("Invalid ZK proof");
    });

    it("throws ConflictError on duplicate nullifier", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce({
        id: "post-uuid-1",
        group_id: groupId,
        is_deleted: false,
      });
      mockSemaphoreService.isNullifierUsed.mockResolvedValueOnce(true);

      await expect(
        commentService.createComment({
          postId: "post-uuid-1",
          content: "test",
          proof: makeMockProof(),
        })
      ).rejects.toThrow("Nullifier already used");
    });
  });

  describe("getPostComments", () => {
    it("returns comments for a valid post", async () => {
      // Post exists
      mockExecuteTakeFirst.mockResolvedValueOnce({ id: "post-uuid-1" });
      // Comments
      mockExecute.mockResolvedValueOnce([
        { id: "c1", post_id: "post-uuid-1", content: "First" },
        { id: "c2", post_id: "post-uuid-1", content: "Second" },
      ]);

      const result = await commentService.getPostComments("post-uuid-1");
      expect(result).toHaveLength(2);
    });

    it("throws NotFoundError when post does not exist", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce(undefined);

      await expect(
        commentService.getPostComments("nonexistent")
      ).rejects.toThrow("Post not found");
    });
  });

  describe("getComment", () => {
    it("returns a comment when found", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce({
        id: "comment-uuid-1",
        content: "Hello",
      });

      const result = await commentService.getComment("comment-uuid-1");
      expect(result.id).toBe("comment-uuid-1");
    });

    it("throws NotFoundError when comment does not exist", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce(undefined);

      await expect(
        commentService.getComment("nonexistent")
      ).rejects.toThrow("Comment not found");
    });
  });

  describe("softDeleteComment", () => {
    it("soft-deletes an existing comment", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce({ numUpdatedRows: 1n });

      await expect(
        commentService.softDeleteComment("comment-uuid-1")
      ).resolves.toBeUndefined();
    });

    it("throws NotFoundError when comment not found", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce({ numUpdatedRows: 0n });

      await expect(
        commentService.softDeleteComment("nonexistent")
      ).rejects.toThrow("Comment not found or already deleted");
    });
  });
});
