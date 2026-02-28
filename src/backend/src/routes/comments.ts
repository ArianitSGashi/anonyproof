/**
 * Comments Router
 *
 * POST   /api/comments           — Create an anonymous comment (ZKP required)
 * GET    /api/comments/post/:postId — List comments for a post
 * GET    /api/comments/:commentId   — Get a single comment
 */

import { Router } from "express";
import type { CommentResponse, CreateCommentRequest } from "@repo/shared";
import { validate } from "../middleware/validate.js";
import { createCommentSchema } from "../types/schemas.js";
import { CommentService } from "../services/comment.service.js";
import { SemaphoreService } from "../services/semaphore.service.js";
import { MerkleService } from "../services/merkle.service.js";
import { ModerationService } from "../services/moderation.service.js";
import { createAiClient } from "../services/ai-client.js";
import type { SemaphoreProof } from "../services/semaphore.service.js";
import type { Comment } from "../types/database.js";

// ─── Service Instances ───────────────────────────────────────────────────────

const semaphoreService = new SemaphoreService();
const merkleService = new MerkleService();
const moderationService = new ModerationService(createAiClient());
const commentService = new CommentService(semaphoreService, merkleService, moderationService);

export const commentsRouter = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toCommentResponse(c: Comment): CommentResponse {
  return {
    id: c.id,
    postId: c.post_id,
    parentCommentId: c.parent_comment_id,
    content: c.content,
    moderationStatus: c.ai_moderation_status,
    upvotes: c.upvotes,
    downvotes: c.downvotes,
    voteScore: c.vote_score,
    createdAt: c.created_at.toISOString(),
  };
}

// ─── POST /api/comments ──────────────────────────────────────────────────────

commentsRouter.post(
  "/comments",
  validate(createCommentSchema),
  async (req, res) => {
    const body = req.body as CreateCommentRequest;

    const proof: SemaphoreProof = {
      merkleTreeDepth: 0,
      merkleTreeRoot: "0",
      message: "0",
      nullifier: BigInt("0x" + body.proof.nullifierHash).toString(),
      scope: body.proof.externalNullifier,
      points: JSON.parse(body.proof.proof),
    };

    const comment = await commentService.createComment({
      postId: body.postId,
      parentCommentId: body.parentCommentId,
      content: body.content,
      proof,
    });

    res.status(201).json(toCommentResponse(comment));
  }
);

// ─── GET /api/comments/post/:postId ──────────────────────────────────────────

commentsRouter.get("/comments/post/:postId", async (req, res) => {
  const comments = await commentService.getPostComments(req.params["postId"]!);
  res.json(comments.map(toCommentResponse));
});

// ─── GET /api/comments/:commentId ────────────────────────────────────────────

commentsRouter.get("/comments/:commentId", async (req, res) => {
  const comment = await commentService.getComment(req.params["commentId"]!);
  res.json(toCommentResponse(comment));
});
