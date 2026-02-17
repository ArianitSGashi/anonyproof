import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

/**
 * Reads database configuration from environment variables.
 * Throws if any required variable is missing.
 */
export function getDatabaseConfig(): DatabaseConfig {
  const host = process.env["DATABASE_HOST"];
  const port = process.env["DATABASE_PORT"];
  const database = process.env["DATABASE_NAME"];
  const user = process.env["DATABASE_USER"];
  const password = process.env["DATABASE_PASSWORD"];

  const missing: string[] = [];
  if (!host) missing.push("DATABASE_HOST");
  if (!port) missing.push("DATABASE_PORT");
  if (!database) missing.push("DATABASE_NAME");
  if (!user) missing.push("DATABASE_USER");
  if (!password) missing.push("DATABASE_PASSWORD");

  if (missing.length > 0) {
    throw new Error(
      `Missing required database environment variables: ${missing.join(", ")}. ` +
        `Copy .env.example to .env and fill in your values.`
    );
  }

  return {
    host: host!,
    port: Number(port),
    database: database!,
    user: user!,
    password: password!,
  };
}

/**
 * Creates and returns a Kysely database instance connected to PostgreSQL.
 */
export function createDatabase(config: DatabaseConfig): Kysely<Record<string, unknown>> {
  const dialect = new PostgresDialect({
    pool: new pg.Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      max: 10, // max pool connections
    }),
  });

  return new Kysely({ dialect });
}
