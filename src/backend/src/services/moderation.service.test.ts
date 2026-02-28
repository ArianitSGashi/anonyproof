import { describe, it, expect, vi, beforeEach } from "vitest";
import { ModerationService } from "./moderation.service.js";
import type { AiClient, AiAnalysisResult } from "./ai-client.js";

// ─── Mock DB ──────────────────────────────────────────────────────────────────

const mockExecuteTakeFirstOrThrow = vi.fn();
const mockExecuteTakeFirst = vi.fn();
const mockExecute = vi.fn();

const mockTrxBuilder = {
  selectFrom: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  selectAll: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  updateTable: vi.fn().mockReturnThis(),
  insertInto: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  executeTakeFirst: vi.fn(),
  execute: vi.fn().mockResolvedValue([]),
};

const mockQueryBuilder = {
  insertInto: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  selectFrom: vi.fn().mockReturnThis(),
  selectAll: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  offset: vi.fn().mockReturnThis(),
  updateTable: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  fn: {
    countAll: vi.fn().mockReturnValue({
      as: vi.fn().mockReturnValue("total"),
    }),
  },
  transaction: vi.fn().mockReturnValue({
    execute: vi.fn((fn: (trx: unknown) => Promise<unknown>) => fn(mockTrxBuilder)),
  }),
  executeTakeFirstOrThrow: mockExecuteTakeFirstOrThrow,
  executeTakeFirst: mockExecuteTakeFirst,
  execute: mockExecute,
};

vi.mock("../db/index.js", () => ({
  getDb: () => mockQueryBuilder,
}));

// ─── Mock AI Client ──────────────────────────────────────────────────────────

