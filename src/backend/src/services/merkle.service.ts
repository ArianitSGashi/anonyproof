/**
 * Merkle Tree Service
 *
 * Manages the persistent Merkle tree for Semaphore groups.
 *
 * Uses the in-memory Semaphore Group (LeanIMT + poseidon2) as the source of truth
 * for hash computation, while persisting tree state to the database for durability.
 *
 * Architecture:
 *   - The Semaphore V4 Group class uses a LeanIMT (Lean Incremental Merkle Tree)
 *     with dynamic depth and poseidon2 as the hash function.
 *   - We keep an in-memory Group per groupId and persist all node state to
 *     merkle_tree_nodes after each mutation.
 *   - On cold start, the tree is rebuilt from semaphore_members.
 *
 * Why in-memory + DB sync:
 *   - The LeanIMT is the canonical implementation that matches the ZK circuits.
 *   - Reimplementing poseidon2 tree hashing in SQL would be fragile and diverge.
 *   - The DB stores the serialized tree state for fast restoration and querying.
 */

import { Group } from "@semaphore-protocol/group";
import type { Kysely, Transaction } from "kysely";
import type { Database } from "../types/database.js";
import { getDb } from "../db/index.js";
import { NotFoundError } from "../middleware/error-handler.js";

/** Result of adding a member to the tree */
export interface AddMemberResult {
  leafIndex: number;
}

/** Merkle proof for proof generation */
export interface MerkleProofData {
  root: bigint;
  leaf: bigint;
  index: number;
  siblings: bigint[];
}

export class MerkleService {
  /** In-memory group cache: groupId hex → Group instance */
  private groups = new Map<string, Group>();

  /**
   * Adds a member (identity commitment) to the group's Merkle tree.
   * Inserts into semaphore_members and updates the persisted tree state.
   * All operations run in a single transaction.
   */
  async addMember(
    groupId: Buffer,
    commitment: Buffer
  ): Promise<AddMemberResult> {
    const db = getDb();

    return await db.transaction().execute(async (trx) => {
      // Verify group exists and get its depth
      const group = await trx
        .selectFrom("semaphore_groups")
        .select(["group_id", "depth"])
        .where("group_id", "=", groupId)
        .executeTakeFirst();

      if (!group) {
        throw new NotFoundError("Group not found");
      }

      // Get the current member count for the leaf index
      const countResult = await trx
        .selectFrom("semaphore_members")
        .select(trx.fn.countAll<number>().as("count"))
        .where("group_id", "=", groupId)
        .executeTakeFirst();

      const leafIndex = Number(countResult?.count ?? 0);
      const commitmentBigInt = bufferToBigInt(commitment);

      // Insert the member record
      await trx
        .insertInto("semaphore_members")
        .values({
          group_id: groupId,
          identity_commitment: commitment,
          leaf_index: leafIndex,
        })
        .execute();

      // Update the in-memory tree and persist
      const inMemoryGroup = await this.loadGroup(groupId, trx);
      inMemoryGroup.addMember(commitmentBigInt);
      await this.persistTreeState(groupId, inMemoryGroup, trx);

      return { leafIndex };
    });
  }

  /**
   * Returns the current Merkle root for a group.
   */
  async getRoot(groupId: Buffer): Promise<Buffer> {
    const db = getDb();
    const group = await this.loadGroup(groupId, db);
    return bigIntToBuffer32(group.root);
  }

  /**
   * Generates a Merkle proof for a member at the given leaf index.
   * The proof contains the sibling path needed for ZKP generation.
   */
  async getMerkleProof(
    groupId: Buffer,
    leafIndex: number
  ): Promise<MerkleProofData> {
    const db = getDb();
    const group = await this.loadGroup(groupId, db);

    if (leafIndex < 0 || leafIndex >= group.size) {
      throw new NotFoundError(
        `Leaf index ${leafIndex} is out of range (tree has ${group.size} leaves)`
      );
    }

    const proof = group.generateMerkleProof(leafIndex);

    return {
      root: proof.root,
      leaf: proof.leaf,
      index: proof.index,
      siblings: proof.siblings,
    };
  }

