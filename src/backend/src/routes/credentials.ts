/**
 * Credentials Router (Public-Facing)
 *
 * Implements the blind signature credential flow for students:
 *
 * GET    /api/credentials/public-key  — Get RSA public params for blinding
 * POST   /api/credentials/request     — Submit blinded commitment + email
 * POST   /api/credentials/register    — Submit real commitment + unblinded signature
 */

import { Router } from "express";
import type {
  BlindSignaturePublicParams,
  BlindCredentialRequestResponse,
  CommitmentRegistrationResponse,
} from "@repo/shared";
import { validate } from "../middleware/validate.js";
import {
  blindCredentialRequestSchema,
  commitmentRegistrationSchema,
} from "../types/schemas.js";
import {
  blindSigService,
  credentialService,
} from "../services/instances.js";

export const credentialsRouter = Router();

// ─── GET /api/credentials/public-key ─────────────────────────────────────────

credentialsRouter.get("/credentials/public-key", (_req, res) => {
  const params = blindSigService.getPublicParams();

  const response: BlindSignaturePublicParams = {
    n: params.n,
    e: params.e,
  };

  res.json(response);
});

// ─── POST /api/credentials/request ───────────────────────────────────────────

credentialsRouter.post(
  "/credentials/request",
  validate(blindCredentialRequestSchema),
  async (req, res) => {
    const body = req.body as {
      universityEmail: string;
      groupId: string;
      blindedCommitment: string;
    };

    const result = await credentialService.requestCredential({
      universityEmail: body.universityEmail,
      groupId: body.groupId,
      blindedCommitment: body.blindedCommitment,
    });

    const response: BlindCredentialRequestResponse = {
      requestId: result.requestId,
    };

    res.status(201).json(response);
  },
);

// ─── POST /api/credentials/register ──────────────────────────────────────────

credentialsRouter.post(
  "/credentials/register",
  validate(commitmentRegistrationSchema),
  async (req, res) => {
    const body = req.body as {
      groupId: string;
      commitment: string;
      signature: string;
    };

    const result = await credentialService.registerCommitment({
      groupId: body.groupId,
      commitment: body.commitment,
      signature: body.signature,
    });

    const response: CommitmentRegistrationResponse = {
      leafIndex: result.leafIndex,
    };

    res.status(201).json(response);
  },
);
