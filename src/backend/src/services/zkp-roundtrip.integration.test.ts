/**
 * Full Round-Trip ZKP Integration Test
 *
 * Verifies the complete flow:
 *   1. Create a Semaphore Group (in-memory)
 *   2. Create identities and add them as members
 *   3. Generate a Merkle proof for a member
 *   4. Generate a Semaphore proof (client-side)
 *   5. Verify the proof (server-side)
 *
 * This test uses the actual Semaphore cryptographic primitives
 * (no mocks) to prove the full ZKP pipeline works end-to-end.
 *
 * Note: This test takes longer due to snark proof generation/verification.
 */

import { describe, it, expect, afterAll } from "vitest";
import { Identity } from "@semaphore-protocol/identity";
import { Group } from "@semaphore-protocol/group";

// Use dynamic imports for proof functions to work around NodeNext resolution
// of @semaphore-protocol/proof's internal type re-exports
async function semaphoreGenerateProof(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...args: any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const { generateProof } = await import("@semaphore-protocol/proof");
  return generateProof(...args);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function semaphoreVerifyProof(proof: any): Promise<boolean> {
  const { verifyProof } = await import("@semaphore-protocol/proof");
  return verifyProof(proof);
}

describe("ZKP Round-Trip Integration", () => {
  // Clean up the bn128 curve to prevent leaked handles
  afterAll(async () => {
    try {
      // Dynamic import with type assertion to avoid missing type declarations
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ffjs = (await Function('return import("ffjavascript")')()) as any;
      const curve = await ffjs.getCurveFromName("bn128");
      await curve.terminate();
    } catch {
      // Ignore if ffjavascript is not available
    }
  });

  it("completes full create-group → add-member → proof → verify flow", async () => {
    // ─── Step 1: Create identities ────────────────────────────────────
    const identity1 = new Identity("secret-key-1");
    const identity2 = new Identity("secret-key-2");
    const identity3 = new Identity("secret-key-3");

    expect(identity1.commitment).toBeTruthy();
    expect(identity2.commitment).toBeTruthy();
    expect(identity1.commitment).not.toBe(identity2.commitment);

    // ─── Step 2: Create a group and add members ───────────────────────
    const group = new Group([
      identity1.commitment,
      identity2.commitment,
      identity3.commitment,
    ]);

    expect(group.size).toBe(3);
    expect(group.root).toBeTruthy();

    // ─── Step 3: Generate Merkle proof for identity1 ──────────────────
    const merkleProof = group.generateMerkleProof(0);

    expect(merkleProof.root).toBe(group.root);
    expect(merkleProof.leaf).toBe(identity1.commitment);
    expect(merkleProof.index).toBe(0);
    expect(merkleProof.siblings.length).toBeGreaterThan(0);

    // ─── Step 4: Generate a Semaphore proof (client-side) ─────────────
    const message = "Hello anonymous world";
    const scope = "test-scope-1";

    const proof = await semaphoreGenerateProof(
      identity1,
      group,
      message,
      scope
    );

    expect(proof).toBeDefined();
    expect(proof.merkleTreeRoot).toBeTruthy();
    expect(proof.nullifier).toBeTruthy();
    expect(proof.scope).toBeTruthy();
    expect(proof.points).toHaveLength(8);

    // ─── Step 5: Verify the proof (server-side) ──────────────────────
    const isValid = await semaphoreVerifyProof(proof);

    expect(isValid).toBe(true);
  }, 60_000); // Generous timeout for snark operations

  it("rejects proof from non-member identity", async () => {
    const member = new Identity("member-key");
    const nonMember = new Identity("non-member-key");

    const group = new Group([member.commitment]);

    // Non-member tries to generate proof — this should throw
    // because their commitment isn't in the group
    await expect(
      semaphoreGenerateProof(nonMember, group, "message", "scope")
    ).rejects.toThrow();
  }, 30_000);

  it("produces different nullifiers for different scopes (same identity)", async () => {
    const identity = new Identity("test-identity-key");
    const group = new Group([identity.commitment]);

    const proof1 = await semaphoreGenerateProof(
      identity,
      group,
      "message",
      "scope-A"
    );
    const proof2 = await semaphoreGenerateProof(
      identity,
      group,
      "message",
      "scope-B"
    );

    // Different scopes → different nullifiers (prevents cross-scope correlation)
    expect(proof1.nullifier).not.toBe(proof2.nullifier);

    // But both proofs should be valid
    expect(await semaphoreVerifyProof(proof1)).toBe(true);
    expect(await semaphoreVerifyProof(proof2)).toBe(true);
  }, 60_000);

  it("produces same nullifier for same scope (same identity) — prevents double-action", async () => {
    const identity = new Identity("double-action-test-key");
    const group = new Group([identity.commitment]);

    const proof1 = await semaphoreGenerateProof(
      identity,
      group,
      "message-1",
      "same-scope"
    );
    const proof2 = await semaphoreGenerateProof(
      identity,
      group,
      "message-2",
      "same-scope"
    );

    // Same identity + same scope → same nullifier
    // This is the core double-voting prevention mechanism
    expect(proof1.nullifier).toBe(proof2.nullifier);
  }, 60_000);

  it("different identities produce different nullifiers (same scope)", async () => {
    const identity1 = new Identity("user-1");
    const identity2 = new Identity("user-2");
    const group = new Group([identity1.commitment, identity2.commitment]);

    const proof1 = await semaphoreGenerateProof(
      identity1,
      group,
      "message",
      "same-scope"
    );
    const proof2 = await semaphoreGenerateProof(
      identity2,
      group,
      "message",
      "same-scope"
    );

    // Different identities → different nullifiers (even with same scope)
    expect(proof1.nullifier).not.toBe(proof2.nullifier);
  }, 60_000);

  it("proof includes correct merkle tree root", async () => {
    const identity = new Identity("root-check-key");
    const group = new Group([identity.commitment]);

    const proof = await semaphoreGenerateProof(
      identity,
      group,
      "message",
      "scope"
    );

    // The proof's merkle root should match the group's root
    expect(BigInt(proof.merkleTreeRoot)).toBe(group.root);
  }, 30_000);

  it("member removal invalidates proofs against updated root", async () => {
    const identity1 = new Identity("keep-member");
    const identity2 = new Identity("remove-member");

    const group = new Group([identity1.commitment, identity2.commitment]);
    const rootBefore = group.root;

    // Remove identity2
    group.removeMember(1);
    const rootAfter = group.root;

    expect(rootBefore).not.toBe(rootAfter);

    // identity1 can still generate a valid proof with the new tree
    const proof = await semaphoreGenerateProof(
      identity1,
      group,
      "message",
      "scope"
    );
    expect(await semaphoreVerifyProof(proof)).toBe(true);

    // The proof's root matches the current (post-removal) root
    expect(BigInt(proof.merkleTreeRoot)).toBe(rootAfter);
  }, 30_000);
});
