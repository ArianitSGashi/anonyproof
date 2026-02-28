/**
 * Credential Admin Service (Phase 5)
 *
 * Provides the admin-driven credential issuance workflow:
 *   1. A user requests a credential (email + identity commitment + group)
 *   2. An admin reviews pending requests
 *   3. Admin approves → commitment added to Merkle tree via MerkleService
 *   4. Admin rejects → reason recorded, request closed
 *
 * This service works alongside the existing blind-signature-based
 * CredentialService. It exposes a simpler direct-commitment flow
 * for admin-managed issuance.
 *
 * All approve/reject actions are logged to admin_actions for audit.
 */

import { getDb } from "../db/index.js";
import { isValidBytea32 } from "../utils/buffer.js";
import type { MerkleService } from "./merkle.service.js";
import type { PaginatedResponse, PaginationParams } from "@repo/shared";
import {
  BadRequestError,
  NotFoundError,
  ConflictError,
} from "../middleware/error-handler.js";

// ─── DTOs ─────────────────────────────────────────────────────────────────────

export interface CredentialRequestDTO {
  id: string;
  requestId: string;
  email: string;
  groupId: string; // hex
  status: string;
  rejectionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class CredentialAdminService {
  private merkleService: MerkleService;

  constructor(merkleService: MerkleService) {
    this.merkleService = merkleService;
  }

  /**
   * Submit a credential request.
   *
   * Validates the email format, commitment size (32 bytes), and group existence.
   * Inserts into onboarding.credential_issuance_requests with status 'pending'.
   *
   * Returns the external-facing request_id (UUID).
   */
  async requestCredential(
    email: string,
    commitment: Buffer,
    groupId: Buffer
  ): Promise<string> {
    // Validate email
    if (!email.includes("@") || !email.includes(".")) {
      throw new BadRequestError("Invalid email format");
    }

    // Validate commitment is 32 bytes
    if (!isValidBytea32(commitment)) {
      throw new BadRequestError(
        "Identity commitment must be exactly 32 bytes"
      );
    }

    // Validate groupId is 32 bytes
    if (!isValidBytea32(groupId)) {
      throw new BadRequestError("Group ID must be exactly 32 bytes");
    }

    const db = getDb();

    // Verify group exists
    const group = await db
      .selectFrom("semaphore_groups")
      .select("id")
      .where("group_id", "=", groupId)
      .executeTakeFirst();

    if (!group) {
      throw new NotFoundError("Group not found");
    }

    // Check for duplicate pending/approved request
    const existing = await db
      .withSchema("onboarding")
      .selectFrom("credential_issuance_requests")
      .select("id")
      .where("email", "=", email)
      .where("group_id", "=", groupId)
      .where("status", "in", ["pending", "approved", "issued"])
      .executeTakeFirst();

    if (existing) {
      throw new ConflictError(
        "A credential request for this email and group already exists"
      );
    }

    const result = await db
      .withSchema("onboarding")
      .insertInto("credential_issuance_requests")
      .values({
        email,
        group_id: groupId,
        identity_commitment: commitment,
      })
      .returning("request_id")
      .executeTakeFirstOrThrow();

    return result.request_id;
  }

  /**
   * Approve a pending credential request.
   *
   * In a transaction:
   *   1. Load and validate the request
   *   2. Add the commitment to the Merkle tree via MerkleService.addMember()
   *   3. Update request status to 'issued'
   *   4. Log the action to admin_actions
   */
  async approveRequest(requestId: string, adminId: string): Promise<void> {
    const db = getDb();

    // Use the internal id (the column we use for lookups)
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
      throw new BadRequestError(
        `Request is already ${request.status}, cannot approve`
      );
    }

    if (!request.identity_commitment) {
      throw new BadRequestError("Request has no identity commitment");
    }

    // Add commitment to the Merkle tree (this handles its own transaction)
    await this.merkleService.addMember(
      request.group_id,
      request.identity_commitment
    );

    // Update request status
    await db
      .withSchema("onboarding")
      .updateTable("credential_issuance_requests")
      .set({
        status: "issued" as const,
        approved_by_admin_id: adminId,
        issued_at: new Date(),
      })
      .where("id", "=", requestId)
      .execute();

    // Log admin action
    await db
      .insertInto("admin_actions")
      .values({
        admin_id: adminId,
        action_type: "credential_issued",
        target_type: "credential_request",
        target_id: requestId,
        details: {
          email: request.email,
          group_id: request.group_id.toString("hex"),
        },
      })
      .execute();
  }

  /**
   * Reject a pending credential request with a reason.
   *
   * Updates the request status to 'rejected' and logs the action.
   */
  async rejectRequest(
    requestId: string,
    adminId: string,
    reason: string
  ): Promise<void> {
    if (!reason || reason.trim().length === 0) {
      throw new BadRequestError("Rejection reason is required");
    }

    const db = getDb();

    const request = await db
      .withSchema("onboarding")
      .selectFrom("credential_issuance_requests")
      .select(["id", "status", "email", "group_id"])
      .where("id", "=", requestId)
      .executeTakeFirst();

    if (!request) {
      throw new NotFoundError("Credential request not found");
    }

    if (request.status !== "pending") {
      throw new BadRequestError(
        `Request is already ${request.status}, cannot reject`
      );
    }

    await db
      .withSchema("onboarding")
      .updateTable("credential_issuance_requests")
      .set({
        status: "rejected" as const,
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

  /**
   * Get pending credential requests for admin review (paginated).
   */
  async getPending(
    pagination: PaginationParams
  ): Promise<PaginatedResponse<CredentialRequestDTO>> {
    const db = getDb();
    const page = pagination.page ?? 1;
    const limit = pagination.limit ?? 20;
    const offset = (page - 1) * limit;

    const [data, countResult] = await Promise.all([
      db
        .withSchema("onboarding")
        .selectFrom("credential_issuance_requests")
        .select([
          "id",
          "request_id",
          "email",
          "group_id",
          "status",
          "rejection_reason",
          "created_at",
          "updated_at",
        ])
        .where("status", "=", "pending")
        .orderBy("created_at", "asc")
        .limit(limit)
        .offset(offset)
        .execute(),
      db
        .withSchema("onboarding")
        .selectFrom("credential_issuance_requests")
        .select(db.fn.countAll<number>().as("count"))
        .where("status", "=", "pending")
        .executeTakeFirst(),
    ]);

    const total = Number(countResult?.count ?? 0);

    return {
      data: data.map(toDTO),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDTO(row: {
  id: string;
  request_id: string;
  email: string;
  group_id: Buffer;
  status: string;
  rejection_reason: string | null;
  created_at: Date;
  updated_at: Date;
}): CredentialRequestDTO {
  return {
    id: row.id,
    requestId: row.request_id,
    email: row.email,
    groupId: row.group_id.toString("hex"),
    status: row.status,
    rejectionReason: row.rejection_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