  /**
   * Revokes a member by setting is_revoked=true and replacing their leaf
   * with 0 (LeanIMT removal). Recomputes the tree path.
   */
  async revokeMember(
    groupId: Buffer,
    commitment: Buffer,
    reason: string
  ): Promise<void> {
    const db = getDb();

    await db.transaction().execute(async (trx) => {
      // Find the member
      const member = await trx
        .selectFrom("semaphore_members")
        .select(["id", "leaf_index", "is_revoked"])
        .where("group_id", "=", groupId)
        .where("identity_commitment", "=", commitment)
        .executeTakeFirst();

      if (!member) {
        throw new NotFoundError("Member not found in this group");
      }

      if (member.is_revoked) {
        throw new NotFoundError("Member is already revoked");
      }

      // Mark as revoked in DB
      await trx
        .updateTable("semaphore_members")
        .set({
          is_revoked: true,
          revoked_at: new Date(),
          revoked_reason: reason,
        })
        .where("id", "=", member.id)
        .execute();

      // Update the in-memory tree: remove the member (sets leaf to 0)
      const inMemoryGroup = await this.loadGroup(groupId, trx);
      inMemoryGroup.removeMember(member.leaf_index);
      await this.persistTreeState(groupId, inMemoryGroup, trx);
    });
  }

  /**
   * Returns the in-memory Group instance, loading from DB if not cached.
   * Rebuilds the tree from semaphore_members ordered by leaf_index.
   */
  private async loadGroup(
    groupId: Buffer,
    dbOrTrx: Kysely<Database> | Transaction<Database>
  ): Promise<Group> {
    const key = groupId.toString("hex");
    const cached = this.groups.get(key);
    if (cached) return cached;

    // Check if we have a persisted tree state
    const persistedState = await dbOrTrx
      .selectFrom("merkle_tree_nodes")
      .select("hash_value")
      .where("group_id", "=", groupId)
      .where("level", "=", 0)
      .where("index_at_level", "=", 0)
      .executeTakeFirst();

    if (persistedState) {
      // We have persisted tree data — rebuild from the serialized state
      // stored at level=max, index=0 (we store the exported JSON there)
      const stateNode = await dbOrTrx
        .selectFrom("merkle_tree_nodes")
        .select("hash_value")
        .where("group_id", "=", groupId)
        .where("level", "=", -1)
        .where("index_at_level", "=", 0)
        .executeTakeFirst();

      if (stateNode) {
        const exported = stateNode.hash_value.toString("utf8");
        const group = Group.import(exported);
        this.groups.set(key, group);
        return group;
      }
    }

    // No persisted state — rebuild from members
    const members = await dbOrTrx
      .selectFrom("semaphore_members")
      .select(["identity_commitment", "is_revoked"])
      .where("group_id", "=", groupId)
      .orderBy("leaf_index", "asc")
      .execute();

    const commitments = members.map((m) =>
      m.is_revoked ? 0n : bufferToBigInt(m.identity_commitment)
    );

    // Filter out trailing zeros (members that haven't been added yet)
    // but keep interior zeros (revoked members)
    const group =
      commitments.length > 0 ? new Group(commitments) : new Group();
    this.groups.set(key, group);
    return group;
  }

  /**
   * Persists the full tree state to the database.
   * Stores the root hash and the serialized tree for fast restoration.
   */
  private async persistTreeState(
    groupId: Buffer,
    group: Group,
    trx: Transaction<Database>
  ): Promise<void> {
    const key = groupId.toString("hex");
    this.groups.set(key, group);

    // Delete existing tree nodes for this group
    await trx
      .deleteFrom("merkle_tree_nodes")
      .where("group_id", "=", groupId)
      .execute();

    if (group.size === 0) return;

    // Store the root as a regular node at level=depth, index=0
    const rootBuf = bigIntToBuffer32(group.root);
    await trx
      .insertInto("merkle_tree_nodes")
      .values({
        group_id: groupId,
        level: group.depth,
        index_at_level: 0,
        hash_value: rootBuf,
      })
      .execute();

    // Store leaf nodes (level=0) for queryability
    const leafInserts = group.members.map((member, i) => ({
      group_id: groupId,
      level: 0,
      index_at_level: i,
      hash_value: bigIntToBuffer32(member),
    }));

    if (leafInserts.length > 0) {
      await trx
        .insertInto("merkle_tree_nodes")
        .values(leafInserts)
        .execute();
    }

    // Store the serialized tree state at level=-1 for fast restoration
    const exported = group.export();
    const exportedBuf = Buffer.from(exported, "utf8");
    await trx
      .insertInto("merkle_tree_nodes")
      .values({
        group_id: groupId,
        level: -1,
        index_at_level: 0,
        hash_value: exportedBuf,
      })
      .execute();
  }

  /**
   * Invalidates the in-memory cache for a group.
   * Useful after external modifications to the DB.
   */
  invalidateCache(groupId: Buffer): void {
    this.groups.delete(groupId.toString("hex"));
  }

  /** Clears all cached groups */
  clearCache(): void {
    this.groups.clear();
  }
}

// ─── BigInt / Buffer conversion ─────────────────────────────────────────────

function bufferToBigInt(buf: Buffer): bigint {
  if (buf.length === 0) return 0n;
  return BigInt("0x" + buf.toString("hex"));
}

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
