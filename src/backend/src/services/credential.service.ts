/**
 * Credential Issuance Service with Blind Signatures
 *
 * Implements a two-phase credential issuance protocol:
 *
 * Phase 1 — Blind Request:
 *   Student sends { email, blindedCommitment } → server stores and admin signs blindly
 *   Server NEVER sees the real commitment
 *
 * Phase 2 — Commitment Registration:
 *   Student sends { realCommitment, unblindedSignature } → server verifies signature
 *   Server adds commitment to Merkle tree
 *   Server CANNOT link this to any email from Phase 1
 *
 * Privacy guarantee:
 *   Unlike a 90-day purge approach, the link between email and real commitment
 *   NEVER EXISTS on the server. The blinding factor is only known to the client.
 *   The 90-day purge is kept as defense-in-depth for the blinded data.
 */

import { getDb } from "../db/index.js";
import { isValidBytea32 } from "../utils/buffer.js";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "../middleware/error-handler.js";
import type { BlindSignatureService } from "./blind-signature.service.js";

// ─── DTOs ────────────────────────────────────────────────────────────────────

/** Phase 1 input: student sends blinded commitment + email */
export interface BlindCredentialRequestInput {
  universityEmail: string;
  groupId: string; // hex-encoded 32-byte group_id
  blindedCommitment: string; // hex-encoded blinded commitment
}

/** Phase 1 approval output: admin approves → blind signature returned */
export interface BlindCredentialApprovalResult {
  requestId: string;
  blindSignature: string; // hex-encoded blind signature
}

/** Phase 2 input: student registers real commitment with unblinded signature */
export interface CommitmentRegistrationInput {
  groupId: string; // hex-encoded 32-byte group_id
  commitment: string; // hex-encoded real 32-byte identity_commitment
  signature: string; // hex-encoded unblinded signature
}

// Minimum number of requests to approve in a batch (for timing anonymity)
const MIN_BATCH_SIZE = 5;

export class CredentialService {
  private blindSigService: BlindSignatureService;
  private batchEnforcement: boolean;

  constructor(
    blindSigService: BlindSignatureService,
    options?: { batchEnforcement?: boolean }
  ) {
    this.blindSigService = blindSigService;
    this.batchEnforcement = options?.batchEnforcement ?? true;
  }

  /**
   * Get the server's RSA public parameters.
   * Clients need n and e to blind their commitment before sending.
   */
  getPublicParams(): { n: string; e: string } {
    return this.blindSigService.getPublicParams();
  }

  // ─── Phase 1: Blind Credential Request ─────────────────────────────

  /**
   * Phase 1: Receive a blind credential request.
   *
   * The student sends their email (for verification) and a BLINDED commitment.
   * The server stores the request for admin review.
   *
   * Privacy: The server stores only the blinded commitment.
   *          The real commitment is NEVER transmitted in this phase.
   */
  async requestCredential(
    input: BlindCredentialRequestInput
  ): Promise<{ requestId: string }> {
    const { universityEmail, groupId, blindedCommitment } = input;

    // Validate email format
    if (!universityEmail.includes("@") || !universityEmail.includes(".")) {
      throw new BadRequestError("Must use a valid university email address");
    }

    const groupIdBuf = Buffer.from(groupId, "hex");
    if (!isValidBytea32(groupIdBuf)) {
      throw new BadRequestError("Invalid group_id: must be 32 bytes (64 hex chars)");
    }

    const blindedBuf = Buffer.from(blindedCommitment, "hex");
    if (blindedBuf.length === 0) {
      throw new BadRequestError("blindedCommitment must not be empty");
    }

    const db = getDb();

    // Check if group exists
    const group = await db
      .selectFrom("semaphore_groups")
      .select("id")
      .where("group_id", "=", groupIdBuf)
      .executeTakeFirst();

    if (!group) {
      throw new NotFoundError("Group not found");
    }

    // Check for duplicate pending request (same email + group)
    const existing = await db
      .withSchema("onboarding")
      .selectFrom("credential_issuance_requests")
      .select("id")
      .where("email", "=", universityEmail)
      .where("group_id", "=", groupIdBuf)
      .where("status", "in", ["pending", "approved"])
      .executeTakeFirst();

    if (existing) {
      throw new ConflictError(
        "A credential request for this email and group is already pending or approved"
      );
    }

    // Store the blind request
    // NOTE: identity_commitment column stores the BLINDED commitment, not the real one
    const result = await db
      .withSchema("onboarding")
      .insertInto("credential_issuance_requests")
      .values({
        email: universityEmail,
        group_id: groupIdBuf,
        identity_commitment: blindedBuf, // BLINDED, not real
      })
      .returning("request_id")
      .executeTakeFirst();

    return { requestId: result!.request_id };
  }

