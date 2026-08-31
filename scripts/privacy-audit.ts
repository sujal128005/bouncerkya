/**
 * Repository privacy audit.
 *
 *   npm run privacy:audit
 *
 * Checks the things that actually leak from projects like this one, in the
 * order they actually leak: a committed .env, a committed database, a key
 * pasted into a source file, a secret exposed to the browser through a
 * NEXT_PUBLIC_ variable.
 *
 * It reads what git TRACKS rather than what is on disk, because the question
 * is not "is there a secret in this folder" — of course there is, that is what
 * .env is for — but "is there a secret in the thing I am about to push".
 *
 * Exits non-zero on any finding, so it can gate a commit.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

type Finding = { severity: "fail" | "warn"; where: string; detail: string };

const findings: Finding[] = [];
const fail = (where: string, detail: string) =>
  findings.push({ severity: "fail", where, detail });
const warn = (where: string, detail: string) =>
  findings.push({ severity: "warn", where, detail });

function trackedFiles(): string[] {
  try {
    return execFileSync("git", ["ls-files"], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
  } catch {
    console.error("Not a git repository, or git is unavailable. Nothing to audit.");
    process.exit(2);
  }
}

/*
 * Patterns for credentials this project actually uses, plus the generic shapes
 * that show up in leaked repositories. Deliberately narrow: an audit that
 * cries wolf gets switched off, and a switched-off audit finds nothing.
 */
const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "Razorpay live key id", re: /\brzp_live_[A-Za-z0-9]{10,}/ },
  { name: "Razorpay test key id", re: /\brzp_test_[A-Za-z0-9]{10,}/ },
  { name: "Anthropic API key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: "OpenAI-style API key", re: /\bsk-[A-Za-z0-9]{32,}/ },
  { name: "Groq API key", re: /\bgsk_[A-Za-z0-9]{20,}/ },
  { name: "Google API key", re: /\bAIza[A-Za-z0-9_-]{30,}/ },
  { name: "OpenRouter API key", re: /\bsk-or-v1-[A-Za-z0-9]{20,}/ },
  { name: "PEM private key block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  {
    name: "assigned encryption key",
    re: /BOUNCER_ENCRYPTION_KEY\s*=\s*["'][A-Za-z0-9+/=]{40,}["']/,
  },
];

/** Files that are allowed to contain a pattern, because they document it. */
const DOCUMENTS_PATTERNS = new Set([
  ".env.example",
  "README.md",
  "scripts/privacy-audit.ts",
  "lib/config-check.ts",
  "lib/razorpay/client.ts",
  "lib/config-check.test.ts",
  "lib/razorpay/razorpay.test.ts",
  "lib/evidence.ts",
]);

const MUST_NOT_BE_TRACKED = [
  { pattern: /^\.env$/, what: "the real .env" },
  { pattern: /^\.env\.(?!example$)/, what: "an environment file" },
  { pattern: /^keystore\//, what: "the agent keystore" },
  { pattern: /\.db$/, what: "a SQLite database" },
  { pattern: /\.db-journal$/, what: "a SQLite journal" },
  { pattern: /^lib\/generated\//, what: "the generated Prisma client" },
  { pattern: /\.pem$/, what: "a PEM key file" },
];

function main(): void {
  const tracked = trackedFiles();
  console.log(`Bouncer privacy audit\n${tracked.length} tracked files\n`);

  // 1. Things that must never be in the repository at all.
  for (const file of tracked) {
    for (const rule of MUST_NOT_BE_TRACKED) {
      if (rule.pattern.test(file)) {
        fail(file, `${rule.what} is tracked by git and would be pushed`);
      }
    }
  }

  // 2. Credential-shaped strings inside tracked text files.
  for (const file of tracked) {
    if (DOCUMENTS_PATTERNS.has(file)) continue;
    let content: string;
    try {
      const stat = fs.statSync(file);
      if (stat.size > 2_000_000) continue;
      content = fs.readFileSync(file, "utf8");
    } catch {
      continue; // binary, deleted, or unreadable: nothing to scan
    }
    // A NUL byte means binary. Scanning it would only produce noise.
    if (content.includes("\u0000")) continue;

    for (const { name, re } of SECRET_PATTERNS) {
      const match = re.exec(content);
      if (match) {
        const line = content.slice(0, match.index).split("\n").length;
        // The finding names the file, the line and the KIND. It never prints
        // the match: an audit tool that echoes the secret it found has copied
        // it into your terminal scrollback and your CI logs.
        fail(`${file}:${line}`, `looks like ${name}`);
      }
    }
  }

  // 3. Anything exposed to the browser on purpose.
  for (const file of tracked) {
    if (!/\.(ts|tsx|mjs|js)$/.test(file)) continue;
    let content: string;
    try {
      content = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const match of content.matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g)) {
      warn(
        file,
        `${match[0]} is inlined into the client bundle and is readable by anyone`,
      );
    }
  }

  // 4. The ignore rules the above depends on.
  const gitignore = fs.existsSync(".gitignore")
    ? fs.readFileSync(".gitignore", "utf8")
    : "";
  for (const required of [".env", "keystore", ".db"]) {
    if (!gitignore.includes(required)) {
      fail(".gitignore", `has no rule covering "${required}"`);
    }
  }

  // 5. The encryption key must not be committed even in an example.
  const example = fs.existsSync(".env.example")
    ? fs.readFileSync(".env.example", "utf8")
    : "";
  const assigned = /BOUNCER_ENCRYPTION_KEY\s*=\s*"([^"]+)"/.exec(example);
  if (assigned && assigned[1].length > 0) {
    fail(".env.example", "ships a real-looking encryption key; it must be empty");
  }

  report();
}

function report(): void {
  const fails = findings.filter((f) => f.severity === "fail");
  const warns = findings.filter((f) => f.severity === "warn");

  for (const f of warns) console.log(`  WARN  ${f.where}\n        ${f.detail}`);
  for (const f of fails) console.log(`  FAIL  ${f.where}\n        ${f.detail}`);

  if (fails.length === 0 && warns.length === 0) {
    console.log("  No findings.\n");
  } else {
    console.log("");
  }

  console.log(
    "Checked: tracked env files, keystores, databases and PEM keys; " +
      "credential-shaped strings in tracked text; NEXT_PUBLIC_ exposure; " +
      "and the ignore rules those depend on.",
  );
  console.log(
    "NOT checked: git history (a secret removed from HEAD is still in the " +
      "objects), anything untracked, and whether a value that looks safe is.",
  );

  process.exitCode = fails.length > 0 ? 1 : 0;
}

process.chdir(path.resolve(import.meta.dirname, ".."));
main();
