/**
 * Zod validation middleware factory for Express 5.
 *
 * Creates an Express middleware that validates req.body against the given
 * Zod schema. On failure, responds with a structured ApiError.
 *
 * Usage:
 *   import { validate } from "../middleware/validate.js";
 *   import { createPostSchema } from "../types/schemas.js";
 *
 *   router.post("/posts", validate(createPostSchema), async (req, res) => {
 *     // req.body is now typed and validated
 *   });
 */

import type { Request, Response, NextFunction } from "express";
import type { ZodSchema, ZodError } from "zod";
import type { ApiError } from "@repo/shared";

/**
 * Formats Zod validation errors into a human-readable string.
 */
function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
      return `${path}${issue.message}`;
    })
    .join("; ");
}

/**
 * Creates an Express middleware that validates req.body against a Zod schema.
 *
 * - On success: attaches the parsed/validated value to req.body and calls next().
 * - On failure: responds with 400 and an ApiError containing validation details.
 */
export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const error: ApiError = {
        message: `Validation failed: ${formatZodError(result.error)}`,
        code: "VALIDATION_ERROR",
      };

      res.status(400).json(error);
      return;
    }

    // Replace req.body with the parsed value (strips unknown keys, applies transforms)
    req.body = result.data;
    next();
  };
}

/**
 * Creates an Express middleware that validates req.query against a Zod schema.
 */
export function validateQuery(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);

    if (!result.success) {
      const error: ApiError = {
        message: `Query validation failed: ${formatZodError(result.error)}`,
        code: "VALIDATION_ERROR",
      };

      res.status(400).json(error);
      return;
    }

    // Attach parsed query params
    (req as Request & { validatedQuery: unknown }).validatedQuery = result.data;
    next();
  };
}
