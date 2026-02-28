import { describe, it, expect, beforeAll } from "vitest";
import * as crypto from "node:crypto";
import {
  BlindSignatureService,
  type BlindSignatureKeyPair,
} from "./blind-signature.service.js";

describe("BlindSignatureService", () => {
  let keyPair: BlindSignatureKeyPair;
  let service: BlindSignatureService;

  beforeAll(() => {
    keyPair = BlindSignatureService.generateKeyPair();
    service = new BlindSignatureService(keyPair);
  });

  // ─── Key Generation ────────────────────────────────────────────────

  describe("key generation", () => {
    it("generates a valid RSA key pair in PEM format", () => {
      expect(keyPair.publicKey).toContain("BEGIN PUBLIC KEY");
      expect(keyPair.privateKey).toContain("BEGIN PRIVATE KEY");
    });

    it("generates different keys on each call", () => {
      const another = BlindSignatureService.generateKeyPair();
      expect(another.publicKey).not.toBe(keyPair.publicKey);
      expect(another.privateKey).not.toBe(keyPair.privateKey);
    });
  });

  // ─── Public Parameters ─────────────────────────────────────────────

  describe("public params", () => {
    it("returns n and e as hex strings", () => {
      const params = service.getPublicParams();
      expect(typeof params.n).toBe("string");
      expect(typeof params.e).toBe("string");

      // n should be ~256 bytes (2048 bits) → ~512 hex chars
      expect(params.n.length).toBeGreaterThanOrEqual(510);
      expect(params.n.length).toBeLessThanOrEqual(512);

      // e is typically 65537 → 0x10001 (zero-padded to even hex length)
      expect(params.e).toBe("010001");
    });
  });

  // ─── Standard (Non-Blind) Sign & Verify ────────────────────────────

  describe("sign and verify (via blind protocol)", () => {
    function signViaProtocol(
      svc: BlindSignatureService,
      message: Buffer
    ): Buffer {
      const params = svc.getPublicParams();
      const { blindedMessage, blindingFactor } =
        BlindSignatureService.blindMessage(message, params.n, params.e);
      const blindSig = svc.signBlinded(blindedMessage);
      return BlindSignatureService.unblindSignature(
        blindSig,
        blindingFactor,
        params.n
      );
    }

    it("signs and verifies a 32-byte message", () => {
      const message = crypto.randomBytes(32);
      const signature = signViaProtocol(service, message);
      expect(service.verifySignature(message, signature)).toBe(true);
    });

    it("rejects a modified message", () => {
      const message = crypto.randomBytes(32);
      const signature = signViaProtocol(service, message);

      const modified = Buffer.from(message);
      modified[0]! ^= 0xff;
      expect(service.verifySignature(modified, signature)).toBe(false);
    });

    it("rejects a modified signature", () => {
      const message = crypto.randomBytes(32);
      const signature = signViaProtocol(service, message);

      const modified = Buffer.from(signature);
      modified[0]! ^= 0xff;
      expect(service.verifySignature(message, modified)).toBe(false);
    });

    it("rejects a signature from a different key pair", () => {
      const other = new BlindSignatureService();
      const message = crypto.randomBytes(32);
      const signature = signViaProtocol(other, message);
      expect(service.verifySignature(message, signature)).toBe(false);
    });
  });

  // ─── Full Blind Signature Protocol ─────────────────────────────────

  describe("full blind signature protocol", () => {
    it("completes the full blind → sign → unblind → verify flow", () => {
      // 1. Client has a real commitment
      const realCommitment = crypto.randomBytes(32);

      // 2. Client gets server's public parameters
      const params = service.getPublicParams();

      // 3. Client blinds the commitment (server never sees the real one)
      const { blindedMessage, blindingFactor } =
        BlindSignatureService.blindMessage(realCommitment, params.n, params.e);

      // 4. Server signs the blinded message
      const blindSignature = service.signBlinded(blindedMessage);

      // 5. Client unblinds the signature
      const realSignature = BlindSignatureService.unblindSignature(
        blindSignature,
        blindingFactor,
        params.n
      );

      // 6. Server verifies: confirms it signed this commitment,
      //    but CANNOT link to the email from step 4
      expect(service.verifySignature(realCommitment, realSignature)).toBe(true);
    });

    it("produces different blinded messages for the same commitment", () => {
      const commitment = crypto.randomBytes(32);
      const params = service.getPublicParams();

      const blind1 = BlindSignatureService.blindMessage(
        commitment,
        params.n,
        params.e
      );
      const blind2 = BlindSignatureService.blindMessage(
        commitment,
        params.n,
        params.e
      );

      // Different random blinding factors → different blinded messages
      expect(blind1.blindedMessage.equals(blind2.blindedMessage)).toBe(false);
      expect(blind1.blindingFactor.equals(blind2.blindingFactor)).toBe(false);
    });

    it("both blindings produce valid unblinded signatures", () => {
      const commitment = crypto.randomBytes(32);
      const params = service.getPublicParams();

      const blind1 = BlindSignatureService.blindMessage(
        commitment,
        params.n,
        params.e
      );
      const blind2 = BlindSignatureService.blindMessage(
        commitment,
        params.n,
        params.e
      );

      // Server signs both blindly (thinks they're different messages)
      const sig1 = service.signBlinded(blind1.blindedMessage);
      const sig2 = service.signBlinded(blind2.blindedMessage);

      // Client unblinds both
      const real1 = BlindSignatureService.unblindSignature(
        sig1,
        blind1.blindingFactor,
        params.n
      );
      const real2 = BlindSignatureService.unblindSignature(
        sig2,
        blind2.blindingFactor,
        params.n
      );

      // Both produce valid signatures for the same commitment
      expect(service.verifySignature(commitment, real1)).toBe(true);
      expect(service.verifySignature(commitment, real2)).toBe(true);
    });

    it("server cannot link blinded and unblinded versions (unlinkability)", () => {
      // Core privacy property:
      // Given two blinded messages and two real commitments,
      // the server cannot determine which blinded message corresponds to which commitment.

      const commitmentA = crypto.randomBytes(32);
      const commitmentB = crypto.randomBytes(32);
      const params = service.getPublicParams();

      // Client A blinds
      const blindA = BlindSignatureService.blindMessage(
        commitmentA,
        params.n,
        params.e
      );
      // Client B blinds
      const blindB = BlindSignatureService.blindMessage(
        commitmentB,
        params.n,
        params.e
      );

      // Server signs both blindly
      const blindSigA = service.signBlinded(blindA.blindedMessage);
      const blindSigB = service.signBlinded(blindB.blindedMessage);

      // Clients unblind
      const realSigA = BlindSignatureService.unblindSignature(
        blindSigA,
        blindA.blindingFactor,
        params.n
      );
      const realSigB = BlindSignatureService.unblindSignature(
        blindSigB,
        blindB.blindingFactor,
        params.n
      );

      // Both valid for their own commitments
      expect(service.verifySignature(commitmentA, realSigA)).toBe(true);
      expect(service.verifySignature(commitmentB, realSigB)).toBe(true);

      // Cross-check fails: signature for A doesn't work for B and vice versa
      expect(service.verifySignature(commitmentB, realSigA)).toBe(false);
      expect(service.verifySignature(commitmentA, realSigB)).toBe(false);

      // The server saw: [blindA.blindedMessage, blindB.blindedMessage]
      // The server later sees: [commitmentA, commitmentB] (random order)
      // There is NO mathematical way to match them without the blinding factors.
    });

    it("wrong blinding factor produces invalid unblinded signature", () => {
      const commitment = crypto.randomBytes(32);
      const params = service.getPublicParams();

      const { blindedMessage } = BlindSignatureService.blindMessage(
        commitment,
        params.n,
        params.e
      );

      const blindSig = service.signBlinded(blindedMessage);

      // Client uses WRONG blinding factor
      const wrongFactor = crypto.randomBytes(256);
      const badSig = BlindSignatureService.unblindSignature(
        blindSig,
        wrongFactor,
        params.n
      );

      expect(service.verifySignature(commitment, badSig)).toBe(false);
    });
  });

  // ─── Edge Cases ────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("handles commitment of all zeros", () => {
      const commitment = Buffer.alloc(32, 0);
      const params = service.getPublicParams();

      const { blindedMessage, blindingFactor } =
        BlindSignatureService.blindMessage(commitment, params.n, params.e);
      const blindSig = service.signBlinded(blindedMessage);
      const realSig = BlindSignatureService.unblindSignature(
        blindSig,
        blindingFactor,
        params.n
      );

      expect(service.verifySignature(commitment, realSig)).toBe(true);
    });

    it("handles commitment of all 0xFF", () => {
      const commitment = Buffer.alloc(32, 0xff);
      const params = service.getPublicParams();

      const { blindedMessage, blindingFactor } =
        BlindSignatureService.blindMessage(commitment, params.n, params.e);
      const blindSig = service.signBlinded(blindedMessage);
      const realSig = BlindSignatureService.unblindSignature(
        blindSig,
        blindingFactor,
        params.n
      );

      expect(service.verifySignature(commitment, realSig)).toBe(true);
    });

    it("handles single-byte commitment", () => {
      const commitment = Buffer.from([0x42]);
      const params = service.getPublicParams();

      const { blindedMessage, blindingFactor } =
        BlindSignatureService.blindMessage(commitment, params.n, params.e);
      const blindSig = service.signBlinded(blindedMessage);
      const realSig = BlindSignatureService.unblindSignature(
        blindSig,
        blindingFactor,
        params.n
      );

      expect(service.verifySignature(commitment, realSig)).toBe(true);
    });

    it("service created without explicit keys generates its own", () => {
      const autoService = new BlindSignatureService();
      const params = autoService.getPublicParams();
      expect(params.n).toBeDefined();
      expect(params.e).toBe("010001");
    });
  });
});
