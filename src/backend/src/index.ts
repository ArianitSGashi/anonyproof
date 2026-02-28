import "dotenv/config";

import cors from "cors";
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createDatabase, getDatabaseConfig } from "./db/connection.js";
import { initializeDatabase, destroyDatabase } from "./db/index.js";
import { runMigrations } from "./db/migrator.js";
import { registerRoutes } from "./routes/index.js";
import { errorHandler } from "./middleware/error-handler.js";

const app = express();
const port = Number(process.env["PORT"] ?? 3001);

// Global middleware
app.use(cors());
app.use(express.json());

// Register all routes (health, API, admin)
registerRoutes(app);

// Global error handler — must be registered AFTER all routes
app.use(errorHandler);

// Connect to DB, run migrations, then start server
async function bootstrap(): Promise<void> {
  const dbConfig = getDatabaseConfig();
  console.log(
    `Connecting to PostgreSQL at ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}...`
  );

  // 1. Run pending migrations using a short-lived pool
  const migrationDb = createDatabase(dbConfig);

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const migrationsDir = join(__dirname, "db", "migrations");

  console.log("Running database migrations...");
  const result = await runMigrations(migrationDb, migrationsDir);

  if (result.appliedCount > 0) {
    console.log(`Applied ${result.appliedCount} migration(s).`);
  } else {
    console.log("Database is up to date — no pending migrations.");
  }

  // Destroy the migration-only pool (it's no longer needed)
  await migrationDb.destroy();

  // 2. Initialize the persistent app database pool (used by services/routes)
  initializeDatabase(dbConfig);
  console.log("Database connection pool initialized.");

  // 3. Start Express server
  const server = app.listen(port, () => {
    console.log(`API listening on http://localhost:${port}`);
  });

  // 4. Graceful shutdown — release DB connections on SIGTERM/SIGINT
  let isShuttingDown = false;

  const shutdown = async () => {
    if (isShuttingDown) return; // Guard against duplicate signals
    isShuttingDown = true;

    console.log("\nShutting down gracefully...");

    // Wait for the HTTP server to fully close (finish in-flight requests)
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });

    await destroyDatabase();
    console.log("Database connections released. Goodbye.");
  };

  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

bootstrap().catch((err: unknown) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
