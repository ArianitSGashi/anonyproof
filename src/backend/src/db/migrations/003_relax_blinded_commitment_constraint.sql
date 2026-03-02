-- ============================================================================
-- AnonyProof – Relax identity_commitment size constraint for blind signatures
-- Migration: 003_relax_blinded_commitment_constraint
-- PostgreSQL 17+
-- ============================================================================
--
-- Migration 001 defined:
--   identity_commitment BYTEA CHECK (octet_length(identity_commitment) = 32)
--
-- This was correct when the column stored Poseidon hashes (always 32 bytes).
-- Migration 002 repurposed this column to store BLINDED commitments, which
-- are RSA-modulus-sized (typically 128–256 bytes depending on key size).
--
-- This migration drops the 32-byte restriction and allows any non-empty value.
-- ============================================================================

-- Drop the existing 32-byte check constraint
ALTER TABLE onboarding.credential_issuance_requests
  DROP CONSTRAINT IF EXISTS credential_issuance_requests_identity_commitment_check;

-- Re-add a relaxed constraint: NULL or at least 1 byte
ALTER TABLE onboarding.credential_issuance_requests
  ADD CONSTRAINT credential_issuance_requests_identity_commitment_check
  CHECK (identity_commitment IS NULL OR octet_length(identity_commitment) >= 1);
