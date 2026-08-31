/**
 * Deletes the SQLite database so `db:setup` can rebuild it.
 *
 * WHY THIS IS A SCRIPT AND NOT A ONE-LINER
 *
 * It used to be `node -e "require('fs').rmSync(...)"`, which is fine until the
 * dev server is running, and then it is actively harmful in two different ways
 * depending on the platform:
 *
 *   Windows  rmSync throws EPERM and prints a nine-line Node stack trace whose
 *            cause ("something has the file open") appears nowhere in it. The
 *            reset silently does not happen and the next command carries on.
 *
 *   Linux    the delete SUCCEEDS. The running server keeps its handle to the
 *            now-unlinked inode and goes on serving the OLD data while the
 *            seeder writes a brand-new database beside it. Worse, the seed
 *            rewrites the keystore, so the stale rows stop verifying and every
 *            scenario suddenly reports `invalid_signature`, which looks exactly
 *            like the mandate verifier having broken.
 *
 * The second is the dangerous one: it fails quietly and produces a wrong
 * screen rather than an error. So this script names the cause on Windows, and
 * warns about the silent case everywhere else.
 */

import fs from "node:fs";
import path from "node:path";

const DEFAULT_DATABASE_URL = "file:./prisma/dev.db";

/** Resolves DATABASE_URL to an absolute path, the same way lib/db.ts does. */
export function databaseFile(env: Record<string, string | undefined> = process.env): string {
  const url = env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const withoutScheme = url.startsWith("file:") ? url.slice("file:".length) : url;
  return path.resolve(process.cwd(), withoutScheme);
}

/** Injectable so the failure branch can be tested; there is no portable way to
 *  make a file undeletable in a test, and root ignores directory permissions. */
export type Remover = (target: string) => void;

const rmSync: Remover = (target) => fs.rmSync(target, { force: true });

export function lockedFileMessage(relativePath: string): string {
  return (
    `\nCannot delete ${relativePath} because something has it open.\n\n` +
    "Almost always this is the dev server. Stop it and run this again:\n\n" +
    "  Windows      taskkill /IM node.exe /F\n" +
    "  macOS/Linux  pkill -f 'next dev'\n\n" +
    "A File Explorer window sitting in prisma/, or a SQLite viewer with the\n" +
    "file open, will do it too.\n\n" +
    "Nothing was changed. Your database is exactly as it was.\n"
  );
}

export class DatabaseLockedError extends Error {
  constructor(readonly relativePath: string) {
    super(lockedFileMessage(relativePath));
    this.name = "DatabaseLockedError";
  }
}

/** Codes every platform uses for "someone else has this file". */
export const LOCKED_CODES = ["EPERM", "EBUSY", "EACCES"];

export function removeDatabaseFiles(
  file: string,
  remove: Remover = rmSync,
  exists: (p: string) => boolean = fs.existsSync,
): void {
  // -journal, -wal and -shm are SQLite's sidecars. Leaving one behind next to
  // a fresh database is a good way to produce a confusing corruption error.
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const target = `${file}${suffix}`;
    if (!exists(target)) continue;
    try {
      remove(target);
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== undefined && LOCKED_CODES.includes(code)) {
        throw new DatabaseLockedError(path.relative(process.cwd(), target));
      }
      throw error;
    }
  }
}
