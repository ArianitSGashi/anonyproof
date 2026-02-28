-- ============================================================================
-- AnonyProof – Blind Signature Support for Credential Issuance
-- Migration: 002_blind_signature_support
-- PostgreSQL 17+
-- ============================================================================
--
-- PRIVACY UPGRADE: Blind Signatures → Instant Unlinkability
-- ─────────────────────────────────────────────────────────
-- Before (90-day purge):
--   credential_issuance_requests stored {email, real_commitment}.
--   Link existed for up to 90 days. Purge was operational guarantee.
--
-- After (blind signatures):
--   credential_issuance_requests stores {email, BLINDED_commitment}.
--   The real commitment is NEVER stored in this table.
--   The link between email and real commitment NEVER EXISTS on the server.
--   Anonymity is a MATHEMATICAL guarantee, not an operational one.
--
-- The 90-day purge is KEPT as defense-in-depth for blinded data.
--
-- Two-Phase Protocol:
--   Phase 1: Student sends {email, blindedCommitment} → stored here
--            Admin approves → server signs blindly → blind_signature stored
--   Phase 2: Student sends {realCommitment, unblindedSignature} → verified
--            Commitment added to semaphore_members
--            Server CANNOT link to any email from Phase 1
-- ============================================================================

-- ── 1. Add blind signature columns to credential_issuance_requests ──────────

-- Store the blind signature issued by the server during Phase 1 approval
ALTER TABLE onboarding.credential_issuance_requests
  ADD COLUMN IF NOT EXISTS blind_signature BYTEA;

-- Track which server key was used (for key rotation support)
ALTER TABLE onboarding.credential_issuance_requests
  ADD COLUMN IF NOT EXISTS server_key_hash BYTEA;

-- ── 2. Add clarifying comments ──────────────────────────────────────────────

COMMENT ON COLUMN onboarding.credential_issuance_requests.identity_commitment IS
  'Stores the BLINDED commitment (not the real one). The real commitment is '
  'submitted separately via the Phase 2 registration endpoint and is '
  'mathematically unlinkable to this blinded value. '
  'Even with full database access, it is computationally infeasible to determine '
  'which real commitment corresponds to which blinded commitment.';

COMMENT ON COLUMN onboarding.credential_issuance_requests.blind_signature IS
  'RSA blind signature over the blinded commitment, issued when admin approves. '
  'The student unblinds this client-side to obtain a valid signature on their '
  'real commitment. The server cannot link the blind signature to the unblinded one.';

COMMENT ON COLUMN onboarding.credential_issuance_requests.server_key_hash IS
  'SHA-256 hash of the server RSA public key used to create the blind signature. '
  'Supports key rotation: clients know which key params to use for unblinding.';

-- ── 3. Index for admin queue (pending requests lookups) ─────────────────────

CREATE INDEX IF NOT EXISTS idx_credential_requests_pending_review
  ON onboarding.credential_issuance_requests(status, created_at)
  WHERE status = 'pending_review';

-- ── 4. Index for approved-but-not-yet-registered lookups ────────────────────

CREATE INDEX IF NOT EXISTS idx_credential_requests_approved
  ON onboarding.credential_issuance_requests(status, created_at)
  WHERE status = 'approved';
