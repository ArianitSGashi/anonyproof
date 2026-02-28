/**
 * Services barrel export.
 *
 * All service classes will be exported from here as they are built:
 *   - AdminService       (Phase 5)
 */

export { BlindSignatureService } from "./blind-signature.service.js";
export type { BlindSignatureKeyPair, BlindingResult } from "./blind-signature.service.js";

export { CredentialService } from "./credential.service.js";
export type {
  BlindCredentialRequestInput,
  BlindCredentialApprovalResult,
  CommitmentRegistrationInput,
} from "./credential.service.js";

export { MerkleService } from "./merkle.service.js";
export type { AddMemberResult, MerkleProofData } from "./merkle.service.js";

export { SemaphoreService } from "./semaphore.service.js";
export type {
  SemaphoreProof,
  PackedGroth16Proof,
} from "./semaphore.service.js";

export { GroupService } from "./group.service.js";

export { PostService } from "./post.service.js";
export type { CreatePostInput, PostListResult } from "./post.service.js";

export { CommentService } from "./comment.service.js";
export type { CreateCommentInput } from "./comment.service.js";

export { VoteService } from "./vote.service.js";
export type { CastVoteInput } from "./vote.service.js";

export { ModerationService } from "./moderation.service.js";
export type {
  ModerationResult,
  QueueFilters,
  QueueItemRow,
} from "./moderation.service.js";

export { createAiClient, MockAiClient, PerspectiveApiClient } from "./ai-client.js";
export type { AiClient, AiAnalysisResult } from "./ai-client.js";
