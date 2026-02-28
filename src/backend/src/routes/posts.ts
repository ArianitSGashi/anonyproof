/**
 * Posts Router
 *
 * POST   /api/posts              — Create an anonymous post (ZKP required)
 * GET    /api/posts/:postId      — Get a single post
 * GET    /api/posts/group/:groupId — List approved posts in a group (paginated)
 */

import { Router } from "express";
import type {
  PostResponse,
  PaginatedResponse,
  CreatePostRequest,
} from "@repo/shared";
import { validate, validateQuery } from "../middleware/validate.js";
import {
  createPostSchema,
  paginationSchema,
} from "../types/schemas.js";
import { PostService } from "../services/post.service.js";
import { SemaphoreService } from "../services/semaphore.service.js";
import { MerkleService } from "../services/merkle.service.js";
import { GroupService } from "../services/group.service.js";
import { ModerationService } from "../services/moderation.service.js";
import { createAiClient } from "../services/ai-client.js";
import type { SemaphoreProof } from "../services/semaphore.service.js";

// ─── Service Instances ───────────────────────────────────────────────────────
// Phase 3/4 uses module-level singletons; will be replaced by DI container later.

const semaphoreService = new SemaphoreService();
const merkleService = new MerkleService();
const groupService = new GroupService(merkleService);
const moderationService = new ModerationService(createAiClient());
const postService = new PostService(semaphoreService, merkleService, groupService, moderationService);

export const postsRouter = Router();

// ─── POST /api/posts ─────────────────────────────────────────────────────────

postsRouter.post("/posts", validate(createPostSchema), async (req, res) => {
  const body = req.body as CreatePostRequest;

  const groupId = Buffer.from(body.groupId, "hex");

  const proof: SemaphoreProof = {
    merkleTreeDepth: 0, // filled by client but not needed for scope check
    merkleTreeRoot: "0", // overridden by backend via merkleService.getRoot()
    message: "0",
    nullifier: BigInt("0x" + body.proof.nullifierHash).toString(),
    scope: body.proof.externalNullifier,
    points: JSON.parse(body.proof.proof),
  };

  const post = await postService.createPost({
    groupId,
    content: body.content,
    proof,
  });

  const response: PostResponse = {
    id: post.id,
    groupId: post.group_id.toString("hex"),
    content: post.content,
    moderationStatus: post.ai_moderation_status,
    upvotes: post.upvotes,
    downvotes: post.downvotes,
    voteScore: post.vote_score,
    createdAt: post.created_at.toISOString(),
  };

  res.status(201).json(response);
});

// ─── GET /api/posts/:postId ──────────────────────────────────────────────────

postsRouter.get("/posts/:postId", async (req, res) => {
  const post = await postService.getPost(req.params["postId"]!);

  const response: PostResponse = {
    id: post.id,
    groupId: post.group_id.toString("hex"),
    content: post.content,
    moderationStatus: post.ai_moderation_status,
    upvotes: post.upvotes,
    downvotes: post.downvotes,
    voteScore: post.vote_score,
    commentCount: post.comment_count,
    createdAt: post.created_at.toISOString(),
  };

  res.json(response);
});

// ─── GET /api/posts/group/:groupId ───────────────────────────────────────────

postsRouter.get(
  "/posts/group/:groupId",
  validateQuery(paginationSchema),
  async (req, res) => {
    const groupId = Buffer.from(req.params["groupId"] as string, "hex");
    const { page, limit } = (req as unknown as { validatedQuery: { page: number; limit: number } }).validatedQuery;

    const result = await postService.listGroupPosts(groupId, page, limit);

    const response: PaginatedResponse<PostResponse> = {
      data: result.posts.map((p) => ({
        id: p.id,
        groupId: p.group_id.toString("hex"),
        content: p.content,
        moderationStatus: p.ai_moderation_status,
        upvotes: p.upvotes,
        downvotes: p.downvotes,
        voteScore: p.vote_score,
        commentCount: p.comment_count,
        createdAt: p.created_at.toISOString(),
      })),
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    };

    res.json(response);
  }
);
