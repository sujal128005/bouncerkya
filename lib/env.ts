import fs from "node:fs";
import path from "node:path";

/** Where the SQLite file lives when DATABASE_URL is not set. */
export const DEFAULT_DATABASE_URL = "file:./prisma/dev.db";

/**
 * Minimal .env loader.
 *
 * Next.js loads .env for the app, but the Prisma CLI (v7 dropped automatic
 * .env loading) and the tsx scripts do not, so `prisma generate` would fail
 * with "Cannot resolve environment variable: DATABASE_URL". Written by hand
 * rather than pulling in dotenv, and it never overwrites a variable that is
 * already set in the real environment.
 */
export function loadEnvFile(file = ".env"): void {
  const filePath = path.resolve(process.cwd(), file);
  if (!fs.existsSync(filePath)) return;

  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;

    const quoted =
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"));

    process.env[key] = quoted ? rawValue.slice(1, -1) : rawValue;
  }
}

/** Guarantees DATABASE_URL is set before Prisma or the app reads it. */
export function resolveDatabaseUrl(): string {
  if (!process.env.DATABASE_URL) loadEnvFile();
  const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  process.env.DATABASE_URL = url;
  return url;
}
