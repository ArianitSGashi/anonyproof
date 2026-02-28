/**
 * Global error handling middleware for Express 5.
 *
 * Catches all errors thrown in route handlers and middleware,
 * and returns a consistent ApiError JSON response.
 *
 * Express 5 automatically catches rejected promises from async handlers,
 * so we don't need express-async-errors or wrapper functions.
 */

import type { Request, Response, NextFunction } from "express";
import type { ApiError } from "@repo/shared";

/**
 * Custom error class for application errors with HTTP status codes.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, statusCode: number, code: string) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

/**
 * 400 Bad Request
 */
export class BadRequestError extends AppError {
  constructor(message: string, code: string = "BAD_REQUEST") {
    super(message, 400, code);
    this.name = "BadRequestError";
  }
}

/**
 * 401 Unauthorized
 */
export class UnauthorizedError extends AppError {
  constructor(message: string = "Authentication required", code: string = "UNAUTHORIZED") {
    super(message, 401, code);
    this.name = "UnauthorizedError";
  }
}

/**
 * 403 Forbidden
 */
export class ForbiddenError extends AppError {
  constructor(message: string = "Insufficient permissions", code: string = "FORBIDDEN") {
    super(message, 403, code);
    this.name = "ForbiddenError";
  }
}

/**
 * 404 Not Found
 */
export class NotFoundError extends AppError {
  constructor(message: string = "Resource not found", code: string = "NOT_FOUND") {
    super(message, 404, code);
    this.name = "NotFoundError";
  }
}

/**
 * 409 Conflict (e.g., duplicate nullifier)
 */
export class ConflictError extends AppError {
  constructor(message: string, code: string = "CONFLICT") {
    super(message, 409, code);
    this.name = "ConflictError";
  }
}

/**
 * 429 Too Many Requests
 */
export class TooManyRequestsError extends AppError {
  constructor(message: string = "Too many requests, please try again later", code: string = "RATE_LIMITED") {
    super(message, 429, code);
    this.name = "TooManyRequestsError";
  }
}

/**
 * Global error handler — must be registered AFTER all routes.
 *
 * Express 5 requires 4-parameter signature to identify this as an error handler.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction // eslint-disable-line @typescript-eslint/no-unused-vars
): void {
  // Known application errors
  if (err instanceof AppError) {
    const body: ApiError = {
      message: err.message,
      code: err.code,
    };

    res.status(err.statusCode).json(body);
    return;
  }

  // Unexpected errors — log full details server-side, send generic message to client
  console.error("Unhandled error:", err);

  const body: ApiError = {
    message: "Internal server error",
    code: "INTERNAL_ERROR",
  };

  res.status(500).json(body);
}
