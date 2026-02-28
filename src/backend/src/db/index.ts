/**
 * Database singleton module.
 *
 * Provides a single Kysely instance that is initialized during bootstrap
 * and shared across all services/routes for the app's lifetime.
 *
 * Usage:
 *   import { getDb, initializeDatabase, destroyDatabase } from "./db/index.js";
 *
 *   // During bootstrap:
 *   await initializeDatabase(config);
 *
 *   // In services/routes:
 *   const db = getDb();
 *   const rows = await db.selectFrom("posts").selectAll().execute();
 *
 *   // During graceful shutdown:
 *   await destroyDatabase();
 */

import type { Kysely } from "kysely";
import { createDatabase, type DatabaseConfig } from "./connection.js";
import type { Database } from "../types/database.js";

let _db: Kysely<Database> | null = null;

/**
 * Initializes the singleton database connection.
 * Must be called once during application bootstrap before any queries.
 *
 * @throws If already initialized (call destroyDatabase() first to reinitialize)
 */
export function initializeDatabase(config: DatabaseConfig): Kysely<Database> {
  if (_db !== null) {
    throw new Error(
      "Database already initialized. Call destroyDatabase() before reinitializing."
    );
  }

  _db = createDatabase(config);
  return _db;
}

/**
 * Returns the singleton Kysely database instance.
 *
 * @throws If called before initializeDatabase()
 */
export function getDb(): Kysely<Database> {
  if (_db === null) {
    throw new Error(
      "Database not initialized. Call initializeDatabase() during bootstrap before accessing the database."
    );
  }

  return _db;
}

/**
 * Destroys the database connection pool.
 * Call during graceful shutdown to release all connections.
 */
export async function destroyDatabase(): Promise<void> {
  if (_db !== null) {
    await _db.destroy();
    _db = null;
  }
}
