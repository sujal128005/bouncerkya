/**
 * What the privacy page says, as data.
 *
 * Same discipline as lib/evidence.ts, and for the same reason: a privacy page
 * that only lists controls is a brochure. Every entry here states what it does
 * NOT protect against, in the same size type, because the limits are the part
 * a technical reader is looking for and the part that decides whether they
 * believe the rest.
 *
 * Nothing on this list is aspirational. Each control is implemented, each one
 * has tests named beside it, and where something is designed but absent it
 * appears under `absent` rather than being quietly omitted.
 */

export type Control = {
  id: string;
  title: string;
  /** One line a non-specialist can follow. */
  headline: string;
  /** How it works, for someone who wants the mechanism. */
  how: string;
  /** The concrete guarantee. */
  protects: string;
  /** The honest limit. Never softened. */
  doesNotProtect: string;
  /** How to check the claim rather than believe it. */
  verify: string;
  tests: string;
};

export const MODEL_BOUNDARY: Control = {
  id: "model-boundary",
  title: "Identity never reaches the model provider",
  headline:
    "Bouncer judges a cart with a large language model running at a third party. The cart goes. The shopper does not.",
  how: "The prompt is assembled from a narrow evidence object and then checked, at runtime, against the identity values belonging to that checkout. If any of them appear in the outbound string the call is abandoned before the HTTP request is made. Because an engine that cannot answer produces STEP_UP and never ALLOW, a privacy regression degrades into a human approval rather than a leak.",
  protects:
    "The provider receives authorized categories, the spend cap and currency, the cart's line names, quantities and prices, the listing ids, and the untrusted listing text. It does not receive the principal's name or id, the mandate id, the purchase request id, the agent id, the mandate nonce, the signature, or the merchant account id. It is given a shopping basket with no way to know whose it is.",
  doesNotProtect:
    "The cart contents themselves ARE sent, because judging them is the task. This is not a system that hides the purchase from the model, and it makes no claim about what the provider then does with what it legitimately receives, how long it retains it, or under whose jurisdiction. It also cannot protect a value it was never told about, and it adds nothing to transport security beyond the TLS the provider offers.",
  verify:
    "Build a checkout out of sentinel identity values, build the prompt, and search it for them.",
  tests: "lib/privacy/egress.test.ts, 20 tests",
};

export const ENCRYPTION_AT_REST: Control = {
  id: "at-rest",
  title: "Four columns are encrypted in the database",
  headline:
    "Someone who steals the database file learns that a purchase happened, for how much, and what Bouncer decided. They do not learn whose it was or what was in the basket.",
  how: "AES-256-GCM with a fresh 96-bit IV per value. Each ciphertext is additionally bound to the exact model, field and row id it belongs to through the AAD, so a ciphertext that is MOVED between rows fails to authenticate rather than decrypting cleanly into the wrong place. The encrypted columns are the principal's display name, every cart line name, the session's free text, and the session's structured fields, which carry the merchant account id.",
  protects:
    "An attacker who obtains the database file and not the key. That is the commonest case by a wide margin: backups, snapshots, object storage left open, a laptop, a support export, a repository someone committed the database into. In every one of those the file travels and the process environment does not.",
  doesNotProtect:
    "Anyone with the running process, the environment, or root on the host. The key is an environment variable on the same machine as the database, which is a development posture, not a production one: there is no KMS, no envelope encryption, no hardware-backed key and no rotation tooling. Amounts, categories, timestamps, outcomes, ids, mandate signatures and the entire audit chain are deliberately NOT encrypted, because they are needed for querying or verification. Encrypting a tamper-evidence log so it cannot be checked without a secret would make it a worse log.",
  verify:
    "Reseed, then search the raw SQLite file for the names and cart lines the console displays.",
  tests: "lib/privacy/crypto.test.ts and at-rest.test.ts, 28 tests",
};

