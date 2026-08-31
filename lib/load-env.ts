/**
 * Side-effect module. Import this FIRST — before anything that reads
 * process.env — in scripts that run outside Next.js (prisma/migrate.ts,
 * prisma/seed.ts). Next.js loads .env itself, so app code must not import
 * this: it would pull filesystem access into the server bundle.
 */
import { resolveDatabaseUrl } from "./env";

resolveDatabaseUrl();
