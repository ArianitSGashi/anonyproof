import { describe, it, expect, vi, beforeEach } from "vitest";
import { VoteService } from "./vote.service.js";
import type { SemaphoreService, SemaphoreProof } from "./semaphore.service.js";
import type { MerkleService } from "./merkle.service.js";

// ─── Mock DB ──────────────────────────────────────────────────────────────────

const mockExecuteTakeFirstOrThrow = vi.fn();
const mockExecuteTakeFirst = vi.fn();
const mockExecute = vi.fn();

const mockTrxBuilder = {
  insertInto: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returningAll: vi.fn().mockReturnThis(),
  updateTable: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  executeTakeFirstOrThrow: mockExecuteTakeFirstOrThrow,
  execute: vi.fn().mockResolvedValue([]),
};

const mockQueryBuilder = {
  selectFrom: vi.fn().mockReturnThis(),
  selectAll: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  transaction: vi.fn().mockReturnValue({
    execute: vi.fn((fn: (trx: unknown) => Promise<unknown>) => fn(mockTrxBuilder)),
  }),
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
    scope: "vote:post:post-uuid-1:" + "aa".repeat(32),
    points: ["1", "2", "3", "4", "5", "6", "7", "8"],
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("VoteService", () => {
  let voteService: VoteService;
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

    // Re-wire mock chains
    mockQueryBuilder.selectFrom = vi.fn().mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.selectAll = vi.fn().mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.select = vi.fn().mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.where = vi.fn().mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.orderBy = vi.fn().mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.transaction = vi.fn().mockReturnValue({
      execute: vi.fn((fn: (trx: unknown) => Promise<unknown>) => fn(mockTrxBuilder)),
    });

    mockTrxBuilder.insertInto = vi.fn().mockReturnValue(mockTrxBuilder);
    mockTrxBuilder.values = vi.fn().mockReturnValue(mockTrxBuilder);
    mockTrxBuilder.returningAll = vi.fn().mockReturnValue(mockTrxBuilder);
    mockTrxBuilder.updateTable = vi.fn().mockReturnValue(mockTrxBuilder);
    mockTrxBuilder.set = vi.fn().mockReturnValue(mockTrxBuilder);
    mockTrxBuilder.where = vi.fn().mockReturnValue(mockTrxBuilder);
    mockTrxBuilder.execute = vi.fn().mockResolvedValue([]);

    mockSemaphoreService = {
      buildExternalNullifier: vi
        .fn()
        .mockReturnValue("vote:post:post-uuid-1:" + "aa".repeat(32)),
      verifyProof: vi.fn().mockResolvedValue(true),
      extractNullifierHash: vi.fn().mockReturnValue(nullifierHash),
      isNullifierUsed: vi.fn().mockResolvedValue(false),
    };

    mockMerkleService = {
      getRoot: vi.fn().mockResolvedValue(Buffer.alloc(32, 0xcc)),
    };

    voteService = new VoteService(
      mockSemaphoreService as unknown as SemaphoreService,
      mockMerkleService as unknown as MerkleService
    );
  });

  describe("castVote", () => {
    it("casts an upvote on a post", async () => {
      // Mock: post exists
      mockExecuteTakeFirst.mockResolvedValueOnce({
        id: "post-uuid-1",
        group_id: groupId,
        is_deleted: false,
      });

      const mockVote = {
        id: "vote-uuid-1",
        post_id: "post-uuid-1",
        comment_id: null,
        vote_type: "upvote" as const,
        nullifier_hash: nullifierHash,
        external_nullifier: "vote:post:post-uuid-1:" + "aa".repeat(32),
        proof_verified: true,
        proof_data: {},
        created_at: new Date(),
      };

      mockExecuteTakeFirstOrThrow.mockResolvedValueOnce(mockVote);

      const result = await voteService.castVote({
        postId: "post-uuid-1",
        voteType: "upvote",
        proof: makeMockProof(),
      });

      expect(result.id).toBe("vote-uuid-1");
      expect(result.vote_type).toBe("upvote");
      expect(mockSemaphoreService.verifyProof).toHaveBeenCalled();
      expect(mockTrxBuilder.insertInto).toHaveBeenCalledWith("votes");
      expect(mockTrxBuilder.updateTable).toHaveBeenCalledWith("posts");
    });

    it("casts a downvote on a comment", async () => {
      // Mock: comment exists
      mockExecuteTakeFirst.mockResolvedValueOnce({
        id: "comment-uuid-1",
        group_id: groupId,
        is_deleted: false,
      });

      const mockVote = {
        id: "vote-uuid-2",
        post_id: null,
        comment_id: "comment-uuid-1",
        vote_type: "downvote" as const,
        nullifier_hash: nullifierHash,
        external_nullifier: "vote:comment:comment-uuid-1:" + "aa".repeat(32),
        proof_verified: true,
        proof_data: {},
        created_at: new Date(),
      };

      mockSemaphoreService.buildExternalNullifier.mockReturnValueOnce(
        "vote:comment:comment-uuid-1:" + "aa".repeat(32)
      );
      mockExecuteTakeFirstOrThrow.mockResolvedValueOnce(mockVote);

      const result = await voteService.castVote({
        commentId: "comment-uuid-1",
        voteType: "downvote",
        proof: makeMockProof(),
      });

      expect(result.vote_type).toBe("downvote");
      expect(mockTrxBuilder.updateTable).toHaveBeenCalledWith("comments");
    });

    it("throws NotFoundError when target post does not exist", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce(undefined);

      await expect(
        voteService.castVote({
          postId: "nonexistent",
          voteType: "upvote",
          proof: makeMockProof(),
        })
      ).rejects.toThrow("Post not found");
    });

    it("throws NotFoundError when target comment does not exist", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce(undefined);

      await expect(
        voteService.castVote({
          commentId: "nonexistent",
          voteType: "upvote",
          proof: makeMockProof(),
        })
      ).rejects.toThrow("Comment not found");
    });

    it("throws BadRequestError when both postId and commentId provided", async () => {
      await expect(
        voteService.castVote({
          postId: "post-uuid-1",
          commentId: "comment-uuid-1",
          voteType: "upvote",
          proof: makeMockProof(),
        })
      ).rejects.toThrow("Exactly one of postId or commentId must be provided");
    });

    it("throws BadRequestError when neither postId nor commentId provided", async () => {
      await expect(
        voteService.castVote({
          voteType: "upvote",
          proof: makeMockProof(),
        })
      ).rejects.toThrow("Exactly one of postId or commentId must be provided");
    });

    it("throws BadRequestError on invalid proof", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce({
        id: "post-uuid-1",
        group_id: groupId,
        is_deleted: false,
      });
      mockSemaphoreService.verifyProof.mockResolvedValueOnce(false);

      await expect(
        voteService.castVote({
          postId: "post-uuid-1",
          voteType: "upvote",
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
        voteService.castVote({
          postId: "post-uuid-1",
          voteType: "upvote",
          proof: makeMockProof(),
        })
      ).rejects.toThrow("Nullifier already used");
    });
  });

  describe("getPostVotes", () => {
    it("returns votes for a post", async () => {
      mockExecute.mockResolvedValueOnce([
        { id: "v1", post_id: "post-uuid-1", vote_type: "upvote" },
        { id: "v2", post_id: "post-uuid-1", vote_type: "downvote" },
      ]);

      const result = await voteService.getPostVotes("post-uuid-1");
      expect(result).toHaveLength(2);
    });
  });

  describe("getCommentVotes", () => {
    it("returns votes for a comment", async () => {
      mockExecute.mockResolvedValueOnce([
        { id: "v1", comment_id: "comment-uuid-1", vote_type: "upvote" },
      ]);

      const result = await voteService.getCommentVotes("comment-uuid-1");
      expect(result).toHaveLength(1);
    });
  });
});
