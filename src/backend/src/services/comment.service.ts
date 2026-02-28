/**
 * Comment Service
 *
 * Manages anonymous comment creation and retrieval.
 *
 * Comments belong to a post and optionally nest under a parent comment.
 * Each comment requires a valid ZK proof scoped to "comment:<postId>".
 *
 * Threaded comment retrieval returns flat lists; the client handles
 * tree rendering using parent_comment_id references.
 */

import { getDb } from "../db/index.js";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "../middleware/error-handler.js";
import type { Comment, NewComment } from "../types/database.js";
import type { SemaphoreService, SemaphoreProof } from "./semaphore.service.js";
import type { MerkleService } from "./merkle.service.js";
import type { ModerationService } from "./moderation.service.js";

/** Input for creating an anonymous comment */
export interface CreateCommentInput {
  postId: string;
  parentCommentId?: string | undefined;
  content: string;
  proof: SemaphoreProof;
}

export class CommentService {
  constructor(
    private semaphoreService: SemaphoreService,
    private merkleService: MerkleService,
    private moderationService?: ModerationService | undefined
  ) {}

  /**
   * Creates an anonymous comment after verifying the ZK proof.
   */
  async createComment(input: CreateCommentInput): Promise<Comment> {
    const { postId, parentCommentId, content, proof } = input;
    const db = getDb();

    // 1. Verify the post exists and is not deleted
    const post = await db
      .selectFrom("posts")
      .select(["id", "group_id", "is_deleted"])
      .where("id", "=", postId)
      .executeTakeFirst();

    if (!post || post.is_deleted) {
      throw new NotFoundError("Post not found");
    }

    const groupId = post.group_id;

    // 2. If parent_comment_id is provided, verify it exists in the same post
    if (parentCommentId) {
      const parent = await db
        .selectFrom("comments")
        .select(["id", "post_id", "is_deleted"])
        .where("id", "=", parentCommentId)
        .executeTakeFirst();

      if (!parent || parent.is_deleted) {
        throw new NotFoundError("Parent comment not found");
      }

      if (parent.post_id !== postId) {
        throw new BadRequestError(
          "Parent comment does not belong to the specified post"
        );
      }
    }

    // 3. Build external nullifier scoped to comment on this post
    const externalNullifier = this.semaphoreService.buildExternalNullifier(
      `comment:${postId}`,
      groupId
    );

    // 4. Verify the Semaphore proof
    const merkleRoot = await this.merkleService.getRoot(groupId);
    const proofValid = await this.semaphoreService.verifyProof(
      proof,
      merkleRoot,
      externalNullifier
    );

    if (!proofValid) {
      throw new BadRequestError("Invalid ZK proof");
    }

    // 5. Extract nullifier hash and check uniqueness
    const nullifierHash = this.semaphoreService.extractNullifierHash(proof);
    const alreadyUsed = await this.semaphoreService.isNullifierUsed(
      nullifierHash,
      externalNullifier
    );

    if (alreadyUsed) {
      throw new ConflictError(
        "Nullifier already used — you have already commented with this proof"
      );
    }

    // 6. Insert the comment
    const newComment: NewComment = {
      post_id: postId,
      parent_comment_id: parentCommentId ?? null,
      group_id: groupId,
      content,
      nullifier_hash: nullifierHash,
      external_nullifier: externalNullifier,
      proof_verified: true,
      proof_data: proofToJson(proof),
    };

    const comment = await db
      .insertInto("comments")
      .values(newComment)
      .returningAll()
      .executeTakeFirstOrThrow();

    // 7. Run AI moderation asynchronously (non-blocking)
    if (this.moderationService) {
      this.moderationService
        .moderateContent(comment.id, "comment", content)
        .catch((err: unknown) => {
          console.error("Comment moderation failed (non-blocking):", err);
        });
    }

    return comment;
  }

  /**
   * Retrieves all non-deleted comments for a post, ordered by creation time.
   * Returns a flat list; client renders the thread tree using parent_comment_id.
   */
  async getPostComments(postId: string): Promise<Comment[]> {
    const db = getDb();

    // Verify post exists
    const post = await db
      .selectFrom("posts")
      .select("id")
      .where("id", "=", postId)
      .where("is_deleted", "=", false)
      .executeTakeFirst();

    if (!post) {
      throw new NotFoundError("Post not found");
    }

    return await db
      .selectFrom("comments")
      .selectAll()
      .where("post_id", "=", postId)
      .where("is_deleted", "=", false)
      .orderBy("created_at", "asc")
      .execute();
  }

  /**
   * Retrieves a single comment by ID.
   */
  async getComment(commentId: string): Promise<Comment> {
    const db = getDb();

    const comment = await db
      .selectFrom("comments")
      .selectAll()
      .where("id", "=", commentId)
      .where("is_deleted", "=", false)
      .executeTakeFirst();

    if (!comment) {
      throw new NotFoundError("Comment not found");
    }

    return comment;
  }

  /**
   * Soft-deletes a comment (admin / moderation action).
   */
  async softDeleteComment(commentId: string): Promise<void> {
    const db = getDb();

    const result = await db
      .updateTable("comments")
      .set({
        is_deleted: true,
        deleted_at: new Date(),
      })
      .where("id", "=", commentId)
      .where("is_deleted", "=", false)
      .executeTakeFirst();

    if (result.numUpdatedRows === 0n) {
      throw new NotFoundError("Comment not found or already deleted");
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function proofToJson(
  proof: SemaphoreProof
): Record<string, string | number | string[]> {
  return {
    merkleTreeDepth: proof.merkleTreeDepth,
    merkleTreeRoot: proof.merkleTreeRoot,
    message: proof.message,
    nullifier: proof.nullifier,
    scope: proof.scope,
    points: [...proof.points],
  };
}
