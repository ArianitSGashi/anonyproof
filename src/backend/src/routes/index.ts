/**
 * Route registration — aggregates all routers and attaches them to the Express app.
 *
 * New route modules should be imported here and registered via registerRoutes().
 */

import type { Express } from "express";
import { healthRouter } from "./health.js";
import { postsRouter } from "./posts.js";
import { commentsRouter } from "./comments.js";
import { votesRouter } from "./votes.js";

/**
 * Registers all application routes on the Express app.
 * Called once during bootstrap, after middleware setup.
 *
 * Route modules will be added here as they are built:
 *   - /api/groups      (Phase 2)
 *   - /api/credentials (Phase 5)
 *   - /api/admin/*     (Phase 5)
 */
export function registerRoutes(app: Express): void {
  // Public routes
  app.use(healthRouter);

  // API routes
  app.use("/api", postsRouter);
  app.use("/api", commentsRouter);
  app.use("/api", votesRouter);

  // Future:
  // app.use("/api", groupsRouter);
  // app.use("/api", credentialsRouter);
  // app.use("/api/admin", adminRouter);
}
