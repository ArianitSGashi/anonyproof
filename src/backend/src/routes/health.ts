/**
 * Health check route.
 *
 * GET /health — returns service status, used by load balancers and monitoring.
 */

import { Router } from "express";
import type { HealthResponse } from "@repo/shared";

export const healthRouter = Router();

healthRouter.get("/health", (_req, res) => {
  const payload: HealthResponse = {
    status: "ok",
    service: "backend",
    timestamp: new Date().toISOString(),
  };

  res.status(200).json(payload);
});
