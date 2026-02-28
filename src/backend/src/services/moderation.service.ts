/**
 * Moderation Service
 *
 * Orchestrates AI-based content moderation and human review workflows.
 *
 * Responsibilities:
 *   - Analyze content via the pluggable AiClient
 *   - Make auto-approve / flag / reject decisions based on score thresholds
 *   - Insert flagged content into the moderation_queue for human review
 *   - Process admin decisions and propagate status to posts/comments
 *   - Provide paginated queue listing for the admin dashboard
 *
 * Thresholds (configurable via env or constructor):
 *   - score < FLAG_THRESHOLD  → auto-approved
 *   - FLAG_THRESHOLD ≤ score < REJECT_THRESHOLD → flagged, queued for review
 *   - score ≥ REJECT_THRESHOLD → auto-rejected
 */

import { getDb } from "../db/index.js";
import { NotFoundError, BadRequestError } from "../middleware/error-handler.js";
import type { AiClient, AiAnalysisResult } from "./ai-client.js";
import type { JsonValue, ModerationStatus, ModerationQueueStatus } from "../types/database.js";

// ─── Types ───────────────────────────────────────────────────────────────────

/** The result of analyzing and deciding on a piece of content. */
export interface ModerationResult {
  toxicityScore: number;
  categories: Record<string, number>;
  decision: "approved" | "flagged" | "rejected";
  modelVersion: string;
}

/** Filters for the moderation queue listing. */
export interface QueueFilters {
  status?: ModerationQueueStatus | undefined;
  minScore?: number | undefined;
}