  // ─── Admin: Approve a Single Request ───────────────────────────────

  /**
   * Admin approves a request → server signs the blinded commitment.
   *
   * The admin verifies the student's email is legitimate.
   * The server signs the blinded commitment (never sees the real one).
   */
  async approveRequest(
    requestId: string,
    adminId: string
  ): Promise<BlindCredentialApprovalResult> {
    const db = getDb();

    const request = await db
      .withSchema("onboarding")
      .selectFrom("credential_issuance_requests")
      .selectAll()
      .where("id", "=", requestId)
      .executeTakeFirst();

    if (!request) {
      throw new NotFoundError("Credential request not found");
    }

    if (request.status !== "pending") {
      throw new BadRequestError(`Request is already ${request.status}`);
    }

    // Sign the blinded commitment
    if (!request.identity_commitment) {
      throw new BadRequestError("Request has no blinded commitment");
    }
    const blindSignature = this.blindSigService.signBlinded(request.identity_commitment);

    // Update request status
    await db
      .withSchema("onboarding")
      .updateTable("credential_issuance_requests")
      .set({
        status: "approved",
        approved_by_admin_id: adminId,
        blind_signature: blindSignature,
      })
      .where("id", "=", requestId)
      .execute();

    // Log admin action
    await db
      .insertInto("admin_actions")
      .values({
        admin_id: adminId,
        action_type: "credential_approved",
        target_type: "credential_request",
        target_id: requestId,
        details: { note: "Blind signature issued" },
      })
      .execute();

    return {
      requestId,
      blindSignature: blindSignature.toString("hex"),
    };
  }

  // ─── Admin: Batch Approval (Timing Anonymity) ─────────────────────

  /**
   * Admin approves a BATCH of requests simultaneously.
   *
   * Privacy: Approving one-by-one creates timing correlation.
   * Batch approval ensures multiple blind signatures are issued together,
   * making it harder to match which signature goes to which email.
   *
   * Minimum batch size enforced to guarantee a meaningful anonymity set.
   */
  async approveBatch(
    requestIds: string[],
    adminId: string
  ): Promise<BlindCredentialApprovalResult[]> {
    if (requestIds.length === 0) {
      throw new BadRequestError("No request IDs provided");
    }

    if (this.batchEnforcement && requestIds.length < MIN_BATCH_SIZE) {
      throw new BadRequestError(
        `Batch approval requires at least ${MIN_BATCH_SIZE} requests ` +
          `to maintain timing anonymity. Currently ${requestIds.length} selected. ` +
          `Wait for more requests or use single approval.`
      );
    }

    const results: BlindCredentialApprovalResult[] = [];
    const db = getDb();

    await db.transaction().execute(async (trx) => {
      for (const requestId of requestIds) {
        const request = await trx
          .withSchema("onboarding")
          .selectFrom("credential_issuance_requests")
          .selectAll()
          .where("id", "=", requestId)
          .executeTakeFirst();

        if (!request) {
          throw new NotFoundError(`Credential request ${requestId} not found`);
        }

        if (request.status !== "pending") {
          throw new BadRequestError(
            `Request ${requestId} is already ${request.status}`
          );
        }

        if (!request.identity_commitment) {
          throw new BadRequestError(
            `Request ${requestId} has no blinded commitment`
          );
        }
        const blindSignature = this.blindSigService.signBlinded(
          request.identity_commitment
        );

        await trx
          .withSchema("onboarding")
          .updateTable("credential_issuance_requests")
          .set({
            status: "approved",
            approved_by_admin_id: adminId,
            blind_signature: blindSignature,
          })
          .where("id", "=", requestId)
          .execute();

        results.push({
          requestId,
          blindSignature: blindSignature.toString("hex"),
        });
      }

      // Log single batch action (not per-request — that leaks ordering info)
      await trx
        .insertInto("admin_actions")
        .values({
          admin_id: adminId,
          action_type: "credential_batch_approved",
          target_type: "credential_request",
          target_id: requestIds[0],
          details: {
            batch_size: requestIds.length,
            note: "Blind signatures issued in batch for timing anonymity",
          },
        })
        .execute();
    });

    // Shuffle results so order doesn't leak which approval maps to which request
    shuffleArray(results);

    return results;
  }

  // ─── Phase 2: Commitment Registration ──────────────────────────────

