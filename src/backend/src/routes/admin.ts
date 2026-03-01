/**
 * Admin Router
 *
 * POST   /api/admin/login                      — Authenticate admin, return JWT
 * POST   /api/admin/users                      — Create admin user (superadmin only)
 *
 * GET    /api/admin/moderation/queue            — List moderation queue (paginated)
 * POST   /api/admin/moderation/:id/decision     — Approve/reject flagged content
 *
 * GET    /api/admin/credentials/requests        — List pending credential requests
 * POST   /api/admin/credentials/:id/approve     — Approve a credential request (blind sign)
 * POST   /api/admin/credentials/:id/reject      — Reject a credential request
 * POST   /api/admin/credentials/batch-approve   — Batch-approve for timing anonymity
 *
 * GET    /api/admin/audit-log                   — Query admin action history
 */

import { Router } from "express";
import type {
  AdminLoginRequest,
  AdminLoginResponse,
  CreateAdminRequest,
  AdminResponse,
  AuditLogEntry,
  ModerationQueueItem,
  PendingCredentialRequest,
  BlindCredentialApprovalResponse,
  PaginatedResponse,
} from "@repo/shared";
import { validate, validateQuery } from "../middleware/validate.js";
import { createRequireAdmin, requireRole } from "../middleware/auth.js";
import { authLimiter } from "../middleware/rate-limit.js";
import {
  adminLoginSchema,
  createAdminSchema,
  auditLogQuerySchema,
  moderationQueueQuerySchema,
  moderationDecisionSchema,
  credentialRejectSchema,
  batchApproveSchema,
} from "../types/schemas.js";
import {
  adminService,
  credentialService,
  moderationService,
} from "../services/instances.js";

// ─── Middleware ───────────────────────────────────────────────────────────────

const requireAdmin = createRequireAdmin(adminService);

export const adminRouter = Router();

// ─── POST /api/admin/login ───────────────────────────────────────────────────

adminRouter.post(
  "/admin/login",
  authLimiter,
  validate(adminLoginSchema),
  async (req, res) => {
    const { username, password } = req.body as AdminLoginRequest;
    const result = await adminService.login(username, password);

    const response: AdminLoginResponse = {
      token: result.token,
      admin: result.admin,
    };

    res.json(response);
  },
);

// ─── POST /api/admin/users ───────────────────────────────────────────────────

adminRouter.post(
  "/admin/users",
  requireAdmin,
  requireRole("superadmin"),
  validate(createAdminSchema),
  async (req, res) => {
    const { username, email, password, role } = req.body as CreateAdminRequest;
    const result = await adminService.createAdmin(
      username,
      email,
      password,
      role,
      req.admin!.sub,
    );

    const response: AdminResponse = {
      id: result.id,
      username,
      email,
      role,
      isActive: true,
      createdAt: new Date().toISOString(),
    };

    res.status(201).json(response);
  },
);

// ─── GET /api/admin/moderation/queue ─────────────────────────────────────────

adminRouter.get(
  "/admin/moderation/queue",
  requireAdmin,
  requireRole("moderator", "admin", "superadmin"),
  validateQuery(moderationQueueQuerySchema),
  async (req, res) => {
    const query = (
      req as unknown as {
        validatedQuery: {
          page: number;
          limit: number;
          status?: string;
          minScore?: number;
        };
      }
    ).validatedQuery;

    const result = await moderationService.getQueue(
      {
        ...(query.status != null && {
          status: query.status as "pending" | "approved" | "rejected" | "escalated",
        }),
        ...(query.minScore != null && { minScore: query.minScore }),
      },
      { page: query.page, limit: query.limit },
    );

    const response: PaginatedResponse<ModerationQueueItem> = {
      data: result.data.map((item) => ({
        id: item.id,
        contentType: item.post_id ? ("post" as const) : ("comment" as const),
        contentId: (item.post_id ?? item.comment_id)!,
        content: item.content,
        toxicityScore: item.ai_toxicity_score,
        flaggedCategories: item.ai_flagged_categories,
        status: item.status,
        createdAt: item.created_at.toISOString(),
      })),
      pagination: {
        page: query.page,
        limit: query.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / query.limit),
      },
    };

    res.json(response);
  },
);