function makeMockAiClient(overrideResult?: AiAnalysisResult) {
  return {
    analyze: vi.fn().mockResolvedValue(
      overrideResult ?? {
        toxicityScore: 0.05,
        categories: { toxicity: 0.05, insult: 0.02 },
        modelVersion: "test-v1",
      }
    ),
  } satisfies AiClient;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ModerationService", () => {
  let service: ModerationService;
  let mockAiClient: ReturnType<typeof makeMockAiClient>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Re-wire mock chains
    mockQueryBuilder.insertInto = vi.fn().mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.values = vi.fn().mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.selectFrom = vi.fn().mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.selectAll = vi.fn().mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.select = vi.fn().mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.where = vi.fn().mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.orderBy = vi.fn().mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.limit = vi.fn().mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.offset = vi.fn().mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.updateTable = vi.fn().mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.set = vi.fn().mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.transaction = vi.fn().mockReturnValue({
      execute: vi.fn((fn: (trx: unknown) => Promise<unknown>) => fn(mockTrxBuilder)),
    });

    mockTrxBuilder.selectFrom = vi.fn().mockReturnValue(mockTrxBuilder);
    mockTrxBuilder.select = vi.fn().mockReturnValue(mockTrxBuilder);
    mockTrxBuilder.selectAll = vi.fn().mockReturnValue(mockTrxBuilder);
    mockTrxBuilder.where = vi.fn().mockReturnValue(mockTrxBuilder);
    mockTrxBuilder.updateTable = vi.fn().mockReturnValue(mockTrxBuilder);
    mockTrxBuilder.insertInto = vi.fn().mockReturnValue(mockTrxBuilder);
    mockTrxBuilder.values = vi.fn().mockReturnValue(mockTrxBuilder);
    mockTrxBuilder.set = vi.fn().mockReturnValue(mockTrxBuilder);
    mockTrxBuilder.execute = vi.fn().mockResolvedValue([]);

    mockAiClient = makeMockAiClient();
    service = new ModerationService(mockAiClient, {
      flagThreshold: 0.5,
      rejectThreshold: 0.85,
    });
  });

  // ─── analyzeContent ──────────────────────────────────────────────

  describe("analyzeContent", () => {
    it("returns approved for low toxicity", async () => {
      const result = await service.analyzeContent("Hello world");

      expect(result.decision).toBe("approved");
      expect(result.toxicityScore).toBe(0.05);
      expect(mockAiClient.analyze).toHaveBeenCalledWith("Hello world");
    });

    it("returns flagged for medium toxicity", async () => {
      mockAiClient.analyze.mockResolvedValueOnce({
        toxicityScore: 0.72,
        categories: { toxicity: 0.72 },
        modelVersion: "test-v1",
      });

      const result = await service.analyzeContent("some spam abuse");

      expect(result.decision).toBe("flagged");
      expect(result.toxicityScore).toBe(0.72);
    });

    it("returns rejected for high toxicity", async () => {
      mockAiClient.analyze.mockResolvedValueOnce({
        toxicityScore: 0.95,
        categories: { toxicity: 0.95 },
        modelVersion: "test-v1",
      });

      const result = await service.analyzeContent("highly toxic hate");

      expect(result.decision).toBe("rejected");
      expect(result.toxicityScore).toBe(0.95);
    });

    it("respects custom thresholds", async () => {
      const customService = new ModerationService(mockAiClient, {
        flagThreshold: 0.3,
        rejectThreshold: 0.6,
      });

      // 0.05 < 0.3 → approved
      let result = await customService.analyzeContent("safe");
      expect(result.decision).toBe("approved");

      // 0.45 ≥ 0.3 and < 0.6 → flagged
      mockAiClient.analyze.mockResolvedValueOnce({
        toxicityScore: 0.45,
        categories: { toxicity: 0.45 },
        modelVersion: "test-v1",
      });
      result = await customService.analyzeContent("borderline");
      expect(result.decision).toBe("flagged");

      // 0.65 ≥ 0.6 → rejected
      mockAiClient.analyze.mockResolvedValueOnce({
        toxicityScore: 0.65,
        categories: { toxicity: 0.65 },
        modelVersion: "test-v1",
      });
      result = await customService.analyzeContent("bad");
      expect(result.decision).toBe("rejected");
    });
  });

  // ─── queueForReview ──────────────────────────────────────────────

  describe("queueForReview", () => {
    it("inserts a post into the moderation queue", async () => {
      mockExecute.mockResolvedValueOnce([]);

      await service.queueForReview("post-1", undefined, 0.72, { toxicity: 0.72 });

      expect(mockQueryBuilder.insertInto).toHaveBeenCalledWith("moderation_queue");
    });

    it("inserts a comment into the moderation queue", async () => {
      mockExecute.mockResolvedValueOnce([]);

      await service.queueForReview(undefined, "comment-1", 0.65, { toxicity: 0.65 });

      expect(mockQueryBuilder.insertInto).toHaveBeenCalledWith("moderation_queue");
    });

    it("throws when neither postId nor commentId provided", async () => {
      await expect(
        service.queueForReview(undefined, undefined, 0.5, {})
      ).rejects.toThrow("Exactly one of targetPostId or targetCommentId");
    });

    it("throws when both postId and commentId provided", async () => {
      await expect(
        service.queueForReview("post-1", "comment-1", 0.5, {})
      ).rejects.toThrow("Exactly one of targetPostId or targetCommentId");
    });
  });

  // ─── processDecision ─────────────────────────────────────────────

  describe("processDecision", () => {
    it("approves a post via queue item", async () => {
      // Mock: find queue item
      mockTrxBuilder.executeTakeFirst = vi.fn().mockResolvedValueOnce({
        id: "queue-1",
        post_id: "post-1",
        comment_id: null,
        status: "pending",
      });

      await service.processDecision("queue-1", "approved", "admin-1", "Looks fine");

      // Should update queue, update post, and insert admin_action
      expect(mockTrxBuilder.updateTable).toHaveBeenCalledWith("moderation_queue");
      expect(mockTrxBuilder.updateTable).toHaveBeenCalledWith("posts");
      expect(mockTrxBuilder.insertInto).toHaveBeenCalledWith("admin_actions");
    });

    it("rejects a comment via queue item", async () => {
      mockTrxBuilder.executeTakeFirst = vi.fn().mockResolvedValueOnce({
        id: "queue-2",
        post_id: null,
        comment_id: "comment-1",
        status: "pending",
      });

      await service.processDecision("queue-2", "rejected", "admin-1", "Toxic content");

      expect(mockTrxBuilder.updateTable).toHaveBeenCalledWith("moderation_queue");
      expect(mockTrxBuilder.updateTable).toHaveBeenCalledWith("comments");
      expect(mockTrxBuilder.insertInto).toHaveBeenCalledWith("admin_actions");
    });

    it("throws NotFoundError when queue item does not exist", async () => {
      mockTrxBuilder.executeTakeFirst = vi.fn().mockResolvedValueOnce(undefined);

      await expect(
        service.processDecision("nonexistent", "approved", "admin-1")
      ).rejects.toThrow("Moderation queue item not found");
    });

    it("throws BadRequestError when queue item already processed", async () => {
      mockTrxBuilder.executeTakeFirst = vi.fn().mockResolvedValueOnce({
        id: "queue-1",
        post_id: "post-1",
        comment_id: null,
        status: "approved",
      });

      await expect(
        service.processDecision("queue-1", "rejected", "admin-1")
      ).rejects.toThrow("Queue item already processed");
    });
  });

  // ─── getQueue ─────────────────────────────────────────────────────

  describe("getQueue", () => {
    it("returns paginated queue items", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce({ total: 1 });
      mockExecute.mockResolvedValueOnce([
        {
          id: "queue-1",
          post_id: "post-1",
          comment_id: null,
          ai_toxicity_score: 0.72,
          ai_flagged_categories: { toxicity: 0.72 },
          status: "pending",
          reviewed_by_admin_id: null,
          review_notes: null,
          reviewed_at: null,
          created_at: new Date(),
        },
      ]);
      // Content fetch for enrichment
      mockExecuteTakeFirst.mockResolvedValueOnce({ content: "Some post content" });

      const result = await service.getQueue(
        { status: "pending" },
        { page: 1, limit: 20 }
      );

      expect(result.total).toBe(1);
      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.content).toBe("Some post content");
    });

    it("returns empty list when no queue items", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce({ total: 0 });
      mockExecute.mockResolvedValueOnce([]);

      const result = await service.getQueue({}, { page: 1, limit: 20 });

      expect(result.total).toBe(0);
      expect(result.data).toHaveLength(0);
    });
  });

  // ─── moderateContent (integration helper) ─────────────────────────

  describe("moderateContent", () => {
    it("auto-approves safe post content", async () => {
      mockExecute.mockResolvedValue([]);

      const result = await service.moderateContent("post-1", "post", "Nice day!");

      expect(result.decision).toBe("approved");
      // Should update post status
      expect(mockQueryBuilder.updateTable).toHaveBeenCalledWith("posts");
      // Should NOT queue for review (approved)
      expect(mockQueryBuilder.insertInto).not.toHaveBeenCalledWith("moderation_queue");
    });

    it("flags medium-toxicity comment and queues for review", async () => {
      mockAiClient.analyze.mockResolvedValueOnce({
        toxicityScore: 0.72,
        categories: { toxicity: 0.72 },
        modelVersion: "test-v1",
      });
      mockExecute.mockResolvedValue([]);

      const result = await service.moderateContent("comment-1", "comment", "spam abuse");

      expect(result.decision).toBe("flagged");
      // Should update comment status
      expect(mockQueryBuilder.updateTable).toHaveBeenCalledWith("comments");
      // Should queue for review
      expect(mockQueryBuilder.insertInto).toHaveBeenCalledWith("moderation_queue");
    });

    it("auto-rejects highly toxic post and queues for review", async () => {
      mockAiClient.analyze.mockResolvedValueOnce({
        toxicityScore: 0.95,
        categories: { toxicity: 0.95 },
        modelVersion: "test-v1",
      });
      mockExecute.mockResolvedValue([]);

      const result = await service.moderateContent("post-1", "post", "highly toxic hate");

      expect(result.decision).toBe("rejected");
      expect(mockQueryBuilder.updateTable).toHaveBeenCalledWith("posts");
      expect(mockQueryBuilder.insertInto).toHaveBeenCalledWith("moderation_queue");
    });
  });
});
