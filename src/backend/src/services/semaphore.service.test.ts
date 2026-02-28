import { describe, it, expect, vi, beforeEach } from "vitest";
import { SemaphoreService, type SemaphoreProof } from "./semaphore.service.js";

// ─── Mock DB ──────────────────────────────────────────────────────────────────

const mockExecuteTakeFirst = vi.fn();

/* eslint-disable @typescript-eslint/no-explicit-any */
const mockQueryBuilder: any = {};
mockQueryBuilder.selectFrom = vi.fn().mockReturnValue(mockQueryBuilder);
mockQueryBuilder.select = vi.fn().mockReturnValue(mockQueryBuilder);
mockQueryBuilder.where = vi.fn().mockReturnValue(mockQueryBuilder);
mockQueryBuilder.executeTakeFirst = mockExecuteTakeFirst;
/* eslint-enable @typescript-eslint/no-explicit-any */

vi.mock("../db/index.js", () => ({
  getDb: () => mockQueryBuilder,
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SemaphoreService", () => {
  let service: SemaphoreService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SemaphoreService();

    // Refresh mock chain
    mockQueryBuilder.selectFrom = vi.fn().mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.select = vi.fn().mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.where = vi.fn().mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.executeTakeFirst = mockExecuteTakeFirst;
  });

  // ─── extractNullifierHash ───────────────────────────────────────────

  describe("extractNullifierHash", () => {
    it("converts a numeric string nullifier to a 32-byte Buffer", () => {
      const proof: SemaphoreProof = {
        merkleTreeDepth: 20,
        merkleTreeRoot: "12345",
        message: "0",
        nullifier: "255", // 0xFF
        scope: "test-scope",
        points: ["0", "0", "0", "0", "0", "0", "0", "0"],
      };

      const result = service.extractNullifierHash(proof);
      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.length).toBe(32);
      // 255 = 0xff, should be at the last byte
      expect(result[31]).toBe(0xff);
      // All other bytes should be 0
      expect(result.subarray(0, 31).every((b) => b === 0)).toBe(true);
    });

    it("handles large nullifier values", () => {
      const largeBigInt = BigInt("0x" + "ff".repeat(32));
      const proof: SemaphoreProof = {
        merkleTreeDepth: 20,
        merkleTreeRoot: "0",
        message: "0",
        nullifier: largeBigInt.toString(),
        scope: "test",
        points: ["0", "0", "0", "0", "0", "0", "0", "0"],
      };

      const result = service.extractNullifierHash(proof);
      expect(result.length).toBe(32);
      expect(result.every((b) => b === 0xff)).toBe(true);
    });

    it("handles zero nullifier", () => {
      const proof: SemaphoreProof = {
        merkleTreeDepth: 20,
        merkleTreeRoot: "0",
        message: "0",
        nullifier: "0",
        scope: "test",
        points: ["0", "0", "0", "0", "0", "0", "0", "0"],
      };

      const result = service.extractNullifierHash(proof);
      expect(result.length).toBe(32);
      expect(result.every((b) => b === 0)).toBe(true);
    });
  });

  // ─── buildExternalNullifier ─────────────────────────────────────────

  describe("buildExternalNullifier", () => {
    it("formats scope:groupIdHex", () => {
      const groupId = Buffer.alloc(32, 0xaa);
      const result = service.buildExternalNullifier("post", groupId);
      expect(result).toBe(`post:${"aa".repeat(32)}`);
    });

    it("handles complex scope strings", () => {
      const groupId = Buffer.alloc(32, 0x01);
      const result = service.buildExternalNullifier(
        "comment:post-uuid-123",
        groupId
      );
      expect(result).toBe(`comment:post-uuid-123:${"01".repeat(32)}`);
    });

    it("handles vote scopes", () => {
      const groupId = Buffer.alloc(32, 0xff);
      const result = service.buildExternalNullifier(
        "vote:post-uuid-456",
        groupId
      );
      expect(result).toBe(`vote:post-uuid-456:${"ff".repeat(32)}`);
    });
  });

  // ─── isNullifierUsed ────────────────────────────────────────────────

  describe("isNullifierUsed", () => {
    const nullifierHash = Buffer.alloc(32, 0xaa);
    const externalNullifier = "post:groupid";

    it("returns false when nullifier is unused", async () => {
      mockExecuteTakeFirst
        .mockResolvedValueOnce(undefined) // posts
        .mockResolvedValueOnce(undefined) // comments
        .mockResolvedValueOnce(undefined); // votes

      const result = await service.isNullifierUsed(
        nullifierHash,
        externalNullifier
      );
      expect(result).toBe(false);
    });

    it("returns true when nullifier found in posts", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce({ id: "post-1" });

      const result = await service.isNullifierUsed(
        nullifierHash,
        externalNullifier
      );
      expect(result).toBe(true);
    });

    it("returns true when nullifier found in comments", async () => {
      mockExecuteTakeFirst
        .mockResolvedValueOnce(undefined) // posts - not found
        .mockResolvedValueOnce({ id: "comment-1" }); // comments - found

      const result = await service.isNullifierUsed(
        nullifierHash,
        externalNullifier
      );
      expect(result).toBe(true);
    });

    it("returns true when nullifier found in votes", async () => {
      mockExecuteTakeFirst
        .mockResolvedValueOnce(undefined) // posts
        .mockResolvedValueOnce(undefined) // comments
        .mockResolvedValueOnce({ id: "vote-1" }); // votes

      const result = await service.isNullifierUsed(
        nullifierHash,
        externalNullifier
      );
      expect(result).toBe(true);
    });

    it("checks all three tables in order", async () => {
      mockExecuteTakeFirst
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);

      await service.isNullifierUsed(nullifierHash, externalNullifier);

      // Should have called selectFrom three times for three tables
      const calls = (mockQueryBuilder.selectFrom as ReturnType<typeof vi.fn>)
        .mock.calls;
      expect(calls).toHaveLength(3);
      expect(calls[0]![0]).toBe("posts");
      expect(calls[1]![0]).toBe("comments");
      expect(calls[2]![0]).toBe("votes");
    });
  });

  // ─── verifyProof ────────────────────────────────────────────────────

  describe("verifyProof", () => {
    it("rejects proof with mismatched Merkle root", async () => {
      const proof: SemaphoreProof = {
        merkleTreeDepth: 20,
        merkleTreeRoot: "999",
        message: "0",
        nullifier: "0",
        scope: "test",
        points: ["0", "0", "0", "0", "0", "0", "0", "0"],
      };

      const expectedRoot = Buffer.alloc(32, 0x01); // different from "999"

      const result = await service.verifyProof(proof, expectedRoot, "test");
      expect(result).toBe(false);
    });

    it("rejects proof with mismatched scope", async () => {
      // Create a root that matches
      const rootBigInt = BigInt(12345);
      let hex = rootBigInt.toString(16);
      if (hex.length % 2 !== 0) hex = "0" + hex;
      const rootBuf = Buffer.alloc(32);
      const raw = Buffer.from(hex, "hex");
      raw.copy(rootBuf, 32 - raw.length);

      const proof: SemaphoreProof = {
        merkleTreeDepth: 20,
        merkleTreeRoot: "12345",
        message: "0",
        nullifier: "0",
        scope: "wrong-scope",
        points: ["0", "0", "0", "0", "0", "0", "0", "0"],
      };

      const result = await service.verifyProof(
        proof,
        rootBuf,
        "expected-scope"
      );
      expect(result).toBe(false);
    });
  });
});
