/**
 * Route registration — aggregates all routers and attaches them to the Express app.
 *
 * New route modules should be imported here and registered via registerRoutes().
 */

import type { Express } from "express";
import { healthRouter } from "./health.js";

/**
 * Registers all application routes on the Express app.
 * Called once during bootstrap, after middleware setup.
 *
 * Route modules will be added here as they are built:
 *   - /api/groups      (Phase 2)
 *   - /api/posts       (Phase 3)
 *   - /api/comments    (Phase 3)
 *   - /api/votes       (Phase 3)
 *   - /api/credentials (Phase 5)
 *   - /api/admin/*     (Phase 5)
 */
export function registerRoutes(app: Express): void {
  // Public routes
  app.use(healthRouter);

  // API routes will be added here:
  // app.use("/api", groupsRouter);
  // app.use("/api", postsRouter);
  // app.use("/api", commentsRouter);
  // app.use("/api", votesRouter);
  // app.use("/api", credentialsRouter);
  // app.use("/api/admin", adminRouter);
}
