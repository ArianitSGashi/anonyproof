/**
 * Buffer / hex conversion utilities for BYTEA(32) fields.
 *
 * All cryptographic fields in the database (group_id, identity_commitment,
 * nullifier_hash, hash_value) are stored as BYTEA(32). These helpers convert
 * between hex strings (used in API layer) and Buffers (used in DB layer).
 */

/**
 * Converts a hex string (with or without "0x" prefix) to a Buffer.
 *
 * @param hex - Hex string, e.g. "0xab3f..." or "ab3f..."
 * @returns Buffer of decoded bytes
 * @throws If the hex string has odd length or contains non-hex characters
 */
export function hexToBuffer(hex: string): Buffer {
  const cleaned = hex.startsWith("0x") ? hex.slice(2) : hex;

  if (cleaned.length % 2 !== 0) {
    throw new Error(
      `Invalid hex string: odd number of characters (${cleaned.length})`
    );
  }

  if (!/^[0-9a-fA-F]*$/.test(cleaned)) {
    throw new Error("Invalid hex string: contains non-hex characters");
  }

  return Buffer.from(cleaned, "hex");
}

/**
 * Converts a Buffer to a lowercase hex string without "0x" prefix.
 */
export function bufferToHex(buf: Buffer): string {
  return buf.toString("hex");
}

/**
 * Converts a Buffer to a hex string with "0x" prefix.
 */
export function bufferToHexPrefixed(buf: Buffer): string {
  return `0x${buf.toString("hex")}`;
}

/**
 * Validates that a Buffer is exactly 32 bytes (256 bits).
 * Used for all cryptographic fields: group_id, identity_commitment,
 * nullifier_hash, hash_value.
 */
export function isValidBytea32(buf: Buffer): boolean {
  return Buffer.isBuffer(buf) && buf.length === 32;
}

/**
 * Validates and converts a hex string to a 32-byte Buffer.
 * Combines hexToBuffer + isValidBytea32 for convenience.
 *
 * @param hex - Hex string representing 32 bytes (64 hex chars, optional 0x prefix)
 * @returns Buffer of exactly 32 bytes
 * @throws If hex is invalid or result is not 32 bytes
 */
export function hexToBytea32(hex: string): Buffer {
  const buf = hexToBuffer(hex);

  if (!isValidBytea32(buf)) {
    throw new Error(
      `Expected 32 bytes (64 hex chars), got ${buf.length} bytes (${buf.length * 2} hex chars)`
    );
  }

  return buf;
}