// ─── POST /api/admin/moderation/:id/decision ─────────────────────────────────

adminRouter.post(
  "/admin/moderation/:id/decision",
  requireAdmin,
  requireRole("moderator", "admin", "superadmin"),
  validate(moderationDecisionSchema),
  async (req, res) => {
    const queueItemId = String(req.params["id"]);
    const { decision, notes } = req.body as {
      decision: "approved" | "rejected";
      notes?: string;
    };

    await moderationService.processDecision(
      queueItemId,
      decision,
      req.admin!.sub,
      notes,
    );

    res.json({ message: `Content ${decision}` });
  },
);

// ─── GET /api/admin/credentials/requests ─────────────────────────────────────

adminRouter.get(
  "/admin/credentials/requests",
  requireAdmin,
  requireRole("moderator", "admin", "superadmin"),
  async (_req, res) => {
    const requests = await credentialService.getPendingRequests();

    const response: PendingCredentialRequest[] = requests.map((r) => ({
      id: r.id,
      universityEmail: r.universityEmail,
      groupId: r.groupId,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    }));

    res.json(response);
  },
);

// ─── POST /api/admin/credentials/:id/approve ─────────────────────────────────

adminRouter.post(
  "/admin/credentials/:id/approve",
  requireAdmin,
  requireRole("admin", "superadmin"),
  async (req, res) => {
    const requestId = String(req.params["id"]);
    const result = await credentialService.approveRequest(
      requestId,
      req.admin!.sub,
    );

    const response: BlindCredentialApprovalResponse = {
      requestId: result.requestId,
      blindSignature: result.blindSignature,
    };

    res.json(response);
  },
);

// ─── POST /api/admin/credentials/:id/reject ──────────────────────────────────

adminRouter.post(
  "/admin/credentials/:id/reject",
  requireAdmin,
  requireRole("admin", "superadmin"),
  validate(credentialRejectSchema),
  async (req, res) => {
    const requestId = String(req.params["id"]);
    const { reason } = req.body as { reason: string };

    await credentialService.rejectRequest(requestId, req.admin!.sub, reason);

    res.json({ message: "Credential request rejected" });
  },
);

// ─── POST /api/admin/credentials/batch-approve ───────────────────────────────

adminRouter.post(
  "/admin/credentials/batch-approve",
  requireAdmin,
  requireRole("admin", "superadmin"),
  validate(batchApproveSchema),
  async (req, res) => {
    const { requestIds } = req.body as { requestIds: string[] };

    const results = await credentialService.approveBatch(
      requestIds,
      req.admin!.sub,
    );

    const response: BlindCredentialApprovalResponse[] = results.map((r) => ({
      requestId: r.requestId,
      blindSignature: r.blindSignature,
    }));

    res.json(response);
  },
);

// ─── GET /api/admin/audit-log ────────────────────────────────────────────────

adminRouter.get(
  "/admin/audit-log",
  requireAdmin,
  requireRole("admin", "superadmin"),
  validateQuery(auditLogQuerySchema),
  async (req, res) => {
    const query = (
      req as unknown as {
        validatedQuery: {
          page: number;
          limit: number;
          adminId?: string;
          actionType?: string;
          targetType?: string;
        };
      }
    ).validatedQuery;

    const result = await adminService.getAuditLog(
      {
        ...(query.adminId != null && { adminId: query.adminId }),
        ...(query.actionType != null && { actionType: query.actionType }),
        ...(query.targetType != null && { targetType: query.targetType }),
      },
      { page: query.page, limit: query.limit },
    );

    const response: PaginatedResponse<AuditLogEntry> = {
      data: result.data.map((entry) => ({
        id: entry.id,
        adminId: entry.admin_id,
        actionType: entry.action_type,
        targetType: entry.target_type,
        targetId: entry.target_id,
        details: entry.details,
        ipAddress: entry.ip_address,
        createdAt: entry.created_at.toISOString(),
      })),
      pagination: result.pagination,
    };

    res.json(response);
  },
);
