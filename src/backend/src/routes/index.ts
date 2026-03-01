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
import { groupsRouter } from "./groups.js";
import { credentialsRouter } from "./credentials.js";
import { adminRouter } from "./admin.js";
import { contentLimiter } from "../middleware/rate-limit.js";

/**
 * Registers all application routes on the Express app.
 * Called once during bootstrap, after middleware setup.
 */
export function registerRoutes(app: Express): void {
  // Public routes
  app.use(healthRouter);

  // API routes — content creation endpoints are rate-limited
  app.use("/api", groupsRouter);
  app.use("/api", credentialsRouter);
  app.use("/api", contentLimiter, postsRouter);
  app.use("/api", contentLimiter, commentsRouter);
  app.use("/api", contentLimiter, votesRouter);

  // Admin routes
  app.use("/api", adminRouter);
}
