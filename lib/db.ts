import path from "node:path";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient } from "@/lib/generated/prisma/client";

// Kept in sync with DEFAULT_DATABASE_URL in lib/env.ts. Deliberately not
// imported from there: that module touches the filesystem, which must stay
// out of the Next.js server bundle.
const DEFAULT_DATABASE_URL = "file:./prisma/dev.db";

/**
 * Resolve DATABASE_URL to an absolute file path.
 *
 * Prisma resolves a relative `file:` URL against prisma.config.ts (the project
 * root); better-sqlite3 resolves against process.cwd(). Both are the project
 * root when npm scripts are used, but we make it explicit so the CLI and the
 * runtime can never open two different database files.
 */
export function sqliteFilePath(): string {
  const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const withoutScheme = url.startsWith("file:") ? url.slice("file:".length) : url;
  // turbopackIgnore: this resolves a config value, not a bundled asset path.
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), withoutScheme);
}

function createPrismaClient() {
  return new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: sqliteFilePath() }),
  });
}

type BouncerPrismaClient = ReturnType<typeof createPrismaClient>;

// Next.js dev server hot-reloads modules; without a global singleton every
// reload would open another SQLite handle.
const globalForPrisma = globalThis as unknown as {
  bouncerPrisma?: BouncerPrismaClient;
};

export const prisma: BouncerPrismaClient =
  globalForPrisma.bouncerPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.bouncerPrisma = prisma;
}
