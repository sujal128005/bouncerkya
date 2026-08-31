/**
 * CLI wrapper for the database reset. The logic, and its tests, live in
 * lib/db-reset.ts; this file only reads argv-free config, calls it, and turns
 * the one expected failure into a readable message and a non-zero exit.
 */

import fs from "node:fs";
import path from "node:path";

import {
  DatabaseLockedError,
  databaseFile,
  removeDatabaseFiles,
} from "../lib/db-reset";

const file = databaseFile();
const existed = fs.existsSync(file);

try {
  removeDatabaseFiles(file);
} catch (error: unknown) {
  if (error instanceof DatabaseLockedError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}

console.log(
  existed
    ? `Removed ${path.relative(process.cwd(), file)}.`
    : "No database to remove; building a fresh one.",
);

if (process.platform !== "win32") {
  // On Windows the delete would have failed above, so this only matters here:
  // a running server keeps serving the deleted inode while the seeder writes a
  // new file beside it, and the stale rows then fail against the new keystore.
  console.log(
    "If a dev server was running, stop and restart it: on this platform it\n" +
      "keeps serving the deleted file and every scenario will report\n" +
      "invalid_signature against the newly seeded keystore.",
  );
}