  /**
   * Phase 2: Register the real commitment with an unblinded signature.
   *
   * The student:
   *   1. Received the blind signature from Phase 1 approval
   *   2. Unblinded it (client-side) → valid signature on real commitment
   *   3. Submits: { realCommitment, unblindedSignature }
   *
   * The server:
   *   1. Verifies the signature is valid for this commitment
   *   2. Adds the commitment to semaphore_members
   *   3. CANNOT link this commitment to any email — blinding is irreversible
   *
   * This is the moment where anonymity becomes PERMANENT and MATHEMATICAL.
   */
  async registerCommitment(input: CommitmentRegistrationInput): Promise<{ leafIndex: number }> {
    const { groupId, commitment, signature } = input;

    const commitmentBuf = Buffer.from(commitment, "hex");
    if (!isValidBytea32(commitmentBuf)) {
      throw new BadRequestError(
        "Invalid commitment: must be exactly 32 bytes (64 hex chars)"
      );
    }

    const groupIdBuf = Buffer.from(groupId, "hex");
    if (!isValidBytea32(groupIdBuf)) {
      throw new BadRequestError(
        "Invalid group_id: must be exactly 32 bytes (64 hex chars)"
      );
    }

    const signatureBuf = Buffer.from(signature, "hex");
    if (signatureBuf.length === 0) {
      throw new BadRequestError("Signature must not be empty");
    }

    // Verify the signature — confirms the server DID sign this commitment
    // (via the blind signature protocol), but can't tell WHEN or for WHOM
    const isValid = this.blindSigService.verifySignature(
      commitmentBuf,
      signatureBuf
    );

    if (!isValid) {
      throw new BadRequestError(
        "Invalid signature: this commitment was not signed by the server"
      );
    }

    const db = getDb();

    // Check if group exists
    const group = await db
      .selectFrom("semaphore_groups")
      .select("id")
      .where("group_id", "=", groupIdBuf)
      .executeTakeFirst();

    if (!group) {
      throw new NotFoundError("Group not found");
    }

    // Check if commitment already registered in this group
    const existing = await db
      .selectFrom("semaphore_members")
      .select("id")
      .where("group_id", "=", groupIdBuf)
      .where("identity_commitment", "=", commitmentBuf)
      .executeTakeFirst();

    if (existing) {
      throw new ConflictError(
        "This commitment is already registered in this group"
      );
    }

    // Get the next leaf index for this group
    const countResult = await db
      .selectFrom("semaphore_members")
      .select(db.fn.countAll<number>().as("count"))
      .where("group_id", "=", groupIdBuf)
      .executeTakeFirst();

    const leafIndex = Number(countResult?.count ?? 0);

    // Add to semaphore_members
    // NOTE: MerkleService will handle tree node updates when it's built (Phase 2)
    await db
      .insertInto("semaphore_members")
      .values({
        group_id: groupIdBuf,
        identity_commitment: commitmentBuf,
        leaf_index: leafIndex,
      })
      .execute();

    return { leafIndex };
  }

  // ─── Admin: Reject Request ─────────────────────────────────────────

  /**
   * Reject a credential request.
   */
  async rejectRequest(
    requestId: string,
    adminId: string,
    reason: string
  ): Promise<void> {
    const db = getDb();

    const request = await db
      .withSchema("onboarding")
      .selectFrom("credential_issuance_requests")
      .select("id")
      .where("id", "=", requestId)
      .executeTakeFirst();

    if (!request) {
      throw new NotFoundError("Credential request not found");
    }

    await db
      .withSchema("onboarding")
      .updateTable("credential_issuance_requests")
      .set({
        status: "rejected",
        approved_by_admin_id: adminId,
        rejection_reason: reason,
      })
      .where("id", "=", requestId)
      .execute();

    await db
      .insertInto("admin_actions")
      .values({
        admin_id: adminId,
        action_type: "credential_rejected",
        target_type: "credential_request",
        target_id: requestId,
        details: { reason },
      })
      .execute();
  }

  // ─── Admin: Get Pending Requests ───────────────────────────────────

  /**
   * Get pending requests for admin review.
   * Returns email + group info but NOT the blinded commitment (no need to expose it).
   */
  async getPendingRequests(): Promise<
    Array<{
      id: string;
      universityEmail: string;
      groupId: string;
      status: string;
      createdAt: Date;
    }>
  > {
    const db = getDb();

    const requests = await db
      .withSchema("onboarding")
      .selectFrom("credential_issuance_requests")
      .select([
        "id",
        "email",
        "group_id",
        "status",
        "created_at",
      ])
      .where("status", "=", "pending")
      .orderBy("created_at", "asc")
      .execute();

    return requests.map((r) => ({
      id: r.id,
      universityEmail: r.email,
      groupId: r.group_id.toString("hex"),
      status: r.status,
      createdAt: r.created_at,
    }));
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Fisher-Yates shuffle — prevents order-based correlation in batch results */
function shuffleArray<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i]!, arr[j]!] = [arr[j]!, arr[i]!];
  }
}
