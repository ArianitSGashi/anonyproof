import { describe, it, expect, vi, beforeEach } from "vitest";
import { Group } from "@semaphore-protocol/group";
import { MerkleService } from "./merkle.service.js";

// ─── Mock DB ──────────────────────────────────────────────────────────────────

const mockExecuteTakeFirst = vi.fn();
const mockExecute = vi.fn();

/* eslint-disable @typescript-eslint/no-explicit-any */
const createMockTrx = (): any => {
  const trx: any = {};

  trx.selectFrom = vi.fn().mockReturnValue(trx);
  trx.insertInto = vi.fn().mockReturnValue(trx);
  trx.updateTable = vi.fn().mockReturnValue(trx);
  trx.deleteFrom = vi.fn().mockReturnValue(trx);
  trx.select = vi.fn().mockReturnValue(trx);
  trx.selectAll = vi.fn().mockReturnValue(trx);
  trx.values = vi.fn().mockReturnValue(trx);
  trx.set = vi.fn().mockReturnValue(trx);
  trx.where = vi.fn().mockReturnValue(trx);
  trx.orderBy = vi.fn().mockReturnValue(trx);
  trx.fn = {
    countAll: vi.fn().mockReturnValue({ as: vi.fn().mockReturnValue("count") }),
  };
  trx.executeTakeFirst = mockExecuteTakeFirst;
  trx.execute = mockExecute;

  return trx;
};

const mockTrx = createMockTrx();

const mockDb: any = {
  transaction: vi.fn().mockReturnValue({
    execute: vi.fn(async (fn: (trx: any) => Promise<any>) => fn(mockTrx)),
  }),
  selectFrom: vi.fn().mockReturnValue(mockTrx),
  deleteFrom: vi.fn().mockReturnValue(mockTrx),
  insertInto: vi.fn().mockReturnValue(mockTrx),
};
/* eslint-enable @typescript-eslint/no-explicit-any */

vi.mock("../db/index.js", () => ({
  getDb: () => mockDb,
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("MerkleService", () => {
  let merkleService: MerkleService;
  const testGroupId = Buffer.alloc(32, 0xaa);
  const testCommitment = Buffer.alloc(32, 0xbb);

  beforeEach(() => {
    vi.clearAllMocks();
    merkleService = new MerkleService();

    // Refresh mock chain
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const refreshMock = (obj: any) => {
      obj.selectFrom = vi.fn().mockReturnValue(obj);
      obj.insertInto = vi.fn().mockReturnValue(obj);
      obj.updateTable = vi.fn().mockReturnValue(obj);
      obj.deleteFrom = vi.fn().mockReturnValue(obj);
      obj.select = vi.fn().mockReturnValue(obj);
      obj.selectAll = vi.fn().mockReturnValue(obj);
      obj.values = vi.fn().mockReturnValue(obj);
      obj.set = vi.fn().mockReturnValue(obj);
      obj.where = vi.fn().mockReturnValue(obj);
      obj.orderBy = vi.fn().mockReturnValue(obj);
      obj.fn = {
        countAll: vi.fn().mockReturnValue({
          as: vi.fn().mockReturnValue("count"),
        }),
      };
      obj.executeTakeFirst = mockExecuteTakeFirst;
      obj.execute = mockExecute;
    };
    /* eslint-enable @typescript-eslint/no-explicit-any */

    refreshMock(mockTrx);
    mockDb.transaction = vi.fn().mockReturnValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      execute: vi.fn(async (fn: (trx: any) => Promise<any>) =>
        fn(mockTrx)
      ),
    });
    mockDb.selectFrom = vi.fn().mockReturnValue(mockTrx);
    mockDb.deleteFrom = vi.fn().mockReturnValue(mockTrx);
    mockDb.insertInto = vi.fn().mockReturnValue(mockTrx);
  });

  describe("addMember", () => {
    it("adds a member and returns the leaf index", async () => {
      // Mock: group exists
      mockExecuteTakeFirst
        .mockResolvedValueOnce({
          group_id: testGroupId,
          depth: 20,
        })
        // Mock: member count = 0
        .mockResolvedValueOnce({ count: 0 })
        // Mock: no existing tree state (loadGroup)
        .mockResolvedValueOnce(undefined);
      mockExecute
        .mockResolvedValueOnce(undefined) // insert member
        .mockResolvedValueOnce([]) // loadGroup - no members in DB
        .mockResolvedValueOnce(undefined) // delete tree nodes
        .mockResolvedValueOnce(undefined) // insert root node
        .mockResolvedValueOnce(undefined) // insert leaf nodes
        .mockResolvedValueOnce(undefined); // insert serialized state

      const result = await merkleService.addMember(testGroupId, testCommitment);
      expect(result.leafIndex).toBe(0);
    });
  });

  describe("in-memory Group operations", () => {
    it("computes correct Merkle root with Semaphore Group", () => {
      const commitment1 = BigInt("0x" + "aa".repeat(32));
      const commitment2 = BigInt("0x" + "bb".repeat(32));

      const group = new Group([commitment1, commitment2]);
      expect(group.root).toBeTruthy();
      expect(group.size).toBe(2);
      expect(group.depth).toBeGreaterThan(0);
    });

    it("generates valid Merkle proofs", () => {
      const commitment1 = BigInt("0x" + "aa".repeat(32));
      const commitment2 = BigInt("0x" + "bb".repeat(32));
      const commitment3 = BigInt("0x" + "cc".repeat(32));

      const group = new Group([commitment1, commitment2, commitment3]);
      const proof = group.generateMerkleProof(0);

      expect(proof.root).toBe(group.root);
      expect(proof.leaf).toBe(commitment1);
      expect(proof.index).toBe(0);
      expect(proof.siblings.length).toBeGreaterThan(0);
    });

    it("removes a member by setting leaf to 0", () => {
      const commitment1 = BigInt("0x" + "aa".repeat(32));
      const commitment2 = BigInt("0x" + "bb".repeat(32));

      const group = new Group([commitment1, commitment2]);
      const rootBefore = group.root;

      group.removeMember(0);

      expect(group.root).not.toBe(rootBefore);
      expect(group.members[0]).toBe(0n);
      expect(group.size).toBe(2); // Size doesn't change, leaf becomes 0
    });

    it("tree root changes when a member is added", () => {
      const commitment1 = BigInt("0x" + "aa".repeat(32));
      const group = new Group([commitment1]);
      const root1 = group.root;

      const commitment2 = BigInt("0x" + "bb".repeat(32));
      group.addMember(commitment2);
      const root2 = group.root;

      expect(root1).not.toBe(root2);
    });

    it("export and import preserve tree state", () => {
      const commitment1 = BigInt("0x" + "aa".repeat(32));
      const commitment2 = BigInt("0x" + "bb".repeat(32));

      const group = new Group([commitment1, commitment2]);
      const exported = group.export();

      const imported = Group.import(exported);
      expect(imported.root).toBe(group.root);
      expect(imported.size).toBe(group.size);
      expect(imported.members).toEqual(group.members);
    });
  });

  describe("Group edge cases", () => {
    it("empty group has root 0", () => {
      const group = new Group();
      expect(group.root).toBe(0n);
    });

    it("single member group has a valid root", () => {
      const commitment = BigInt("0x" + "dd".repeat(32));
      const group = new Group([commitment]);
      expect(group.root).toBe(commitment); // Root equals the single leaf
      expect(group.size).toBe(1);
      expect(group.depth).toBe(0);
    });
  });
});
