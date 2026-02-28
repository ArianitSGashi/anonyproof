/**
 * Services barrel export.
 *
 * All service classes will be exported from here as they are built:
 *   - PostService        (Phase 3)
 *   - CommentService     (Phase 3)
 *   - VoteService        (Phase 3)
 *   - ModerationService  (Phase 4)
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
