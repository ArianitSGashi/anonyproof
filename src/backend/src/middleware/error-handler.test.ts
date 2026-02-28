import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import {
  errorHandler,
  AppError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  TooManyRequestsError,
} from "./error-handler.js";

/** Creates a mock Express Response object. */
function createMockRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

const mockReq = {} as Request;
const mockNext: NextFunction = vi.fn();

describe("errorHandler", () => {
  it("handles AppError with correct status and code", () => {
    const res = createMockRes();
    const err = new AppError("Something went wrong", 422, "UNPROCESSABLE");

    errorHandler(err, mockReq, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({
      message: "Something went wrong",
      code: "UNPROCESSABLE",
    });
  });

  it("handles BadRequestError (400)", () => {
    const res = createMockRes();
    errorHandler(new BadRequestError("Bad input"), mockReq, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message: "Bad input",
      code: "BAD_REQUEST",
    });
  });

  it("handles UnauthorizedError (401)", () => {
    const res = createMockRes();
    errorHandler(new UnauthorizedError(), mockReq, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      message: "Authentication required",
      code: "UNAUTHORIZED",
    });
  });

  it("handles ForbiddenError (403)", () => {
    const res = createMockRes();
    errorHandler(new ForbiddenError(), mockReq, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("handles NotFoundError (404)", () => {
    const res = createMockRes();
    errorHandler(new NotFoundError("Post not found"), mockReq, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      message: "Post not found",
      code: "NOT_FOUND",
    });
  });

  it("handles ConflictError (409)", () => {
    const res = createMockRes();
    errorHandler(new ConflictError("Duplicate nullifier"), mockReq, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      message: "Duplicate nullifier",
      code: "CONFLICT",
    });
  });

  it("handles TooManyRequestsError (429)", () => {
    const res = createMockRes();
    errorHandler(new TooManyRequestsError(), mockReq, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(429);
  });

  it("handles unknown errors with 500 and generic message", () => {
    const res = createMockRes();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    errorHandler(new Error("unexpected"), mockReq, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      message: "Internal server error",
      code: "INTERNAL_ERROR",
    });
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it("handles non-Error objects with 500", () => {
    const res = createMockRes();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    errorHandler("string error", mockReq, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      message: "Internal server error",
      code: "INTERNAL_ERROR",
    });

    consoleErrorSpy.mockRestore();
  });
});
