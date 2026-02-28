import { describe, it, expect, vi, beforeEach } from "vitest";
import { GroupService } from "./group.service.js";
import type { MerkleService } from "./merkle.service.js";

// ─── Mock DB ──────────────────────────────────────────────────────────────────

const mockExecuteTakeFirstOrThrow = vi.fn();
const mockExecuteTakeFirst = vi.fn();
const mockExecute = vi.fn();

const mockQueryBuilder = {
  insertInto: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returningAll: vi.fn().mockReturnThis(),
  selectFrom: vi.fn().mockReturnThis(),
  selectAll: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  fn: {
    countAll: vi.fn().mockReturnValue({
      as: vi.fn().mockReturnValue("count"),
    }),
  },
  executeTakeFirstOrThrow: mockExecuteTakeFirstOrThrow,
  executeTakeFirst: mockExecuteTakeFirst,
  execute: mockExecute,
};

vi.mock("../db/index.js", () => ({
  getDb: () => mockQueryBuilder,
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GroupService", () => {
  let groupService: GroupService;
  const mockMerkleService = {} as MerkleService;

  beforeEach(() => {
    vi.clearAllMocks();
    groupService = new GroupService(mockMerkleService);

    // Re-wire mock chain since vi.clearAllMocks breaks returnThis
    mockQueryBuilder.insertInto = vi.fn().mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.values = vi.fn().mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.returningAll = vi.fn().mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.selectFrom = vi.fn().mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.selectAll = vi.fn().mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.select = vi.fn().mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.where = vi.fn().mockReturnValue(mockQueryBuilder);
    mockQueryBuilder.orderBy = vi.fn().mockReturnValue(mockQueryBuilder);
  });

  describe("createGroup", () => {
    it("creates a group with correct parameters", async () => {
      const mockGroup = {
        id: "uuid-1",
        group_id: Buffer.alloc(32),
        name: "Test University",
        description: "A test group",
        depth: 20,
        zero_value: Buffer.alloc(32),
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockExecuteTakeFirstOrThrow.mockResolvedValueOnce(mockGroup);

      const result = await groupService.createGroup(
        "Test University",
        "A test group",
        20
      );

      expect(result.name).toBe("Test University");
      expect(result.depth).toBe(20);
      expect(mockQueryBuilder.insertInto).toHaveBeenCalledWith(
        "semaphore_groups"
      );

      // Verify the values() call includes proper fields
      const valuesCall = mockQueryBuilder.values.mock.calls[0]![0];
      expect(valuesCall.name).toBe("Test University");
      expect(valuesCall.description).toBe("A test group");
      expect(valuesCall.depth).toBe(20);
      expect(Buffer.isBuffer(valuesCall.group_id)).toBe(true);
      expect(valuesCall.group_id.length).toBe(32);
      expect(Buffer.isBuffer(valuesCall.zero_value)).toBe(true);
      expect(valuesCall.zero_value.length).toBe(32);
    });

    it("generates unique group_ids", async () => {
      const ids: Buffer[] = [];

      mockExecuteTakeFirstOrThrow.mockResolvedValue({
        id: "uuid",
        group_id: Buffer.alloc(32),
        name: "test",
        depth: 20,
        zero_value: Buffer.alloc(32),
        created_at: new Date(),
        updated_at: new Date(),
      });

      await groupService.createGroup("Group 1", "", 20);
      ids.push(mockQueryBuilder.values.mock.calls[0]![0].group_id);

      await groupService.createGroup("Group 2", "", 20);
      ids.push(mockQueryBuilder.values.mock.calls[1]![0].group_id);

      expect(ids[0]!.equals(ids[1]!)).toBe(false);
    });

    it("handles empty description by setting null", async () => {
      mockExecuteTakeFirstOrThrow.mockResolvedValueOnce({
        id: "uuid-1",
        group_id: Buffer.alloc(32),
        name: "test",
        description: null,
        depth: 20,
        zero_value: Buffer.alloc(32),
        created_at: new Date(),
        updated_at: new Date(),
      });

      await groupService.createGroup("Test", "", 20);

      const valuesCall = mockQueryBuilder.values.mock.calls[0]![0];
      expect(valuesCall.description).toBeNull();
    });
  });

  describe("getGroup", () => {
    it("returns a group when found", async () => {
      const groupId = Buffer.alloc(32, 1);
      const mockGroup = {
        id: "uuid-1",
        group_id: groupId,
        name: "Test",
        depth: 20,
        zero_value: Buffer.alloc(32),
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockExecuteTakeFirst.mockResolvedValueOnce(mockGroup);

      const result = await groupService.getGroup(groupId);
      expect(result.name).toBe("Test");
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "group_id",
        "=",
        groupId
      );
    });

    it("throws NotFoundError when group does not exist", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce(undefined);

      await expect(
        groupService.getGroup(Buffer.alloc(32))
      ).rejects.toThrow("Group not found");
    });
  });

  describe("listGroups", () => {
    it("returns all groups ordered by created_at desc", async () => {
      const mockGroups = [
        { id: "1", name: "Group A", created_at: new Date() },
        { id: "2", name: "Group B", created_at: new Date() },
      ];

      mockExecute.mockResolvedValueOnce(mockGroups);

      const result = await groupService.listGroups();
      expect(result).toHaveLength(2);
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        "created_at",
        "desc"
      );
    });
  });

  describe("getMemberCount", () => {
    it("returns count of non-revoked members", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce({ count: 5 });

      const result = await groupService.getMemberCount(Buffer.alloc(32));
      expect(result).toBe(5);
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        "is_revoked",
        "=",
        false
      );
    });

    it("returns 0 when no members", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce({ count: 0 });

      const result = await groupService.getMemberCount(Buffer.alloc(32));
      expect(result).toBe(0);
    });
  });
});
