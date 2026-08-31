import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";

/**
 * Creates a throwaway SQLite database with every migration applied, so the
 * persistence tests exercise the real schema rather than a hand-built mock.
 *
 * Sets DATABASE_URL before returning: callers must dynamically import lib/db
 * afterwards, since that module resolves the file path at load time.
 */
export function createTempDatabase(): { file: string; cleanup: () => void } {
  const file = path.join(os.tmpdir(), `bouncer-test-${randomUUID()}.db`);
  const migrationsDir = path.resolve(process.cwd(), "prisma", "migrations");

  const db = new Database(file);
  db.pragma("foreign_keys = OFF");

  const names = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const name of names) {
    const sqlPath = path.join(migrationsDir, name, "migration.sql");
    if (fs.existsSync(sqlPath)) db.exec(fs.readFileSync(sqlPath, "utf8"));
  }

  db.pragma("foreign_keys = ON");
  db.close();

  process.env.DATABASE_URL = `file:${file}`;

  return {
    file,
    cleanup: () => fs.rmSync(file, { force: true }),
  };
}