/** Shape returned from the queue listing query. */
export interface QueueItemRow {
  id: string;
  post_id: string | null;
  comment_id: string | null;
  ai_toxicity_score: number;
  ai_flagged_categories: JsonValue | null;
  status: ModerationQueueStatus;
  reviewed_by_admin_id: string | null;
  review_notes: string | null;
  reviewed_at: Date | null;
  created_at: Date;
  /** Joined from post or comment */
  content: string;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class ModerationService {
  /** Score ≥ this → flagged for review (default 0.50) */
  private readonly flagThreshold: number;
  /** Score ≥ this → auto-rejected (default 0.85) */
  private readonly rejectThreshold: number;

  constructor(
    private aiClient: AiClient,
    options?: {
      flagThreshold?: number;
      rejectThreshold?: number;
    }
  ) {
    this.flagThreshold =
      options?.flagThreshold ??
      Number(process.env["MODERATION_FLAG_THRESHOLD"] ?? 0.5);
    this.rejectThreshold =
      options?.rejectThreshold ??
      Number(process.env["MODERATION_REJECT_THRESHOLD"] ?? 0.85);
  }

  // ─── Core Analysis ──────────────────────────────────────────────────

  /**
   * Analyzes content and returns a moderation decision.
   */
  async analyzeContent(content: string): Promise<ModerationResult> {
    const analysis: AiAnalysisResult = await this.aiClient.analyze(content);

    let decision: "approved" | "flagged" | "rejected";
    if (analysis.toxicityScore >= this.rejectThreshold) {
      decision = "rejected";
    } else if (analysis.toxicityScore >= this.flagThreshold) {
      decision = "flagged";
    } else {
      decision = "approved";
    }

    return {
      toxicityScore: analysis.toxicityScore,
      categories: analysis.categories,
      decision,
      modelVersion: analysis.modelVersion,
    };
  }

  // ─── Queue Management ───────────────────────────────────────────────

  /**
   * Inserts a content item into the moderation queue for human review.
   */
  async queueForReview(
    targetPostId: string | undefined,
    targetCommentId: string | undefined,
    aiScore: number,
    aiCategories: Record<string, number>
  ): Promise<void> {
    if ((!targetPostId && !targetCommentId) || (targetPostId && targetCommentId)) {
      throw new BadRequestError(
        "Exactly one of targetPostId or targetCommentId must be provided"
      );
    }

    const db = getDb();

    await db
      .insertInto("moderation_queue")
      .values({
        post_id: targetPostId ?? null,
        comment_id: targetCommentId ?? null,
        ai_toxicity_score: aiScore,
        ai_flagged_categories: aiCategories as unknown as JsonValue,
      })
      .execute();
  }

  /**
   * Processes an admin decision on a moderation queue item.
   *
   * Updates the queue entry, propagates the status to the target
   * post/comment, and logs the action to admin_actions.
   */
  async processDecision(
    queueItemId: string,
    decision: "approved" | "rejected",
    adminId: string,
    reason?: string
  ): Promise<void> {
    const db = getDb();

    await db.transaction().execute(async (trx) => {
      // 1. Find and validate the queue item
      const item = await trx
        .selectFrom("moderation_queue")
        .select(["id", "post_id", "comment_id", "status"])
        .where("id", "=", queueItemId)
        .executeTakeFirst();

      if (!item) {
        throw new NotFoundError("Moderation queue item not found");
      }

      if (item.status !== "pending") {
        throw new BadRequestError(
          `Queue item already processed (status: ${item.status})`
        );
      }

      // 2. Update the queue entry
      const queueStatus: ModerationQueueStatus = decision;

      await trx
        .updateTable("moderation_queue")
        .set({
          status: queueStatus,
          reviewed_by_admin_id: adminId,
          review_notes: reason ?? null,
          reviewed_at: new Date(),
        })
        .where("id", "=", queueItemId)
        .execute();

      // 3. Propagate decision to the target post or comment
      const moderationStatus: ModerationStatus = decision;
      const targetType = item.post_id ? "post" : "comment";
      const targetId = (item.post_id ?? item.comment_id)!;

      if (item.post_id) {
        await trx
          .updateTable("posts")
          .set({
            ai_moderation_status: moderationStatus,
            moderated_at: new Date(),
          })
          .where("id", "=", item.post_id)
          .execute();
      } else if (item.comment_id) {
        await trx
          .updateTable("comments")
          .set({
            ai_moderation_status: moderationStatus,
            moderated_at: new Date(),
          })
          .where("id", "=", item.comment_id)
          .execute();
      }

      // 4. Log the admin action
      await trx
        .insertInto("admin_actions")
        .values({
          admin_id: adminId,
          action_type: `moderation_${decision}`,
          target_type: targetType,
          target_id: targetId,
          details: {
            queue_item_id: queueItemId,
            decision,
            reason: reason ?? null,
          } as unknown as JsonValue,
        })
        .execute();
    });
  }

  /**
   * Lists moderation queue items with optional filters and pagination.
   * Joins to posts/comments to include content text.
   */
  async getQueue(
    filters: QueueFilters,
    pagination: { page: number; limit: number }
  ): Promise<{ data: QueueItemRow[]; total: number }> {
    const db = getDb();
    const offset = (pagination.page - 1) * pagination.limit;

    // Build base query with filters
    let countQuery = db
      .selectFrom("moderation_queue")
      .select(db.fn.countAll<number>().as("total"));

    let dataQuery = db
      .selectFrom("moderation_queue")
      .selectAll("moderation_queue");

    // Apply filters
    if (filters.status) {
      countQuery = countQuery.where("status", "=", filters.status);
      dataQuery = dataQuery.where("moderation_queue.status", "=", filters.status);
    }

    if (filters.minScore !== undefined) {
      countQuery = countQuery.where("ai_toxicity_score", ">=", filters.minScore);
      dataQuery = dataQuery.where(
        "moderation_queue.ai_toxicity_score",
        ">=",
        filters.minScore
      );
    }

    const countResult = await countQuery.executeTakeFirst();
    const total = Number(countResult?.total ?? 0);

    // Fetch queue items ordered by score descending (most toxic first)
    const items = await dataQuery
      .orderBy("moderation_queue.ai_toxicity_score", "desc")
      .limit(pagination.limit)
      .offset(offset)
      .execute();

    // Enrich with content from posts/comments
    const enrichedItems: QueueItemRow[] = [];
    for (const item of items) {
      let content = "[content unavailable]";

      if (item.post_id) {
        const post = await db
          .selectFrom("posts")
          .select("content")
          .where("id", "=", item.post_id)
          .executeTakeFirst();
        content = post?.content ?? content;
      } else if (item.comment_id) {
        const comment = await db
          .selectFrom("comments")
          .select("content")
          .where("id", "=", item.comment_id)
          .executeTakeFirst();
        content = comment?.content ?? content;
      }

      enrichedItems.push({
        id: item.id,
        post_id: item.post_id,
        comment_id: item.comment_id,
        ai_toxicity_score: item.ai_toxicity_score,
        ai_flagged_categories: item.ai_flagged_categories,
        status: item.status,
        reviewed_by_admin_id: item.reviewed_by_admin_id,
        review_notes: item.review_notes,
        reviewed_at: item.reviewed_at,
        created_at: item.created_at,
        content,
      });
    }

    return { data: enrichedItems, total };
  }

  // ─── Integration Helper ─────────────────────────────────────────────

  /**
   * Performs full moderation on a newly created post or comment:
   *   1. Analyze content
   *   2. Update the content's moderation status
   *   3. If flagged or rejected, insert into the queue
   *
   * Called from PostService.createPost() and CommentService.createComment().
   * Runs asynchronously — failures are logged but don't block the response.
   */
  async moderateContent(
    contentId: string,
    contentType: "post" | "comment",
    content: string
  ): Promise<ModerationResult> {
    const result = await this.analyzeContent(content);
    const db = getDb();

    // Map decision to DB moderation status
    const statusMap: Record<string, ModerationStatus> = {
      approved: "approved",
      flagged: "flagged",
      rejected: "rejected",
    };
    const dbStatus = statusMap[result.decision]!;

    // Update the content's moderation fields
    if (contentType === "post") {
      await db
        .updateTable("posts")
        .set({
          ai_moderation_status: dbStatus,
          ai_toxicity_score: result.toxicityScore,
          ai_moderation_categories: result.categories as unknown as JsonValue,
          moderated_at: new Date(),
          moderation_model_version: result.modelVersion,
        })
        .where("id", "=", contentId)
        .execute();
    } else {
      await db
        .updateTable("comments")
        .set({
          ai_moderation_status: dbStatus,
          ai_toxicity_score: result.toxicityScore,
          ai_moderation_categories: result.categories as unknown as JsonValue,
          moderated_at: new Date(),
          moderation_model_version: result.modelVersion,
        })
        .where("id", "=", contentId)
        .execute();
    }

    // If flagged or rejected, add to moderation queue
    if (result.decision === "flagged" || result.decision === "rejected") {
      await this.queueForReview(
        contentType === "post" ? contentId : undefined,
        contentType === "comment" ? contentId : undefined,
        result.toxicityScore,
        result.categories
      );
    }

    return result;
  }
}
