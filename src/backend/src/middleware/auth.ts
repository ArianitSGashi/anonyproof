/**
 * Admin authentication middleware for Express 5.
 *
 * Verifies JWT from the Authorization: Bearer <token> header and
 * attaches the decoded admin payload to req.admin.
 *
 * Usage:
 *   import { requireAdmin, requireRole } from "../middleware/auth.js";
 *
 *   router.get("/admin/dashboard", requireAdmin, (req, res) => {
 *     console.log(req.admin.username);
 *   });
 *
 *   router.post("/admin/users", requireRole("superadmin"), (req, res) => {
 *     // Only superadmins reach here
 *   });
 */

import type { Request, Response, NextFunction } from "express";
import type { AdminRole } from "../types/database.js";
import type { AdminTokenPayload } from "../services/admin.service.js";
import type { AdminService } from "../services/admin.service.js";
import { UnauthorizedError, ForbiddenError } from "./error-handler.js";

// ─── Extend Express Request ──────────────────────────────────────────────────

declare module "express" {
  interface Request {
    admin?: AdminTokenPayload;
  }
}

// ─── Middleware Factory ──────────────────────────────────────────────────────

/**
 * Creates a requireAdmin middleware bound to a specific AdminService instance.
 * The middleware verifies the JWT and attaches req.admin.
 */
export function createRequireAdmin(adminService: AdminService) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      throw new UnauthorizedError("Missing Authorization header");
    }

    if (!authHeader.startsWith("Bearer ")) {
      throw new UnauthorizedError("Authorization header must use Bearer scheme");
    }

    const token = authHeader.slice(7);
    if (!token) {
      throw new UnauthorizedError("Missing token");
    }

    const payload = adminService.verifyToken(token);
    req.admin = payload;
    next();
  };
}

/**
 * Creates a requireRole middleware that checks the admin has one of the
 * specified roles. Must be used AFTER requireAdmin.
 */
export function requireRole(...allowedRoles: AdminRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.admin) {
      throw new UnauthorizedError("Authentication required");
    }

    if (!allowedRoles.includes(req.admin.role)) {
      throw new ForbiddenError(
        `Requires one of: ${allowedRoles.join(", ")}`
      );
    }

    next();
  };
}
