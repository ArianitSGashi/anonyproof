/**
 * Vote Service
 *
 * Manages anonymous voting on posts and comments.
 *
 * Each vote requires a valid ZK proof scoped to "vote:<targetId>".
 * Votes are immutable — no updates or deletes.
 * The service maintains cached upvote/downvote aggregates on the target
 * row within the same transaction as the vote insert.
 */

import { getDb } from "../db/index.js";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "../middleware/error-handler.js";
import type { Vote, NewVote, VoteType } from "../types/database.js";
import type { SemaphoreService, SemaphoreProof } from "./semaphore.service.js";
import type { MerkleService } from "./merkle.service.js";

/** Input for casting an anonymous vote */
export interface CastVoteInput {
  postId?: string | undefined;
  commentId?: string | undefined;
  voteType: VoteType;
  proof: SemaphoreProof;
}

export class VoteService {
  constructor(
    private semaphoreService: SemaphoreService,
    private merkleService: MerkleService
  ) {}

  /**
   * Casts an anonymous vote on a post or comment.
   *
   * Uses a database transaction to:
   *   1. Validate the target exists and get its group_id
   *   2. Verify the ZK proof
   *   3. Check nullifier uniqueness
   *   4. Insert the vote
   *   5. Increment the cached aggregate (upvotes/downvotes) on the target
   */
  async castVote(input: CastVoteInput): Promise<Vote> {
    const { postId, commentId, voteType, proof } = input;

    // Exactly one target must be specified (Zod already enforces this, defensive check)
    if ((!postId && !commentId) || (postId && commentId)) {
      throw new BadRequestError(
        "Exactly one of postId or commentId must be provided"
      );
    }

    const db = getDb();

    // 1. Resolve the target and its group_id
    let groupId: Buffer;
    const targetId = (postId ?? commentId)!;
    const targetType = postId ? "post" : "comment";

    if (postId) {
      const post = await db
        .selectFrom("posts")
        .select(["id", "group_id", "is_deleted"])
        .where("id", "=", postId)
        .executeTakeFirst();

      if (!post || post.is_deleted) {
        throw new NotFoundError("Post not found");
      }
      groupId = post.group_id;
    } else {
      const comment = await db
        .selectFrom("comments")
        .select(["id", "group_id", "is_deleted"])
        .where("id", "=", commentId!)
        .executeTakeFirst();

      if (!comment || comment.is_deleted) {
        throw new NotFoundError("Comment not found");
      }
      groupId = comment.group_id;
    }

    // 2. Build external nullifier scoped to voting on this target
    const externalNullifier = this.semaphoreService.buildExternalNullifier(
      `vote:${targetType}:${targetId}`,
      groupId
    );

    // 3. Verify the Semaphore proof
    const merkleRoot = await this.merkleService.getRoot(groupId);
    const proofValid = await this.semaphoreService.verifyProof(
      proof,
      merkleRoot,
      externalNullifier
    );

    if (!proofValid) {
      throw new BadRequestError("Invalid ZK proof");
    }

    // 4. Extract nullifier hash and check uniqueness
    const nullifierHash = this.semaphoreService.extractNullifierHash(proof);
    const alreadyUsed = await this.semaphoreService.isNullifierUsed(
      nullifierHash,
      externalNullifier
    );

    if (alreadyUsed) {
      throw new ConflictError(
        "Nullifier already used — you have already voted on this content"
      );
    }

    // 5. Insert vote + update aggregates in a transaction
    return await db.transaction().execute(async (trx) => {
      const newVote: NewVote = {
        post_id: postId ?? null,
        comment_id: commentId ?? null,
        vote_type: voteType,
        nullifier_hash: nullifierHash,
        external_nullifier: externalNullifier,
        proof_verified: true,
        proof_data: proofToJson(proof),
      };

      const vote = await trx
        .insertInto("votes")
        .values(newVote)
        .returningAll()
        .executeTakeFirstOrThrow();

      // Update cached aggregate on the target row
      const column = voteType === "upvote" ? "upvotes" : "downvotes";

      if (postId) {
        await trx
          .updateTable("posts")
          .set((eb) => ({
            [column]: eb(column, "+", 1),
          }))
          .where("id", "=", postId)
          .execute();
      } else {
        await trx
          .updateTable("comments")
          .set((eb) => ({
            [column]: eb(column, "+", 1),
          }))
          .where("id", "=", commentId!)
          .execute();
      }

      return vote;
    });
  }

  /**
   * Retrieves all votes for a post.
   */
  async getPostVotes(postId: string): Promise<Vote[]> {
    const db = getDb();

    return await db
      .selectFrom("votes")
      .selectAll()
      .where("post_id", "=", postId)
      .orderBy("created_at", "asc")
      .execute();
  }

  /**
   * Retrieves all votes for a comment.
   */
  async getCommentVotes(commentId: string): Promise<Vote[]> {
    const db = getDb();

    return await db
      .selectFrom("votes")
      .selectAll()
      .where("comment_id", "=", commentId)
      .orderBy("created_at", "asc")
      .execute();
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
