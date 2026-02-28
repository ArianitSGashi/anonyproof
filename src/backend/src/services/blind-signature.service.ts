/**
 * Blind Signature Service
 *
 * Implements RSA Blind Signatures for privacy-preserving credential issuance.
 *
 * Mathematical basis (raw RSA with Full Domain Hash):
 *   Hash:     h = FDH(message)               — maps message into Z_n
 *   Sign:     sig = h^d mod n                 — standard RSA
 *   Blind:    blindedH = h · r^e mod n        — client blinds with random r
 *   BlindSign: blindSig = blindedH^d mod n    — server signs blindly
 *              = h^d · r mod n                — (by RSA homomorphism)
 *   Unblind:  realSig = blindSig · r⁻¹ mod n — client removes r
 *              = h^d mod n                    — valid signature on h
 *
 * Flow:
 *   1. Client blinds their identity_commitment with a random blinding factor
 *   2. Client sends blinded_commitment + email to server
 *   3. Server signs the blinded_commitment (never sees real commitment)
 *   4. Client unblinds the signature to get a valid signature on real commitment
 *   5. Client submits real commitment + unblinded signature to join Merkle tree
 *   6. Server verifies signature but CANNOT link to any email
 *
 * Cryptographic guarantee:
 *   The server signs a value it has never seen and will never see.
 *   There is NO computational link between (email, blinded_commitment)
 *   and (real_commitment, unblinded_signature).
 */

import * as crypto from "node:crypto";

// RSA key size — 2048 bits is standard for blind signatures
const RSA_KEY_SIZE = 2048;
const RSA_KEY_BYTES = RSA_KEY_SIZE / 8; // 256 bytes

export interface BlindSignatureKeyPair {
  publicKey: string; // PEM-encoded RSA public key
  privateKey: string; // PEM-encoded RSA private key
}

export interface BlindingResult {
  blindedMessage: Buffer; // The blinded commitment (sent to server)
  blindingFactor: Buffer; // Secret kept by client (NEVER sent to server)
}

export class BlindSignatureService {
  private publicKey: string;
  private privateKey: string;
  private _n: bigint | null = null;
  private _e: bigint | null = null;
  private _d: bigint | null = null;

  constructor(keyPair?: BlindSignatureKeyPair) {
    if (keyPair) {
      this.publicKey = keyPair.publicKey;
      this.privateKey = keyPair.privateKey;
    } else {
      const generated = BlindSignatureService.generateKeyPair();
      this.publicKey = generated.publicKey;
      this.privateKey = generated.privateKey;
    }
  }

  /**
   * Generate a new RSA key pair for blind signatures.
   * Call once during initial setup, store keys securely.
   */
  static generateKeyPair(): BlindSignatureKeyPair {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: RSA_KEY_SIZE,
      publicExponent: 65537,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    return { publicKey, privateKey };
  }

  /**
   * Get the PEM-encoded public key (for clients that need the full key).
   */
  getPublicKey(): string {
    return this.publicKey;
  }

  /**
   * Extract RSA parameters (n, e) from the public key as hex strings.
   * Clients need these to perform blinding.
   */
  getPublicParams(): { n: string; e: string } {
    const { n, e } = this.getPublicComponents();
    return {
      n: bigIntToHex(n),
      e: bigIntToHex(e),
    };
  }

  // ─── Internal Key Parsing ──────────────────────────────────────────

  private getPublicComponents(): { n: bigint; e: bigint } {
    if (this._n !== null && this._e !== null) {
      return { n: this._n, e: this._e };
    }

    const pubKey = crypto.createPublicKey(this.publicKey);
    const jwk = pubKey.export({ format: "jwk" }) as { n: string; e: string };

    this._n = base64urlToBigInt(jwk.n);
    this._e = base64urlToBigInt(jwk.e);

    return { n: this._n, e: this._e };
  }

  private getPrivateExponent(): bigint {
    if (this._d !== null) return this._d;

    const privKey = crypto.createPrivateKey(this.privateKey);
    const jwk = privKey.export({ format: "jwk" }) as { d: string };

    this._d = base64urlToBigInt(jwk.d);
    return this._d;
  }

  // ─── Server-Side Operations ────────────────────────────────────────

  /**
   * SERVER SIDE: Sign a blinded message using raw RSA.
   *
   * Computes: blindSig = blindedMessage^d mod n
   *
   * The server performs this WITHOUT knowing the real message.
   *
   * @param blindedMessage - The blinded commitment from the client (as Buffer)
   * @returns The blind signature (client will unblind this)
   */
  signBlinded(blindedMessage: Buffer): Buffer {
    const { n } = this.getPublicComponents();
    const d = this.getPrivateExponent();

    const m = bufferToBigInt(blindedMessage);

    // Raw RSA: sig = m^d mod n
    const sig = modPow(m, d, n);

    return bigIntToBuffer(sig, RSA_KEY_BYTES);
  }

  /**
   * SERVER SIDE: Verify that a signature is valid for a given message.
   *
   * Checks: sig^e mod n === FDH(message)
   *
   * Used when the client submits their real commitment + unblinded signature.
   * The server can verify it signed this commitment, but CANNOT link it
   * to any previous blinding request.
   *
   * @param message - The real identity_commitment (32 bytes)
   * @param signature - The unblinded signature from the client
   * @returns true if the signature is valid
   */
  verifySignature(message: Buffer, signature: Buffer): boolean {
    try {
      const { n, e } = this.getPublicComponents();
      const sig = bufferToBigInt(signature);

      // RSA verify: recovered = sig^e mod n
      const recovered = modPow(sig, e, n);

      // The original signed value was the FDH of the message
      const messageHash = fullDomainHash(message, n);

      return recovered === messageHash;
    } catch {
      return false;
    }
  }

