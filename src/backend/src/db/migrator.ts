import { type Kysely, type Migration, type MigrationProvider, Migrator, sql } from "kysely";
import { readdir, readFile } from "node:fs/promises";
import { join, extname, basename } from "node:path";

/**
 * A MigrationProvider that reads raw .sql files from a directory.
 * Files must be named with a sortable prefix: 001_name.sql, 002_name.sql, etc.
 *
 * Each .sql file becomes a Kysely migration whose `up()` executes the full SQL.
 * Down migrations are not supported (use additive migrations instead).
 */
class SqlFileMigrationProvider implements MigrationProvider {
  private readonly migrationsDir: string;

  constructor(migrationsDir: string) {
    this.migrationsDir = migrationsDir;
  }

  async getMigrations(): Promise<Record<string, Migration>> {
    const files = await readdir(this.migrationsDir);

    const sqlFiles = files
      .filter((f) => extname(f) === ".sql")
      .sort(); // lexicographic sort → 001 before 002

    const migrations: Record<string, Migration> = {};

    for (const file of sqlFiles) {
      const name = basename(file, ".sql"); // "001_initial_schema"
      const filePath = join(this.migrationsDir, file);

      migrations[name] = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async up(db: Kysely<any>): Promise<void> {
          const sqlContent = await readFile(filePath, "utf-8");
          await sql.raw(sqlContent).execute(db);
        },
        // Down migrations not supported — use additive-only migration strategy
        async down(): Promise<void> {
          throw new Error(
            `Down migration not supported for "${name}". ` +
              `Use additive migrations (new .sql files) instead of rolling back.`
          );
        },
      };
    }

    return migrations;
  }
}

export interface MigrationResult {
  appliedCount: number;
  appliedMigrations: string[];
}

/**
 * Runs all pending migrations from the migrations directory.
 * Creates the `kysely_migration` tracking table automatically on first run.
 *
 * @returns Summary of applied migrations
 * @throws If any migration fails (all changes in that migration are rolled back)
 */
export async function runMigrations(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: Kysely<any>,
  migrationsDir: string
): Promise<MigrationResult> {
  const migrator = new Migrator({
    db,
    provider: new SqlFileMigrationProvider(migrationsDir),
  });

  const { error, results } = await migrator.migrateToLatest();

  const applied =
    results?.filter((r) => r.status === "Success").map((r) => r.migrationName) ?? [];
  const failed = results?.filter((r) => r.status === "Error") ?? [];

  // Log results
  for (const result of results ?? []) {
    if (result.status === "Success") {
      console.log(`  ✔ Applied migration: ${result.migrationName}`);
    } else if (result.status === "NotExecuted") {
      console.log(`  ⏭ Not executed (possibly blocked by earlier failure): ${result.migrationName}`);
    } else {
      console.error(`  ✖ Failed migration: ${result.migrationName}`);
    }
  }

  if (error) {
    console.error("Migration failed:", error);
    throw error;
  }

  if (failed.length > 0) {
    throw new Error(`${failed.length} migration(s) failed. See logs above.`);
  }

  return {
    appliedCount: applied.length,
    appliedMigrations: applied,
  };
}
