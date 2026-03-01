import { describe, it, expect, vi, beforeEach } from "vitest";
import { CredentialAdminService } from "./credential-admin.service.js";
import type { MerkleService } from "./merkle.service.js";

// ─── Mock DB ──────────────────────────────────────────────────────────────────

const mockExecuteTakeFirstOrThrow = vi.fn();
const mockExecuteTakeFirst = vi.fn();
const mockExecute = vi.fn();

const mockQueryBuilder: any = {
  selectFrom: vi.fn().mockReturnThis(),
  insertInto: vi.fn().mockReturnThis(),
  updateTable: vi.fn().mockReturnThis(),
  withSchema: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  selectAll: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  offset: vi.fn().mockReturnThis(),
  returning: vi.fn().mockReturnThis(),
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

// ─── Test Setup ───────────────────────────────────────────────────────────────

function resetMockChain(): void {
  mockQueryBuilder.selectFrom = vi.fn().mockReturnValue(mockQueryBuilder);
  mockQueryBuilder.insertInto = vi.fn().mockReturnValue(mockQueryBuilder);
  mockQueryBuilder.updateTable = vi.fn().mockReturnValue(mockQueryBuilder);
  mockQueryBuilder.withSchema = vi.fn().mockReturnValue(mockQueryBuilder);
  mockQueryBuilder.select = vi.fn().mockReturnValue(mockQueryBuilder);
  mockQueryBuilder.selectAll = vi.fn().mockReturnValue(mockQueryBuilder);
  mockQueryBuilder.values = vi.fn().mockReturnValue(mockQueryBuilder);
  mockQueryBuilder.set = vi.fn().mockReturnValue(mockQueryBuilder);
  mockQueryBuilder.where = vi.fn().mockReturnValue(mockQueryBuilder);
  mockQueryBuilder.orderBy = vi.fn().mockReturnValue(mockQueryBuilder);
  mockQueryBuilder.limit = vi.fn().mockReturnValue(mockQueryBuilder);
  mockQueryBuilder.offset = vi.fn().mockReturnValue(mockQueryBuilder);
  mockQueryBuilder.returning = vi.fn().mockReturnValue(mockQueryBuilder);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("CredentialAdminService", () => {
  let service: CredentialAdminService;
  let mockMerkleService: MerkleService;

  const validCommitment = Buffer.alloc(32, 0xab);
  const validGroupId = Buffer.alloc(32, 0xcd);

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockChain();

    mockMerkleService = {
      addMember: vi.fn().mockResolvedValue({ leafIndex: 0 }),
      getRoot: vi.fn(),
      getMerkleProof: vi.fn(),
      revokeMember: vi.fn(),
      invalidateCache: vi.fn(),
      clearCache: vi.fn(),
    } as unknown as MerkleService;

    service = new CredentialAdminService(mockMerkleService);
  });

  // ─── requestCredential ────────────────────────────────────────────

  describe("requestCredential", () => {
    it("inserts a credential request and returns request_id", async () => {
      // Group exists
      mockExecuteTakeFirst
        .mockResolvedValueOnce({ id: "group-uuid" }) // group lookup
        .mockResolvedValueOnce(undefined); // no duplicate

      mockExecuteTakeFirstOrThrow.mockResolvedValueOnce({
        request_id: "req-uuid-1",
      });

      const result = await service.requestCredential(
        "student@university.edu",
        validCommitment,
        validGroupId
      );

      expect(result).toBe("req-uuid-1");
      expect(mockQueryBuilder.withSchema).toHaveBeenCalledWith("onboarding");
      expect(mockQueryBuilder.insertInto).toHaveBeenCalledWith(
        "credential_issuance_requests"
      );
    });

    it("throws BadRequestError for invalid email", async () => {
      await expect(
        service.requestCredential("bademail", validCommitment, validGroupId)
      ).rejects.toThrow("Invalid email format");
    });

    it("throws BadRequestError for non-32-byte commitment", async () => {
      const shortBuf = Buffer.alloc(16);

      await expect(
        service.requestCredential(
          "student@uni.edu",
          shortBuf,
          validGroupId
        )
      ).rejects.toThrow("Identity commitment must be exactly 32 bytes");
    });

    it("throws BadRequestError for non-32-byte groupId", async () => {
      const shortBuf = Buffer.alloc(16);

      await expect(
        service.requestCredential(
          "student@uni.edu",
          validCommitment,
          shortBuf
        )
      ).rejects.toThrow("Group ID must be exactly 32 bytes");
    });

    it("throws NotFoundError when group does not exist", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce(undefined);

      await expect(
        service.requestCredential(
          "student@uni.edu",
          validCommitment,
          validGroupId
        )
      ).rejects.toThrow("Group not found");
    });

    it("throws ConflictError for duplicate pending request", async () => {
      mockExecuteTakeFirst
        .mockResolvedValueOnce({ id: "group-uuid" })
        .mockResolvedValueOnce({ id: "existing-req" });

      await expect(
        service.requestCredential(
          "student@uni.edu",
          validCommitment,
          validGroupId
        )
      ).rejects.toThrow("already exists");
    });
  });

  // ─── approveRequest ───────────────────────────────────────────────

  describe("approveRequest", () => {
    const pendingRequest = {
      id: "req-1",
      request_id: "req-uuid-1",
      email: "student@uni.edu",
      group_id: validGroupId,
      status: "pending",
      identity_commitment: validCommitment,
      created_at: new Date(),
      updated_at: new Date(),
    };

    it("adds commitment to Merkle tree and updates status to issued", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce(pendingRequest);
      mockExecute
        .mockResolvedValueOnce([]) // update request
        .mockResolvedValueOnce([]); // audit log

      await service.approveRequest("req-1", "admin-1");

      expect(mockMerkleService.addMember).toHaveBeenCalledWith(
        validGroupId,
        validCommitment
      );

      // Verify status update
      const setCalls = mockQueryBuilder.set.mock.calls;
      expect(setCalls[0]![0]).toMatchObject({ status: "issued" });

      // Verify audit log
      const insertCalls = mockQueryBuilder.insertInto.mock.calls;
      expect(insertCalls).toContainEqual(["admin_actions"]);
    });

    it("throws NotFoundError for non-existent request", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce(undefined);

      await expect(
        service.approveRequest("nonexistent", "admin-1")
      ).rejects.toThrow("Credential request not found");
    });

    it("throws BadRequestError when request is not pending", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce({
        ...pendingRequest,
        status: "issued",
      });

      await expect(
        service.approveRequest("req-1", "admin-1")
      ).rejects.toThrow("already issued");
    });

    it("throws BadRequestError when request has no commitment", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce({
        ...pendingRequest,
        identity_commitment: null,
      });

      await expect(
        service.approveRequest("req-1", "admin-1")
      ).rejects.toThrow("no identity commitment");
    });
  });

  // ─── rejectRequest ────────────────────────────────────────────────

  describe("rejectRequest", () => {
    const pendingRequest = {
      id: "req-1",
      status: "pending",
      email: "student@uni.edu",
      group_id: validGroupId,
    };

    it("updates status to rejected with reason and logs action", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce(pendingRequest);
      mockExecute
        .mockResolvedValueOnce([]) // update request
        .mockResolvedValueOnce([]); // audit log

      await service.rejectRequest("req-1", "admin-1", "Unverified email");

      const setCalls = mockQueryBuilder.set.mock.calls;
      expect(setCalls[0]![0]).toMatchObject({
        status: "rejected",
        rejection_reason: "Unverified email",
      });

      const insertCalls = mockQueryBuilder.insertInto.mock.calls;
      expect(insertCalls).toContainEqual(["admin_actions"]);
    });

    it("throws NotFoundError for non-existent request", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce(undefined);

      await expect(
        service.rejectRequest("nonexistent", "admin-1", "reason")
      ).rejects.toThrow("Credential request not found");
    });

    it("throws BadRequestError when request is not pending", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce({
        ...pendingRequest,
        status: "rejected",
      });

      await expect(
        service.rejectRequest("req-1", "admin-1", "reason")
      ).rejects.toThrow("already rejected");
    });

    it("throws BadRequestError when reason is empty", async () => {
      await expect(
        service.rejectRequest("req-1", "admin-1", "")
      ).rejects.toThrow("Rejection reason is required");
    });

    it("throws BadRequestError when reason is whitespace", async () => {
      await expect(
        service.rejectRequest("req-1", "admin-1", "   ")
      ).rejects.toThrow("Rejection reason is required");
    });
  });

  // ─── getPending ───────────────────────────────────────────────────

  describe("getPending", () => {
    it("returns paginated pending requests", async () => {
      const mockRequests = [
        {
          id: "req-1",
          request_id: "ext-1",
          email: "student1@uni.edu",
          group_id: validGroupId,
          status: "pending",
          rejection_reason: null,
          created_at: new Date("2025-01-01"),
          updated_at: new Date("2025-01-01"),
        },
        {
          id: "req-2",
          request_id: "ext-2",
          email: "student2@uni.edu",
          group_id: validGroupId,
          status: "pending",
          rejection_reason: null,
          created_at: new Date("2025-01-02"),
          updated_at: new Date("2025-01-02"),
        },
      ];

      mockExecute.mockResolvedValueOnce(mockRequests);
      mockExecuteTakeFirst.mockResolvedValueOnce({ count: 2 });

      const result = await service.getPending({ page: 1, limit: 10 });

      expect(result.data).toHaveLength(2);
      expect(result.data[0]!.email).toBe("student1@uni.edu");
      expect(result.data[0]!.groupId).toBe(validGroupId.toString("hex"));
      expect(result.pagination.total).toBe(2);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.totalPages).toBe(1);
    });

    it("uses default pagination values", async () => {
      mockExecute.mockResolvedValueOnce([]);
      mockExecuteTakeFirst.mockResolvedValueOnce({ count: 0 });

      const result = await service.getPending({});

      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(20);
    });

    it("filters only pending requests", async () => {
      mockExecute.mockResolvedValueOnce([]);
      mockExecuteTakeFirst.mockResolvedValueOnce({ count: 0 });

      await service.getPending({ page: 1, limit: 20 });

      const whereCalls = mockQueryBuilder.where.mock.calls;
      expect(whereCalls).toContainEqual(["status", "=", "pending"]);
    });
  });
});
