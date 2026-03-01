/**
 * Admin Authentication & Management Service
 *
 * Handles admin user authentication (JWT-based), admin creation,
 * and audit log retrieval.
 *
 * Security notes:
 *   - Passwords are hashed with bcrypt (cost factor 12)
 *   - JWTs are signed with HS256 and expire after a configurable TTL
 *   - Only superadmins can create new admin accounts
 *   - All admin actions are recorded in admin_actions (append-only audit log)
 */

import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { getDb } from "../db/index.js";
import type { AdminRole, AdminAction } from "../types/database.js";
import type { PaginatedResponse, PaginationParams } from "@repo/shared";
import {
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
} from "../middleware/error-handler.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const BCRYPT_ROUNDS = 12;
/** Default JWT expiry: 8 hours in seconds */
const DEFAULT_JWT_EXPIRY_SECONDS = 8 * 60 * 60;

// ─── DTOs ─────────────────────────────────────────────────────────────────────

export interface AdminTokenPayload {
  sub: string; // admin user id
  username: string;
  role: AdminRole;
}

export interface LoginResult {
  token: string;
  admin: {
    id: string;
    username: string;
    role: AdminRole;
  };
}

export interface AuditFilters {
  adminId?: string;
  actionType?: string;
  targetType?: string;
  fromDate?: Date;
  toDate?: Date;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class AdminService {
  private jwtSecret: string;
  private jwtExpirySeconds: number;

  constructor(jwtSecret: string, jwtExpirySeconds: number = DEFAULT_JWT_EXPIRY_SECONDS) {
    if (!jwtSecret || jwtSecret.length < 32) {
      throw new Error("JWT secret must be at least 32 characters");
    }
    this.jwtSecret = jwtSecret;
    this.jwtExpirySeconds = jwtExpirySeconds;
  }

  /**
   * Authenticates an admin user and returns a signed JWT.
   *
   * Validates username/password against admin_users table.
   * Updates last_login timestamp on success.
   */
  async login(username: string, password: string): Promise<LoginResult> {
    const db = getDb();

    const admin = await db
      .selectFrom("admin_users")
      .select(["id", "username", "email", "password_hash", "role", "is_active"])
      .where("username", "=", username)
      .executeTakeFirst();

    if (!admin) {
      throw new UnauthorizedError("Invalid username or password");
    }

    if (!admin.is_active) {
      throw new UnauthorizedError("Account is deactivated");
    }

    const passwordValid = await bcrypt.compare(password, admin.password_hash);
    if (!passwordValid) {
      throw new UnauthorizedError("Invalid username or password");
    }

    // Update last_login timestamp
    await db
      .updateTable("admin_users")
      .set({ last_login: new Date() })
      .where("id", "=", admin.id)
      .execute();

    const payload: AdminTokenPayload = {
      sub: admin.id,
      username: admin.username,
      role: admin.role,
    };

    const token = jwt.sign(payload, this.jwtSecret, {
      expiresIn: this.jwtExpirySeconds,
    });

    return {
      token,
      admin: {
        id: admin.id,
        username: admin.username,
        role: admin.role,
      },
    };
  }

  /**
   * Creates a new admin user. Only superadmins can invoke this.
   *
   * Hashes the password with bcrypt and inserts into admin_users.
   * Logs the action to admin_actions.
   */
  async createAdmin(
    username: string,
    email: string,
    password: string,
    role: AdminRole,
    createdByAdminId: string
  ): Promise<{ id: string }> {
    const db = getDb();

    // Verify the caller is a superadmin
    const caller = await db
      .selectFrom("admin_users")
      .select(["id", "role"])
      .where("id", "=", createdByAdminId)
      .executeTakeFirst();

    if (!caller || caller.role !== "superadmin") {
      throw new ForbiddenError("Only superadmins can create admin accounts");
    }

    // Check for duplicate username or email
    const existingUsername = await db
      .selectFrom("admin_users")
      .select("id")
      .where("username", "=", username)
      .executeTakeFirst();

    if (existingUsername) {
      throw new ConflictError("Username already exists");
    }

    const existingEmail = await db
      .selectFrom("admin_users")
      .select("id")
      .where("email", "=", email)
      .executeTakeFirst();

    if (existingEmail) {
      throw new ConflictError("Email already exists");
    }

    // Validate password strength
    if (password.length < 8) {
      throw new BadRequestError("Password must be at least 8 characters");
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const result = await db
      .insertInto("admin_users")
      .values({
        username,
        email,
        password_hash: passwordHash,
        role,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    // Log the action
    await db
      .insertInto("admin_actions")
      .values({
        admin_id: createdByAdminId,
        action_type: "admin_created",
        target_type: "admin_user",
        target_id: result.id,
        details: { username, email, role },
      })
      .execute();

    return { id: result.id };
  }

  /**
   * Retrieves the audit log with optional filters and pagination.
   */
  async getAuditLog(
    filters: AuditFilters,
    pagination: PaginationParams
  ): Promise<PaginatedResponse<AdminAction>> {
    const db = getDb();
    const page = pagination.page ?? 1;
    const limit = pagination.limit ?? 20;
    const offset = (page - 1) * limit;

    // Build the filtered query
    let query = db.selectFrom("admin_actions").selectAll();
    let countQuery = db
      .selectFrom("admin_actions")
      .select(db.fn.countAll<number>().as("count"));

    if (filters.adminId) {
      query = query.where("admin_id", "=", filters.adminId);
      countQuery = countQuery.where("admin_id", "=", filters.adminId);
    }

    if (filters.actionType) {
      query = query.where("action_type", "=", filters.actionType);
      countQuery = countQuery.where("action_type", "=", filters.actionType);
    }

    if (filters.targetType) {
      query = query.where("target_type", "=", filters.targetType);
      countQuery = countQuery.where("target_type", "=", filters.targetType);
    }

    if (filters.fromDate) {
      query = query.where("created_at", ">=", filters.fromDate);
      countQuery = countQuery.where("created_at", ">=", filters.fromDate);
    }

    if (filters.toDate) {
      query = query.where("created_at", "<=", filters.toDate);
      countQuery = countQuery.where("created_at", "<=", filters.toDate);
    }

    const [data, countResult] = await Promise.all([
      query.orderBy("created_at", "desc").limit(limit).offset(offset).execute(),
      countQuery.executeTakeFirst(),
    ]);

    const total = Number(countResult?.count ?? 0);

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Verifies a JWT token and returns the decoded payload.
   * Used by the auth middleware.
   */
  verifyToken(token: string): AdminTokenPayload {
    try {
      const decoded = jwt.verify(token, this.jwtSecret) as AdminTokenPayload;
      return decoded;
    } catch {
      throw new UnauthorizedError("Invalid or expired token");
    }
  }
}
