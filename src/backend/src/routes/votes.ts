/**
 * Votes Router
 *
 * POST   /api/votes — Cast an anonymous vote on a post or comment (ZKP required)
 */

import { Router } from "express";
import type { VoteRequest, VoteResponse } from "@repo/shared";
import { validate } from "../middleware/validate.js";
import { castVoteSchema } from "../types/schemas.js";
import { VoteService } from "../services/vote.service.js";
import { SemaphoreService } from "../services/semaphore.service.js";
import { MerkleService } from "../services/merkle.service.js";
import type { SemaphoreProof } from "../services/semaphore.service.js";

// ─── Service Instances ───────────────────────────────────────────────────────

const semaphoreService = new SemaphoreService();
const merkleService = new MerkleService();
const voteService = new VoteService(semaphoreService, merkleService);

export const votesRouter = Router();

// ─── POST /api/votes ─────────────────────────────────────────────────────────

votesRouter.post("/votes", validate(castVoteSchema), async (req, res) => {
  const body = req.body as VoteRequest;

  const proof: SemaphoreProof = {
    merkleTreeDepth: 0,
    merkleTreeRoot: "0",
    message: "0",
    nullifier: BigInt("0x" + body.proof.nullifierHash).toString(),
    scope: body.proof.externalNullifier,
    points: JSON.parse(body.proof.proof),
  };

  const vote = await voteService.castVote({
    postId: body.postId,
    commentId: body.commentId,
    voteType: body.voteType,
    proof,
  });

  const response: VoteResponse = {
    id: vote.id,
    voteType: vote.vote_type,
    createdAt: vote.created_at.toISOString(),
  };

  res.status(201).json(response);
});
