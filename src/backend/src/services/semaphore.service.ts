/**
 * Semaphore ZKP Verification Service
 *
 * Wraps @semaphore-protocol/core proof verification and provides
 * nullifier management for preventing double-actions.
 *
 * Responsibilities:
 *   - Verify Semaphore proofs (server-side)
 *   - Extract and convert nullifier hashes from proofs
 *   - Build group-scoped external nullifier strings
 *   - Check nullifier uniqueness across posts, comments, votes
 *
 * Note: SemaphoreProof type is defined locally because the
 * @semaphore-protocol/proof package's type exports are incompatible
 * with NodeNext module resolution (missing extensions in internal imports).
 */

import { getDb } from "../db/index.js";

/**
 * Packed Groth16 proof — 8 numeric strings representing the proof points.
 * Matches @zk-kit/utils PackedGroth16Proof.
 */
export type PackedGroth16Proof = [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];

/**
 * Semaphore proof structure — matches @semaphore-protocol/proof SemaphoreProof.
 * Defined locally due to NodeNext module resolution incompatibility.
 */
export interface SemaphoreProof {
  merkleTreeDepth: number;
  merkleTreeRoot: string;
  message: string;
  nullifier: string;
  scope: string;
  points: PackedGroth16Proof;
}

export class SemaphoreService {
  /**
   * Verifies a Semaphore proof against expected parameters.
   *
   * Checks that:
   *   1. The proof is cryptographically valid (snark verification)
   *   2. The Merkle root matches the expected group root
   *   3. The scope matches the expected external nullifier
   *
   * @param proof - The Semaphore proof from the client
   * @param expectedMerkleRoot - The current Merkle root of the group
   * @param expectedExternalNullifier - The expected scope/external nullifier
   * @returns true if the proof is valid and parameters match
   */
  async verifyProof(
    proof: SemaphoreProof,
    expectedMerkleRoot: Buffer,
    expectedExternalNullifier: string
  ): Promise<boolean> {
    // Verify the merkle root matches
    const proofRoot = BigInt(proof.merkleTreeRoot);
    const expectedRoot = bufferToBigInt(expectedMerkleRoot);
    if (proofRoot !== expectedRoot) {
      return false;
    }

    // Verify the scope matches the expected external nullifier
    if (proof.scope !== expectedExternalNullifier) {
      return false;
    }

    // Cryptographic verification using the Semaphore library
    // Dynamic import to work around NodeNext resolution issues
    const { verifyProof: semaphoreVerify } = await import(
      "@semaphore-protocol/proof"
    );
    return await semaphoreVerify(proof);
  }

  /**
   * Extracts the nullifier hash from a Semaphore proof as a Buffer.
   * The nullifier is unique per identity per scope, preventing double-actions.
   */
  extractNullifierHash(proof: SemaphoreProof): Buffer {
    return bigIntToBuffer32(BigInt(proof.nullifier));
  }

  /**
   * Builds a group-scoped external nullifier string.
   *
   * Format: `{scope}:{groupId_hex}`
   *
   * This ensures nullifiers are scoped to both the action type and the group,
   * preventing cross-group correlation of identities.
   *
   * @param scope - The action scope (e.g., "post", "comment:postId", "vote:postId")
   * @param groupId - The group's 32-byte identifier
   * @returns The external nullifier string
   */
  buildExternalNullifier(scope: string, groupId: Buffer): string {
    return `${scope}:${groupId.toString("hex")}`;
  }

  /**
   * Checks if a nullifier hash has already been used for a given external nullifier.
   * Queries posts, comments, and votes tables to prevent double-actions.
   *
   * @param nullifierHash - The nullifier hash to check
   * @param externalNullifier - The external nullifier scope
   * @returns true if the nullifier has already been used
   */
  async isNullifierUsed(
    nullifierHash: Buffer,
    externalNullifier: string
  ): Promise<boolean> {
    const db = getDb();

    // Check posts
    const postMatch = await db
      .selectFrom("posts")
      .select("id")
      .where("nullifier_hash", "=", nullifierHash)
      .where("external_nullifier", "=", externalNullifier)
      .executeTakeFirst();

    if (postMatch) return true;

    // Check comments
    const commentMatch = await db
      .selectFrom("comments")
      .select("id")
      .where("nullifier_hash", "=", nullifierHash)
      .where("external_nullifier", "=", externalNullifier)
      .executeTakeFirst();

    if (commentMatch) return true;

    // Check votes
    const voteMatch = await db
      .selectFrom("votes")
      .select("id")
      .where("nullifier_hash", "=", nullifierHash)
      .where("external_nullifier", "=", externalNullifier)
      .executeTakeFirst();

    if (voteMatch) return true;

    return false;
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