  // ─── Client-Side Operations (run in browser) ──────────────────────
  // These are included here for reference/testing.
  // In production, this code runs on the CLIENT (frontend).

  /**
   * CLIENT SIDE: Blind a message before sending to the server.
   *
   * Protocol:
   *   1. Compute h = FDH(message) — Full Domain Hash mapped to Z_n
   *   2. Choose random r where gcd(r, n) = 1
   *   3. Compute blindedMessage = h · r^e mod n
   *
   * @param message - The real identity_commitment to blind
   * @param nHex - RSA modulus n in hex (from server's public params)
   * @param eHex - RSA public exponent e in hex (from server's public params)
   * @returns The blinded message and the secret blinding factor
   */
  static blindMessage(
    message: Buffer,
    nHex: string,
    eHex: string
  ): BlindingResult {
    const n = BigInt("0x" + nHex);
    const e = BigInt("0x" + eHex);

    // Full Domain Hash of the message
    const h = fullDomainHash(message, n);

    // Generate random blinding factor r where gcd(r, n) = 1
    let r: bigint;
    do {
      const rBytes = crypto.randomBytes(RSA_KEY_BYTES);
      r = bufferToBigInt(rBytes) % n;
    } while (r <= 1n || gcd(r, n) !== 1n);

    // Blind: blindedMessage = h · r^e mod n
    const rE = modPow(r, e, n);
    const blindedM = (h * rE) % n;

    return {
      blindedMessage: bigIntToBuffer(blindedM, RSA_KEY_BYTES),
      blindingFactor: bigIntToBuffer(r, RSA_KEY_BYTES),
    };
  }

  /**
   * CLIENT SIDE: Unblind the server's signature.
   *
   * Protocol:
   *   blindSig = (h · r^e)^d mod n = h^d · r mod n
   *   realSig  = blindSig · r⁻¹ mod n = h^d mod n
   *
   * @param blindSignature - The signature from the server (on the blinded message)
   * @param blindingFactor - The secret blinding factor used during blinding
   * @param nHex - RSA modulus n in hex
   * @returns The unblinded signature (valid for the original message)
   */
  static unblindSignature(
    blindSignature: Buffer,
    blindingFactor: Buffer,
    nHex: string
  ): Buffer {
    const n = BigInt("0x" + nHex);
    const s = bufferToBigInt(blindSignature);
    const r = bufferToBigInt(blindingFactor);

    // Compute r⁻¹ mod n
    const rInv = modInverse(r, n);

    // Unblind: realSig = blindSig · r⁻¹ mod n
    const realSig = (s * rInv) % n;

    return bigIntToBuffer(realSig, RSA_KEY_BYTES);
  }
}

// ─── Full Domain Hash (FDH) ────────────────────────────────────────────────
// Maps an arbitrary message to an element of Z_n* using iterative hashing.
// Ensures the hash output fills the full RSA modulus space (prevents small-message attacks).

function fullDomainHash(message: Buffer, n: bigint): bigint {
  const nBytes = RSA_KEY_BYTES;
  let result: bigint;
  let counter = 0;

  do {
    // Expand message to nBytes via iterated SHA-256
    const expanded = Buffer.alloc(nBytes);
    let offset = 0;

    while (offset < nBytes) {
      const hash = crypto
        .createHash("sha256")
        .update(Buffer.from([counter >> 8, counter & 0xff]))
        .update(message)
        .update(Buffer.from([offset >> 8, offset & 0xff]))
        .digest();

      const toCopy = Math.min(hash.length, nBytes - offset);
      hash.copy(expanded, offset, 0, toCopy);
      offset += toCopy;
    }

    result = bufferToBigInt(expanded) % n;
    counter++;
  } while (result <= 1n); // Ensure result is in Z_n* (> 1)

  return result;
}

// ─── BigInt / Buffer Utilities ─────────────────────────────────────────────

function bufferToBigInt(buf: Buffer): bigint {
  if (buf.length === 0) return 0n;
  return BigInt("0x" + buf.toString("hex"));
}

function bigIntToBuffer(value: bigint, length: number): Buffer {
  let hex = value.toString(16);
  if (hex.length % 2 !== 0) hex = "0" + hex;
  const buf = Buffer.from(hex, "hex");

  if (buf.length < length) {
    return Buffer.concat([Buffer.alloc(length - buf.length), buf]);
  }
  if (buf.length > length) {
    return buf.subarray(buf.length - length);
  }
  return buf;
}

function bigIntToHex(value: bigint): string {
  let hex = value.toString(16);
  if (hex.length % 2 !== 0) hex = "0" + hex;
  return hex;
}

function base64urlToBigInt(b64url: string): bigint {
  const hex = Buffer.from(b64url, "base64url").toString("hex");
  return BigInt("0x" + hex);
}

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b > 0n) {
    [a, b] = [b, a % b];
  }
  return a;
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  if (mod === 1n) return 0n;
  let result = 1n;
  base = ((base % mod) + mod) % mod;
  while (exp > 0n) {
    if (exp & 1n) {
      result = (result * base) % mod;
    }
    exp >>= 1n;
    base = (base * base) % mod;
  }
  return result;
}

function modInverse(a: bigint, m: bigint): bigint {
  const [g, x] = extendedGcd(((a % m) + m) % m, m);
  if (g !== 1n) {
    throw new Error("Modular inverse does not exist — gcd(a, m) !== 1");
  }
  return ((x % m) + m) % m;
}

function extendedGcd(a: bigint, b: bigint): [bigint, bigint, bigint] {
  if (a === 0n) return [b, 0n, 1n];
  const [g, x1, y1] = extendedGcd(b % a, a);
  return [g, y1 - (b / a) * x1, x1];
}
