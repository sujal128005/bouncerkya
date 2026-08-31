import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module; it must not be bundled into the
  // server build or the .node binding fails to resolve at runtime.
  serverExternalPackages: ["better-sqlite3", "@prisma/adapter-better-sqlite3"],
  // Next writes AGENTS.md / CLAUDE.md into the repo root on every `next dev`.
  // They are editor tooling, not source, and do not belong in version control.
  agentRules: false,
};

export default nextConfig;
