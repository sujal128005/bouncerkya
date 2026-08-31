/**
 * Engine-free migration runner.
 *
 * `prisma migrate deploy` is the normal way to apply these migrations and it
 * works wherever binaries.prisma.sh is reachable. This script exists because
 * the environment this project was built in cannot download the Prisma schema
 * engine, so it applies the very same prisma/migrations/<name>/migration.sql
 * files over the better-sqlite3 driver and records them in `_prisma_migrations`
 * using Prisma's own bookkeeping format (sha256 checksum of the SQL file).
 *
 * Because the checksums match, a later `prisma migrate deploy` / `migrate dev`
 * on a machine with network access sees these migrations as already applied and
 * does not re-run them.
 */
import "../lib/load-env";

import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { sqliteFilePath } from "../lib/db";

const MIGRATIONS_DIR = path.resolve(process.cwd(), "prisma", "migrations");

const PRISMA_MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id"                    TEXT PRIMARY KEY NOT NULL,
    "checksum"              TEXT NOT NULL,
    "finished_at"           DATETIME,
    "migration_name"        TEXT NOT NULL,
    "logs"                  TEXT,
    "rolled_back_at"        DATETIME,
    "started_at"            DATETIME NOT NULL DEFAULT current_timestamp,
    "applied_steps_count"   INTEGER UNSIGNED NOT NULL DEFAULT 0
);`;

function migrationNames(): string[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function main(): void {
  const dbPath = sqliteFilePath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.exec(PRISMA_MIGRATIONS_TABLE);

  // Foreign keys stay off while migrations run. SQLite cannot ALTER a column,
  // so changing one means create-copy-drop-rename, and the PRAGMA statements
  // Prisma emits inside a migration are no-ops within a transaction — the
  // switch has to happen out here, at the connection level.
  db.pragma("foreign_keys = OFF");

  const applied = new Set(
    db
      .prepare(
        `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`,
      )
      .all()
      .map((row) => (row as { migration_name: string }).migration_name),
  );

  let count = 0;
  for (const name of migrationNames()) {
    if (applied.has(name)) {
      console.log(`  = ${name} (already applied)`);
      continue;
    }

    const sqlPath = path.join(MIGRATIONS_DIR, name, "migration.sql");
    if (!fs.existsSync(sqlPath)) continue;

    const sql = fs.readFileSync(sqlPath, "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");

    db.transaction(() => {
      db.exec(sql);
      db.prepare(
        `INSERT INTO "_prisma_migrations"
           (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
         VALUES (?, ?, current_timestamp, ?, NULL, NULL, current_timestamp, 1)`,
      ).run(randomUUID(), checksum, name);
    })();

    console.log(`  + ${name}`);
    count += 1;
  }

  db.pragma("foreign_keys = ON");
  const violations = db.pragma("foreign_key_check") as unknown[];
  if (violations.length > 0) {
    db.close();
    throw new Error(
      `migrations left ${violations.length} foreign key violation(s) in ${dbPath}`,
    );
  }

  db.close();
  console.log(
    count === 0
      ? `Database up to date at ${dbPath}`
      : `Applied ${count} migration(s) to ${dbPath}`,
  );
}

main();
