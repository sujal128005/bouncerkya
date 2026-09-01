/**
 * CLI wrapper for the database reset. The logic, and its tests, live in
 * lib/db-reset.ts; this file only reads argv-free config, calls it, and turns
 * the one expected failure into a readable message and a non-zero exit.
 */

// FIRST: this script runs outside Next.js, which means nothing has read .env
// yet. Without it the configuration check below sees an empty environment and
// reports every variable as missing.
import "../lib/load-env";

import fs from "node:fs";
import path from "node:path";

import { assertConfiguration } from "../lib/config-check";
import {
  DatabaseLockedError,
  databaseFile,
  removeDatabaseFiles,
} from "../lib/db-reset";

/*
 * Check the environment BEFORE deleting anything.
 *
 * `db:reset` is `rm the database && rebuild it`. If the rebuild cannot
 * possibly succeed, deleting first is pure loss: you end up with no data and
 * an error about whatever the seeder happened to touch first. One line here
 * turns that into a refusal that names the wrong variable and leaves the
 * existing database exactly where it was.
 */
try {
  assertConfiguration();
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error("\nNothing was deleted. Fix .env and run this again.");
  process.exit(1);
}

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
