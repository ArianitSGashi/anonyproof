/**
 * Shared Service Instances
 *
 * Centralizes creation of service singletons so they are shared across
 * route modules (e.g., the same BlindSignatureService RSA key pair
 * is used in both admin and public credential routes).
 *
 * Module-level singletons — follows the existing pattern used in
 * routes/posts.ts, routes/comments.ts, routes/votes.ts.
 */

import { AdminService } from "./admin.service.js";
import { BlindSignatureService } from "./blind-signature.service.js";
import { CredentialService } from "./credential.service.js";
import { GroupService } from "./group.service.js";
import { MerkleService } from "./merkle.service.js";
import { ModerationService } from "./moderation.service.js";
import { SemaphoreService } from "./semaphore.service.js";
import { createAiClient } from "./ai-client.js";

// ─── JWT Secret ──────────────────────────────────────────────────────────────

const jwtSecret =
  process.env["JWT_SECRET"] ?? "development-secret-key-change-me-at-least-32!";

// ─── Singleton Instances ─────────────────────────────────────────────────────

export const adminService = new AdminService(jwtSecret);

export const blindSigService = new BlindSignatureService();

export const credentialService = new CredentialService(blindSigService, {
  batchEnforcement: process.env["NODE_ENV"] !== "test",
});

export const semaphoreService = new SemaphoreService();

export const merkleService = new MerkleService();

export const groupService = new GroupService(merkleService);

export const moderationService = new ModerationService(createAiClient());