export const SERVER_SIDE_REDACTION: Control = {
  id: "redaction",
  title: "Credential material is redacted before it is sent to the browser",
  headline:
    "The full signature, nonce, key reference and merchant account id are not in the page. Not hidden in it. Not in it.",
  how: "The server sends the truncated form. Revealing a value is a separate request to an endpoint that accepts four named fields and nothing else, so it is a deliberate act rather than something that already happened when the page loaded. A CSS blur or a masked span would have left the full value in the HTML, the React payload and view-source, hiding it from the one person already allowed to look and from nobody else.",
  protects:
    "Everything that reads the page rather than the screen: view-source, the devtools DOM inspector, scrapers, archived copies, and every screenshot or screen recording made during a demo or a support call.",
  doesNotProtect:
    "This deployment has no authentication of any kind, so anyone who can reach the console can also call the reveal endpoint. Redaction here is exposure reduction, not access control. A real deployment would put authorization in front of that route and log every reveal; this one does neither.",
  verify:
    "Load a request page, then search the page source for the value the reveal button returns.",
  tests: "lib/privacy/redact.test.ts, 20 tests",
};

export const REPOSITORY_HYGIENE: Control = {
  id: "repository",
  title: "Nothing secret is in the repository",
  headline:
    "The environment file, the keystore, the database and the generated client are all untracked, and a script checks rather than assumes.",
  how: "`npm run privacy:audit` reads what git TRACKS rather than what is on disk, because the question is not whether there is a secret in the folder but whether there is one in what is about to be pushed. It looks for tracked environment files, keystores, databases and PEM keys; for Razorpay, Anthropic, Groq, Google and OpenRouter credential shapes inside tracked text; for NEXT_PUBLIC_ variables, which are inlined into the browser bundle; and for the ignore rules the rest depends on. Findings name the file, the line and the kind, never the value.",
  protects:
    "The accident this project has already had once. Live-mode Razorpay keys reached a local .env by mistake; three independent layers refused them and the keys were rotated. The audit is the check that runs before a push rather than after an incident.",
  doesNotProtect:
    "Git history. A secret removed from the current tree is still in the objects, and this script does not look there. It also cannot tell that a value which looks safe is safe, and it says both of those things every time it runs rather than only in the documentation.",
  verify: "npm run privacy:audit",
  tests: "Exercised by planting a credential-shaped string and confirming it fails",
};

export const CONTROLS: Control[] = [
  MODEL_BOUNDARY,
  ENCRYPTION_AT_REST,
  SERVER_SIDE_REDACTION,
  REPOSITORY_HYGIENE,
];

/**
 * Designed and not built.
 *
 * These are on the page because a privacy section that lists only what exists
 * invites the reader to assume the rest, and because being told the gap by the
 * author is worth more than being found out by the reviewer.
 */
export const ABSENT: Array<{ what: string; why: string }> = [
  {
    what: "Authentication and authorization",
    why: "The console is open to anyone who can reach it, and so is the reveal endpoint. Every control here is exposure reduction; none of them is access control.",
  },
  {
    what: "Key management",
    why: "The encryption key is an environment variable beside the database. No KMS, no envelope encryption, no rotation tooling. Rotating it today makes every encrypted row unreadable.",
  },
  {
    what: "An access log",
    why: "Revealing a redacted value is deliberate but not recorded. A real deployment would log who revealed what and when, which is the control that makes redaction meaningful rather than merely tidy.",
  },
  {
    what: "Data retention and deletion",
    why: "Nothing expires and there is no erasure path. The audit chain is append-only by design, which makes deletion a genuine design problem rather than a missing function, and it is not solved here.",
  },
  {
    what: "Anything about the model provider's own handling",
    why: "The cart contents that are legitimately sent are subject to whatever the provider does with them. Bouncer controls what leaves; it controls nothing after that.",
  },
];

/**
 * The framing the whole page depends on being true.
 *
 * Saying "we protect your data" over a database of invented people would be
 * the exact overclaim this project spends its evidence page avoiding.
 */
export const WHAT_THIS_DEPLOYMENT_IS =
  "There is no real person's data here. The principals, agents, carts and merchant ids are fictional and seeded, the Razorpay integration is test mode, and no payment is ever captured. What follows is therefore not a claim about protecting anybody's information today. It is the privacy engineering this product would need before it could hold real information, built and tested now rather than described as future work.";
