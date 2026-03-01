import { describe, it, expect, vi, beforeEach } from "vitest";
import { AdminService } from "./admin.service.js";

// ─── Mock bcrypt ──────────────────────────────────────────────────────────────

vi.mock("bcrypt", () => ({
  default: {
    compare: vi.fn(),
    hash: vi.fn(),
  },
}));

import bcrypt from "bcrypt";

// ─── Mock jsonwebtoken ────────────────────────────────────────────────────────

vi.mock("jsonwebtoken", () => ({
  default: {
    sign: vi.fn().mockReturnValue("mock-jwt-token"),
    verify: vi.fn(),
  },
}));

import jwt from "jsonwebtoken";

// ─── Mock DB ──────────────────────────────────────────────────────────────────

const mockExecuteTakeFirstOrThrow = vi.fn();
const mockExecuteTakeFirst = vi.fn();
const mockExecute = vi.fn();

const mockQueryBuilder: any = {
  selectFrom: vi.fn().mockReturnThis(),
  insertInto: vi.fn().mockReturnThis(),
  updateTable: vi.fn().mockReturnThis(),
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

const JWT_SECRET = "test-secret-must-be-at-least-32-characters-long";

function resetMockChain(): void {
  mockQueryBuilder.selectFrom = vi.fn().mockReturnValue(mockQueryBuilder);
  mockQueryBuilder.insertInto = vi.fn().mockReturnValue(mockQueryBuilder);
  mockQueryBuilder.updateTable = vi.fn().mockReturnValue(mockQueryBuilder);
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

describe("AdminService", () => {
  let service: AdminService;

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockChain();
    service = new AdminService(JWT_SECRET);
  });

  describe("constructor", () => {
    it("throws if JWT secret is too short", () => {
      expect(() => new AdminService("short")).toThrow(
        "JWT secret must be at least 32 characters"
      );
    });

    it("accepts a valid JWT secret", () => {
      expect(() => new AdminService(JWT_SECRET)).not.toThrow();
    });
  });

  describe("login", () => {
    const mockAdmin = {
      id: "admin-uuid-1",
      username: "admin1",
      email: "admin@test.edu",
      password_hash: "$2b$12$hashedpassword",
      role: "admin" as const,
      is_active: true,
    };

    it("returns a JWT on successful login", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce(mockAdmin);
      vi.mocked(bcrypt.compare).mockResolvedValueOnce(true as never);
      mockExecute.mockResolvedValueOnce([]); // update last_login

      const result = await service.login("admin1", "password123");

      expect(result.token).toBe("mock-jwt-token");
      expect(result.admin.id).toBe("admin-uuid-1");
      expect(result.admin.username).toBe("admin1");
      expect(result.admin.role).toBe("admin");

      expect(jwt.sign).toHaveBeenCalledWith(
        { sub: "admin-uuid-1", username: "admin1", role: "admin" },
        JWT_SECRET,
        { expiresIn: 28800 }
      );
    });

    it("throws UnauthorizedError for non-existent user", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce(undefined);

      await expect(service.login("nobody", "password")).rejects.toThrow(
        "Invalid username or password"
      );
    });

    it("throws UnauthorizedError for wrong password", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce(mockAdmin);
      vi.mocked(bcrypt.compare).mockResolvedValueOnce(false as never);

      await expect(service.login("admin1", "wrongpass")).rejects.toThrow(
        "Invalid username or password"
      );
    });

    it("throws UnauthorizedError for inactive account", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce({
        ...mockAdmin,
        is_active: false,
      });

      await expect(service.login("admin1", "password")).rejects.toThrow(
        "Account is deactivated"
      );
    });

    it("updates last_login on successful login", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce(mockAdmin);
      vi.mocked(bcrypt.compare).mockResolvedValueOnce(true as never);
      mockExecute.mockResolvedValueOnce([]);

      await service.login("admin1", "password123");

      expect(mockQueryBuilder.updateTable).toHaveBeenCalledWith("admin_users");
      expect(mockQueryBuilder.set).toHaveBeenCalled();
    });
  });

  describe("createAdmin", () => {
    it("creates an admin when caller is superadmin", async () => {
      // Caller lookup → superadmin
      mockExecuteTakeFirst
        .mockResolvedValueOnce({ id: "superadmin-1", role: "superadmin" })
        // Username check → not exists
        .mockResolvedValueOnce(undefined)
        // Email check → not exists
        .mockResolvedValueOnce(undefined);

      vi.mocked(bcrypt.hash).mockResolvedValueOnce("$2b$12$hashed" as never);

      mockExecuteTakeFirstOrThrow.mockResolvedValueOnce({
        id: "new-admin-id",
      });
      mockExecute.mockResolvedValueOnce([]); // audit log insert

      const result = await service.createAdmin(
        "newadmin",
        "newadmin@test.edu",
        "securepassword",
        "moderator",
        "superadmin-1"
      );

      expect(result.id).toBe("new-admin-id");
      expect(bcrypt.hash).toHaveBeenCalledWith("securepassword", 12);
      expect(mockQueryBuilder.insertInto).toHaveBeenCalledWith("admin_users");
    });

    it("throws ForbiddenError when caller is not superadmin", async () => {
      mockExecuteTakeFirst.mockResolvedValueOnce({
        id: "admin-1",
        role: "admin",
      });

      await expect(
        service.createAdmin(
          "newadmin",
          "new@test.edu",
          "securepass1",
          "moderator",
          "admin-1"
        )
      ).rejects.toThrow("Only superadmins can create admin accounts");
    });

    it("throws ConflictError for duplicate username", async () => {
      mockExecuteTakeFirst
        .mockResolvedValueOnce({ id: "sa-1", role: "superadmin" })
        .mockResolvedValueOnce({ id: "existing" }); // username exists

      await expect(
        service.createAdmin(
          "taken",
          "new@test.edu",
          "securepass1",
          "admin",
          "sa-1"
        )
      ).rejects.toThrow("Username already exists");
    });

    it("throws ConflictError for duplicate email", async () => {
      mockExecuteTakeFirst
        .mockResolvedValueOnce({ id: "sa-1", role: "superadmin" })
        .mockResolvedValueOnce(undefined) // username OK
        .mockResolvedValueOnce({ id: "existing" }); // email exists

      await expect(
        service.createAdmin(
          "uniqueuser",
          "taken@test.edu",
          "securepass1",
          "admin",
          "sa-1"
        )
      ).rejects.toThrow("Email already exists");
    });

    it("throws BadRequestError for short password", async () => {
      mockExecuteTakeFirst
        .mockResolvedValueOnce({ id: "sa-1", role: "superadmin" })
        .mockResolvedValueOnce(undefined) // username OK
        .mockResolvedValueOnce(undefined); // email OK

      await expect(
        service.createAdmin(
          "newadmin",
          "new@test.edu",
          "short",
          "admin",
          "sa-1"
        )
      ).rejects.toThrow("Password must be at least 8 characters");
    });

    it("logs the admin creation to admin_actions", async () => {
      mockExecuteTakeFirst
        .mockResolvedValueOnce({ id: "sa-1", role: "superadmin" })
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);

      vi.mocked(bcrypt.hash).mockResolvedValueOnce("$2b$12$hashed" as never);
      mockExecuteTakeFirstOrThrow.mockResolvedValueOnce({
        id: "new-admin-id",
      });
      mockExecute.mockResolvedValueOnce([]);

      await service.createAdmin(
        "newmod",
        "mod@test.edu",
        "securepassword",
        "moderator",
        "sa-1"
      );

      // The second insertInto call should be for admin_actions
      const insertCalls = mockQueryBuilder.insertInto.mock.calls;
      expect(insertCalls).toContainEqual(["admin_actions"]);
    });
  });

  describe("getAuditLog", () => {
    it("returns paginated results", async () => {
      const mockActions = [
        {
          id: "action-1",
          admin_id: "admin-1",
          action_type: "credential_issued",
          target_type: "credential_request",
          target_id: "req-1",
          details: null,
          ip_address: null,
          created_at: new Date(),
        },
      ];

      // Data query + count query resolve in parallel
      mockExecute.mockResolvedValueOnce(mockActions);
      mockExecuteTakeFirst.mockResolvedValueOnce({ count: 1 });

      const result = await service.getAuditLog({}, { page: 1, limit: 10 });

      expect(result.data).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(10);
      expect(result.pagination.totalPages).toBe(1);
    });

    it("applies filters when provided", async () => {
      mockExecute.mockResolvedValueOnce([]);
      mockExecuteTakeFirst.mockResolvedValueOnce({ count: 0 });

      await service.getAuditLog(
        { adminId: "admin-1", actionType: "credential_issued" },
        { page: 1, limit: 20 }
      );

      // where should be called with the filter values
      const whereCalls = mockQueryBuilder.where.mock.calls;
      expect(whereCalls).toContainEqual(["admin_id", "=", "admin-1"]);
      expect(whereCalls).toContainEqual([
        "action_type",
        "=",
        "credential_issued",
      ]);
    });

    it("uses default pagination when not specified", async () => {
      mockExecute.mockResolvedValueOnce([]);
      mockExecuteTakeFirst.mockResolvedValueOnce({ count: 0 });

      const result = await service.getAuditLog({}, {});

      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(20);
    });
  });

  describe("verifyToken", () => {
    it("returns decoded payload for valid token", () => {
      const payload = {
        sub: "admin-1",
        username: "admin1",
        role: "admin" as const,
      };

      vi.mocked(jwt.verify).mockReturnValueOnce(payload as any);

      const result = service.verifyToken("valid-token");
      expect(result).toEqual(payload);
      expect(jwt.verify).toHaveBeenCalledWith("valid-token", JWT_SECRET);
    });

    it("throws UnauthorizedError for invalid token", () => {
      vi.mocked(jwt.verify).mockImplementationOnce(() => {
        throw new Error("invalid signature");
      });

      expect(() => service.verifyToken("bad-token")).toThrow(
        "Invalid or expired token"
      );
    });
  });
});
