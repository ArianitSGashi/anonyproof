import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { createRequireAdmin, requireRole } from "./auth.js";
import type { AdminService, AdminTokenPayload } from "../services/admin.service.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockRequest(headers: Record<string, string> = {}): Request {
  return {
    headers,
    admin: undefined,
  } as unknown as Request;
}

function mockResponse(): Response {
  return {} as Response;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("createRequireAdmin", () => {
  let middleware: ReturnType<typeof createRequireAdmin>;
  let mockAdminService: AdminService;
  const next: NextFunction = vi.fn();

  const validPayload: AdminTokenPayload = {
    sub: "admin-uuid-1",
    username: "admin1",
    role: "admin",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminService = {
      verifyToken: vi.fn().mockReturnValue(validPayload),
    } as unknown as AdminService;
    middleware = createRequireAdmin(mockAdminService);
  });

  it("attaches req.admin and calls next() for valid Bearer token", () => {
    const req = mockRequest({ authorization: "Bearer valid-token" });
    const res = mockResponse();

    middleware(req, res, next);

    expect(mockAdminService.verifyToken).toHaveBeenCalledWith("valid-token");
    expect(req.admin).toEqual(validPayload);
    expect(next).toHaveBeenCalled();
  });

  it("throws UnauthorizedError when Authorization header is missing", () => {
    const req = mockRequest({});
    const res = mockResponse();

    expect(() => middleware(req, res, next)).toThrow(
      "Missing Authorization header"
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("throws UnauthorizedError when Authorization header is not Bearer", () => {
    const req = mockRequest({ authorization: "Basic abc123" });
    const res = mockResponse();

    expect(() => middleware(req, res, next)).toThrow(
      "Authorization header must use Bearer scheme"
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("throws UnauthorizedError when token is empty", () => {
    const req = mockRequest({ authorization: "Bearer " });
    const res = mockResponse();

    expect(() => middleware(req, res, next)).toThrow("Missing token");
    expect(next).not.toHaveBeenCalled();
  });

  it("throws UnauthorizedError when token verification fails", () => {
    vi.mocked(mockAdminService.verifyToken).mockImplementation(() => {
      throw new Error("Invalid or expired token");
    });

    const req = mockRequest({ authorization: "Bearer bad-token" });
    const res = mockResponse();

    expect(() => middleware(req, res, next)).toThrow();
    expect(next).not.toHaveBeenCalled();
  });
});

describe("requireRole", () => {
  const next: NextFunction = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls next() when admin has an allowed role", () => {
    const middleware = requireRole("admin", "superadmin");
    const req = mockRequest();
    req.admin = { sub: "1", username: "admin1", role: "admin" };

    middleware(req, mockResponse(), next);

    expect(next).toHaveBeenCalled();
  });

  it("throws ForbiddenError when admin does not have required role", () => {
    const middleware = requireRole("superadmin");
    const req = mockRequest();
    req.admin = { sub: "1", username: "mod1", role: "moderator" };

    expect(() => middleware(req, mockResponse(), next)).toThrow(
      "Requires one of: superadmin"
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("throws UnauthorizedError when req.admin is not set", () => {
    const middleware = requireRole("admin");
    const req = mockRequest();

    expect(() => middleware(req, mockResponse(), next)).toThrow(
      "Authentication required"
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("allows superadmin through when superadmin is in allowed roles", () => {
    const middleware = requireRole("superadmin");
    const req = mockRequest();
    req.admin = { sub: "1", username: "super1", role: "superadmin" };

    middleware(req, mockResponse(), next);

    expect(next).toHaveBeenCalled();
  });
});
