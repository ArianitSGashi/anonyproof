/**
 * Group Service
 *
 * Manages Semaphore groups: creation, querying, and member counting.
 * Groups are the organizational unit for ZKP-based anonymous interactions.
 *
 * Each group has:
 *   - A unique 32-byte group_id (randomly generated)
 *   - A depth (determines max tree capacity = 2^depth)
 *   - A zero_value (Poseidon hash of 0, used for empty leaves)
 *   - A Merkle tree (managed by MerkleService)
 */

import * as crypto from "node:crypto";
import { poseidon1 } from "poseidon-lite";
import { getDb } from "../db/index.js";
import { NotFoundError } from "../middleware/error-handler.js";
import type { SemaphoreGroup } from "../types/database.js";
import type { MerkleService } from "./merkle.service.js";

export class GroupService {
  private merkleService: MerkleService;

  constructor(merkleService: MerkleService) {
    this.merkleService = merkleService;
  }

  /**
   * Creates a new Semaphore group.
   *
   * Generates a random 32-byte group_id, computes the zero_value as
   * Poseidon(0), and initializes the Merkle tree with empty state.
   */
  async createGroup(
    name: string,
    description: string,
    depth: number
  ): Promise<SemaphoreGroup> {
    const db = getDb();

    // Generate random 32-byte group_id
    const groupId = crypto.randomBytes(32);

    // Compute zero_value: Poseidon hash of 0
    // This is the canonical "empty leaf" value for the tree
    const zeroValueBigInt = poseidon1([0n]);
    const zeroValue = bigIntToBuffer32(zeroValueBigInt);

    const result = await db
      .insertInto("semaphore_groups")
      .values({
        group_id: groupId,
        name,
        description: description || null,
        depth,
        zero_value: zeroValue,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return result;
  }

  /**
   * Retrieves a group by its 32-byte group_id.
   */
  async getGroup(groupId: Buffer): Promise<SemaphoreGroup> {
    const db = getDb();

    const group = await db
      .selectFrom("semaphore_groups")
      .selectAll()
      .where("group_id", "=", groupId)
      .executeTakeFirst();

    if (!group) {
      throw new NotFoundError("Group not found");
    }

    return group;
  }

  /**
   * Lists all groups.
   */
  async listGroups(): Promise<SemaphoreGroup[]> {
    const db = getDb();

    return await db
      .selectFrom("semaphore_groups")
      .selectAll()
      .orderBy("created_at", "desc")
      .execute();
  }

  /**
   * Returns the count of non-revoked members in a group.
   */
  async getMemberCount(groupId: Buffer): Promise<number> {
    const db = getDb();

    const result = await db
      .selectFrom("semaphore_members")
      .select(db.fn.countAll<number>().as("count"))
      .where("group_id", "=", groupId)
      .where("is_revoked", "=", false)
      .executeTakeFirst();

    return Number(result?.count ?? 0);
  }
}

// ─── BigInt / Buffer conversion ─────────────────────────────────────────────

function bigIntToBuffer32(value: bigint): Buffer {
  if (value === 0n) return Buffer.alloc(32);
  let hex = value.toString(16);
  if (hex.length % 2 !== 0) hex = "0" + hex;
  const raw = Buffer.from(hex, "hex");
  if (raw.length >= 32) return raw.subarray(raw.length - 32);
  const padded = Buffer.alloc(32);
  raw.copy(padded, 32 - raw.length);
  return padded;
}
