/**
 * Post Service
 *
 * Manages anonymous post creation and retrieval within Semaphore groups.
 *
 * Flow for creating a post:
 *   1. Verify the group exists
 *   2. Build the expected external nullifier ("post:<action_nonce>:<groupId_hex>")
 *   3. Verify the ZK proof against the group's current Merkle root
 *   4. Check nullifier uniqueness (prevent double-posts with same proof)
 *   5. Insert the post with moderation status = 'pending'
 *
 * Posts are soft-deletable and default to AI moderation pending.
 */

import { getDb } from "../db/index.js";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "../middleware/error-handler.js";
import type { Post, NewPost } from "../types/database.js";
import type { SemaphoreService, SemaphoreProof } from "./semaphore.service.js";
import type { MerkleService } from "./merkle.service.js";
import type { GroupService } from "./group.service.js";
import type { ModerationService } from "./moderation.service.js";

/** Input for creating an anonymous post */
export interface CreatePostInput {
  groupId: Buffer;
  content: string;
  proof: SemaphoreProof;
}

/** Paginated post listing result */
export interface PostListResult {
  posts: (Post & { comment_count: number })[];
  total: number;
}

export class PostService {
  constructor(
    private semaphoreService: SemaphoreService,
    private merkleService: MerkleService,
    private groupService: GroupService,
    private moderationService?: ModerationService | undefined
  ) {}

  /**
   * Creates an anonymous post after verifying the ZK proof.
   */
  async createPost(input: CreatePostInput): Promise<Post> {
    const { groupId, content, proof } = input;

    // 1. Verify group exists
    await this.groupService.getGroup(groupId);

    // 2. Build external nullifier for this scope
    const externalNullifier = this.semaphoreService.buildExternalNullifier(
      "post",
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
        "Nullifier already used — you have already posted with this proof"
      );
    }

    // 5. Insert the post
    const db = getDb();

    const newPost: NewPost = {
      group_id: groupId,
      content,
      nullifier_hash: nullifierHash,
      external_nullifier: externalNullifier,
      proof_verified: true,
      proof_data: proofToJson(proof),
    };

    const post = await db
      .insertInto("posts")
      .values(newPost)
      .returningAll()
      .executeTakeFirstOrThrow();

    // 6. Run AI moderation asynchronously (non-blocking)
    if (this.moderationService) {
      this.moderationService
        .moderateContent(post.id, "post", content)
        .catch((err: unknown) => {
          console.error("Post moderation failed (non-blocking):", err);
        });
    }

    return post;
  }

  /**
   * Retrieves a single post by ID.
   * Throws NotFoundError if not found or soft-deleted.
   */
  async getPost(postId: string): Promise<Post & { comment_count: number }> {
    const db = getDb();

    const post = await db
      .selectFrom("posts")
      .selectAll("posts")
      .select((eb) =>
        eb
          .selectFrom("comments")
          .select(eb.fn.countAll<number>().as("count"))
          .whereRef("comments.post_id", "=", "posts.id")
          .where("comments.is_deleted", "=", false)
          .as("comment_count")
      )
      .where("posts.id", "=", postId)
      .where("posts.is_deleted", "=", false)
      .executeTakeFirst();

    if (!post) {
      throw new NotFoundError("Post not found");
    }

    return { ...post, comment_count: Number(post.comment_count ?? 0) };
  }

  /**
   * Lists approved posts in a group with pagination.
   */
  async listGroupPosts(
    groupId: Buffer,
    page: number,
    limit: number
  ): Promise<PostListResult> {
    const db = getDb();
    const offset = (page - 1) * limit;

    // Count total approved posts in the group
    const countResult = await db
      .selectFrom("posts")
      .select(db.fn.countAll<number>().as("total"))
      .where("group_id", "=", groupId)
      .where("is_deleted", "=", false)
      .where("ai_moderation_status", "=", "approved")
      .executeTakeFirst();

    const total = Number(countResult?.total ?? 0);

    // Fetch page of posts with comment counts
    const posts = await db
      .selectFrom("posts")
      .selectAll("posts")
      .select((eb) =>
        eb
          .selectFrom("comments")
          .select(eb.fn.countAll<number>().as("count"))
          .whereRef("comments.post_id", "=", "posts.id")
          .where("comments.is_deleted", "=", false)
          .as("comment_count")
      )
      .where("posts.group_id", "=", groupId)
      .where("posts.is_deleted", "=", false)
      .where("posts.ai_moderation_status", "=", "approved")
      .orderBy("posts.created_at", "desc")
      .limit(limit)
      .offset(offset)
      .execute();

    return {
      posts: posts.map((p) => ({
        ...p,
        comment_count: Number(p.comment_count ?? 0),
      })),
      total,
    };
  }

  /**
   * Soft-deletes a post (admin / moderation action).
   */
  async softDeletePost(postId: string): Promise<void> {
    const db = getDb();

    const result = await db
      .updateTable("posts")
      .set({
        is_deleted: true,
        deleted_at: new Date(),
      })
      .where("id", "=", postId)
      .where("is_deleted", "=", false)
      .executeTakeFirst();

    if (result.numUpdatedRows === 0n) {
      throw new NotFoundError("Post not found or already deleted");
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Converts a SemaphoreProof into a JSON-safe object for storage in JSONB.
 */
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
