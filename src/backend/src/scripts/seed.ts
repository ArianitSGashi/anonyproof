/**
 * Development Seed Script
 *
 * Creates initial data for local development:
 *   1. A default superadmin account
 *   2. A sample Semaphore group ("Development University")
 *
 * Usage:
 *   pnpm seed
 *
 * Idempotent — skips records that already exist.
 */

import "dotenv/config";

import bcrypt from "bcrypt";
import { poseidon1 } from "poseidon-lite";
import * as crypto from "node:crypto";
import { createDatabase, getDatabaseConfig } from "../db/connection.js";

const BCRYPT_ROUNDS = 12;

// ─── Default data ────────────────────────────────────────────────────────────

const DEFAULT_ADMIN = {
  username: "admin",
  email: "admin@anonyproof.dev",
  password: "admin1234",
  role: "superadmin" as const,
};

const DEFAULT_GROUP = {
  name: "Development University",
  description: "Default group for local development and testing",
  depth: 20,
};

// ─── Main ────────────────────────────────────────────────────────────────────

async function seed(): Promise<void> {
  console.log("Seeding database...\n");

  const config = getDatabaseConfig();
  const db = createDatabase(config);

  try {
    // 1. Create superadmin account
    console.log("1. Creating default superadmin account...");
    const existingAdmin = await db
      .selectFrom("admin_users")
      .select("id")
      .where("username", "=", DEFAULT_ADMIN.username)
      .executeTakeFirst();

    if (existingAdmin) {
      console.log(
        `   Skipped — admin "${DEFAULT_ADMIN.username}" already exists.`,
      );
    } else {
      const passwordHash = await bcrypt.hash(
        DEFAULT_ADMIN.password,
        BCRYPT_ROUNDS,
      );

      await db
        .insertInto("admin_users")
        .values({
          username: DEFAULT_ADMIN.username,
          email: DEFAULT_ADMIN.email,
          password_hash: passwordHash,
          role: DEFAULT_ADMIN.role,
        })
        .execute();

      console.log("   Created superadmin:");
      console.log(`     Username: ${DEFAULT_ADMIN.username}`);
      console.log(`     Password: ${DEFAULT_ADMIN.password}`);
      console.log(`     Email:    ${DEFAULT_ADMIN.email}`);
      console.log(`     Role:     ${DEFAULT_ADMIN.role}`);
    }

    // 2. Create default Semaphore group
    console.log("\n2. Creating default Semaphore group...");
    const existingGroup = await db
      .selectFrom("semaphore_groups")
      .select("id")
      .where("name", "=", DEFAULT_GROUP.name)
      .executeTakeFirst();

    if (existingGroup) {
      console.log(
        `   Skipped — group "${DEFAULT_GROUP.name}" already exists.`,
      );
    } else {
      const groupId = crypto.randomBytes(32);
      const zeroValueBigInt = poseidon1([0n]);
      const zeroValue = bigIntToBuffer32(zeroValueBigInt);

      const group = await db
        .insertInto("semaphore_groups")
        .values({
          group_id: groupId,
          name: DEFAULT_GROUP.name,
          description: DEFAULT_GROUP.description,
          depth: DEFAULT_GROUP.depth,
          zero_value: zeroValue,
        })
        .returning(["id", "group_id"])
        .executeTakeFirstOrThrow();

      console.log("   Created group:");
      console.log(`     Name:     ${DEFAULT_GROUP.name}`);
      console.log(`     Group ID: ${group.group_id.toString("hex")}`);
      console.log(`     Depth:    ${DEFAULT_GROUP.depth}`);
      console.log(`     Max members: ${Math.pow(2, DEFAULT_GROUP.depth)}`);
    }

    console.log("\nSeed complete.");
  } finally {
    await db.destroy();
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function bigIntToBuffer32(value: bigint): Buffer {
  if (value === 0n) return Buffer.alloc(32);
  let hex = value.toString(16);
  if (hex.length % 2 !== 0) hex = "0" + hex;
  const raw = Buffer.from(hex, "hex");
  if (raw.length >= 32) return raw.subarray(raw.length - 32);
  const padded = Buffer.alloc(32);
  raw.copy(padded, 32 - raw.length);
  return padded;
}

// ─── Run ─────────────────────────────────────────────────────────────────────

seed().catch((err: unknown) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
