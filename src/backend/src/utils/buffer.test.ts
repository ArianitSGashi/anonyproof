import { describe, it, expect } from "vitest";
import {
  hexToBuffer,
  bufferToHex,
  bufferToHexPrefixed,
  isValidBytea32,
  hexToBytea32,
} from "./buffer.js";

describe("hexToBuffer", () => {
  it("converts a plain hex string to a Buffer", () => {
    const buf = hexToBuffer("aabbcc");
    expect(buf).toEqual(Buffer.from([0xaa, 0xbb, 0xcc]));
  });

  it("handles 0x-prefixed hex strings", () => {
    const buf = hexToBuffer("0xaabbcc");
    expect(buf).toEqual(Buffer.from([0xaa, 0xbb, 0xcc]));
  });

  it("converts a 64-char hex string to 32 bytes", () => {
    const hex = "a".repeat(64);
    const buf = hexToBuffer(hex);
    expect(buf.length).toBe(32);
  });

  it("handles empty hex string", () => {
    const buf = hexToBuffer("");
    expect(buf.length).toBe(0);
  });

  it("handles 0x prefix alone as empty", () => {
    const buf = hexToBuffer("0x");
    expect(buf.length).toBe(0);
  });

  it("is case-insensitive", () => {
    const lower = hexToBuffer("aabb");
    const upper = hexToBuffer("AABB");
    expect(lower).toEqual(upper);
  });

  it("throws on odd-length hex string", () => {
    expect(() => hexToBuffer("abc")).toThrow("odd number of characters");
  });

  it("throws on non-hex characters", () => {
    expect(() => hexToBuffer("gggg")).toThrow("non-hex characters");
  });
});

describe("bufferToHex", () => {
  it("converts a Buffer to lowercase hex without prefix", () => {
    const buf = Buffer.from([0xaa, 0xbb, 0xcc]);
    expect(bufferToHex(buf)).toBe("aabbcc");
  });

  it("handles empty buffer", () => {
    expect(bufferToHex(Buffer.alloc(0))).toBe("");
  });

  it("handles 32-byte buffer", () => {
    const buf = Buffer.alloc(32, 0xff);
    expect(bufferToHex(buf)).toBe("f".repeat(64));
  });
});

describe("bufferToHexPrefixed", () => {
  it("converts a Buffer to hex with 0x prefix", () => {
    const buf = Buffer.from([0xaa, 0xbb]);
    expect(bufferToHexPrefixed(buf)).toBe("0xaabb");
  });
});

describe("isValidBytea32", () => {
  it("returns true for exactly 32-byte buffer", () => {
    expect(isValidBytea32(Buffer.alloc(32))).toBe(true);
  });

  it("returns false for 31-byte buffer", () => {
    expect(isValidBytea32(Buffer.alloc(31))).toBe(false);
  });

  it("returns false for 33-byte buffer", () => {
    expect(isValidBytea32(Buffer.alloc(33))).toBe(false);
  });

  it("returns false for empty buffer", () => {
    expect(isValidBytea32(Buffer.alloc(0))).toBe(false);
  });
});

describe("hexToBytea32", () => {
  it("converts 64-char hex to 32-byte Buffer", () => {
    const hex = "ab".repeat(32);
    const buf = hexToBytea32(hex);
    expect(buf.length).toBe(32);
    expect(bufferToHex(buf)).toBe(hex);
  });

  it("handles 0x prefix", () => {
    const hex = "0x" + "cd".repeat(32);
    const buf = hexToBytea32(hex);
    expect(buf.length).toBe(32);
  });

  it("throws if result is not 32 bytes", () => {
    expect(() => hexToBytea32("aabb")).toThrow("Expected 32 bytes");
  });

  it("throws on invalid hex", () => {
    expect(() => hexToBytea32("zz".repeat(32))).toThrow("non-hex characters");
  });
});
