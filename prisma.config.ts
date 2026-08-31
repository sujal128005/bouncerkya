import path from "node:path";

import { defineConfig } from "prisma/config";

import { resolveDatabaseUrl } from "./lib/env";

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Prisma 7 does not read .env on its own — resolveDatabaseUrl() loads it
    // (and falls back to prisma/dev.db) so the CLI always has a URL.
    url: resolveDatabaseUrl(),
  },
});
