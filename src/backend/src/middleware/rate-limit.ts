/**
 * Rate limiting middleware using express-rate-limit.
 *
 * Three tiers:
 *   - globalLimiter:  100 requests / minute per IP (general protection)
 *   - authLimiter:    10 requests / minute per IP  (login/auth endpoints)
 *   - contentLimiter: 30 requests / minute per IP  (content creation)
 */

import rateLimit from "express-rate-limit";

/**
 * Global rate limiter — applied to all routes.
 * 100 requests per minute per IP.
 */
export const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    message: "Too many requests, please try again later",
    code: "RATE_LIMITED",
  },
});

/**
 * Strict rate limiter for authentication endpoints.
 * 10 requests per minute per IP — prevents brute-force attacks.
 */
export const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    message: "Too many login attempts, please try again later",
    code: "RATE_LIMITED",
  },
});

/**
 * Rate limiter for content creation (posts, comments, votes).
 * 30 requests per minute per IP.
 */
export const contentLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    message: "Too many requests, please slow down",
    code: "RATE_LIMITED",
  },
});
