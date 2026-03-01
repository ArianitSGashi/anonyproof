/**
 * Groups Router
 *
 * POST   /api/groups           — Create a new Semaphore group (admin only)
 * GET    /api/groups           — List all groups with member counts
 * GET    /api/groups/:groupId  — Get a single group by hex group_id
 */

import { Router } from "express";
import type { GroupResponse, CreateGroupRequest } from "@repo/shared";
import { validate } from "../middleware/validate.js";
import { createGroupSchema } from "../types/schemas.js";
import { createRequireAdmin, requireRole } from "../middleware/auth.js";
import {
  adminService,
  groupService,
} from "../services/instances.js";

// ─── Middleware ───────────────────────────────────────────────────────────────

const requireAdmin = createRequireAdmin(adminService);

export const groupsRouter = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function toGroupResponse(group: {
  id: string;
  group_id: Buffer;
  name: string;
  description: string | null;
  depth: number;
  created_at: Date;
}): Promise<GroupResponse> {
  const memberCount = await groupService.getMemberCount(group.group_id);

  return {
    id: group.id,
    groupId: group.group_id.toString("hex"),
    name: group.name,
    description: group.description,
    depth: group.depth,
    memberCount,
    createdAt: group.created_at.toISOString(),
  };
}

// ─── POST /api/groups ────────────────────────────────────────────────────────

groupsRouter.post(
  "/groups",
  requireAdmin,
  requireRole("admin", "superadmin"),
  validate(createGroupSchema),
  async (req, res) => {
    const { name, description, depth } = req.body as CreateGroupRequest;
    const group = await groupService.createGroup(
      name,
      description ?? "",
      depth,
    );

    res.status(201).json(await toGroupResponse(group));
  },
);

// ─── GET /api/groups ─────────────────────────────────────────────────────────

groupsRouter.get("/groups", async (_req, res) => {
  const groups = await groupService.listGroups();

  const response: GroupResponse[] = await Promise.all(
    groups.map((g) => toGroupResponse(g)),
  );

  res.json(response);
});

// ─── GET /api/groups/:groupId ────────────────────────────────────────────────

groupsRouter.get("/groups/:groupId", async (req, res) => {
  const groupIdHex = String(req.params["groupId"]);
  const groupIdBuf = Buffer.from(groupIdHex, "hex");
  const group = await groupService.getGroup(groupIdBuf);

  res.json(await toGroupResponse(group));
});
