import "dotenv/config";

import cors from "cors";
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { HealthResponse } from "@repo/shared";
import { createDatabase, getDatabaseConfig } from "./db/connection.js";
import { runMigrations } from "./db/migrator.js";

const app = express();
const port = Number(process.env["PORT"] ?? 3001);

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  const payload: HealthResponse = {
    status: "ok",
    service: "backend",
    timestamp: new Date().toISOString()
  };

  res.status(200).json(payload);
});

// ── Bootstrap: connect to DB, run migrations, then start server ─────────
async function bootstrap(): Promise<void> {
  // 1. Connect to PostgreSQL
  const dbConfig = getDatabaseConfig();
  console.log(`Connecting to PostgreSQL at ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}...`);
  const db = createDatabase(dbConfig);

  // 2. Run pending migrations
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const migrationsDir = join(__dirname, "db", "migrations");

  console.log("Running database migrations...");
  const result = await runMigrations(db, migrationsDir);

  if (result.appliedCount > 0) {
    console.log(`Applied ${result.appliedCount} migration(s).`);
  } else {
    console.log("Database is up to date — no pending migrations.");
  }

  // Clean up the DB pool used for migrations
  await db.destroy();

  // 3. Start Express server
  app.listen(port, () => {
    console.log(`API listening on http://localhost:${port}`);
  });
}

bootstrap().catch((err: unknown) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
