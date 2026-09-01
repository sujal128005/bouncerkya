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
/** SQLite writes these beside the database; a reset has to take them too. */
const SIDECARS = ["", "-journal", "-wal", "-shm"];

/** Windows reports a still-open handle as one of these. POSIX just unlinks. */
const LOCKED = new Set(["EPERM", "EBUSY", "EACCES"]);

/**
 * Deletes the temp database, and does not fail a passing suite over it.
 *
 * On Windows a file cannot be deleted while a handle is open, and a handle can
 * survive a few milliseconds past close. A caller that forgets to disconnect
 * turns a green run red in teardown, which is what happened here: 277 passing
 * assertions reported as a failed suite because of an EPERM in afterAll.
 *
 * Disconnecting first is still the caller's job and the real fix. This is the
 * backstop: retry briefly, and if the handle is genuinely still held, warn and
 * leave the file in the OS temp directory, where the OS will clear it. A
 * leaked temp file is not worth a false failure.
 */
export function removeTempDatabase(
  file: string,
  remove: (target: string) => void = (target) => fs.rmSync(target, { force: true }),
  attempts = 5,
): void {
  for (const suffix of SIDECARS) {
    const target = `${file}${suffix}`;
    for (let attempt = 1; ; attempt++) {
      try {
        remove(target);
        break;
      } catch (error: unknown) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === undefined || !LOCKED.has(code)) throw error;
        if (attempt >= attempts) {
          console.warn(
            `[test-support] could not delete ${target} (${code}); a handle is ` +
              `still open. Left for the OS to clear. Disconnect the Prisma ` +
              `client in afterAll before calling cleanup().`,
          );
          break;
        }
      }
    }
  }
}

export function createTempDatabase(): { file: string; cleanup: () => void } {
  const file = path.join(os.tmpdir(), `stealth-test-${randomUUID()}.db`);
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
    cleanup: () => removeTempDatabase(file),
  };
}
