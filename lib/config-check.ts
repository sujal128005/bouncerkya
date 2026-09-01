/**
 * Configuration validation.
 *
 * The point is NOT to demand every environment variable. Most of Bouncer
 * degrades deliberately: with no model backend the console still renders and
 * says the engine was not called; with no Razorpay keys an ALLOW records the
 * decision and reports that no order could be created. Refusing to boot for a
 * missing optional key would turn a working demo into a dead one.
 *
 * What must fail fast is a variable that is present but WRONG, because that is
 * the case where the system looks configured and behaves incorrectly:
 *
 *   - a Razorpay key that is not a test key, which would mean live money
 *   - a model preset that does not exist, which fails at the first call
 *   - a database URL that is empty
 *   - two variables written on one line of .env, which silently swallows the
 *     second one and gives the first a value nobody intended
 *
 * Values are never printed. A message says which variable is wrong and what
 * shape it should have, never what it currently contains.
 */

export type ConfigProblem = {
  variable: string;
  severity: "fatal" | "warning";
  detail: string;
};

const KNOWN_PRESETS = ["groq", "xai", "openrouter", "gemini"];

/** AES-256. A key of any other length is a misconfiguration, not a weaker key. */
const ENCRYPTION_KEY_BYTES = 32;

/** Every variable this project reads, so one loop can sanity-check them all. */
const OWN_VARIABLES = [
  "DATABASE_URL",
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "BOUNCER_ENGINE_PRESET",
  "BOUNCER_ENGINE_API_KEY",
  "BOUNCER_ENGINE_BASE_URL",
  "BOUNCER_ENGINE_MODEL",
  "BOUNCER_ENCRYPTION_KEY",
  "ANTHROPIC_API_KEY",
];

/**
 * Catches the single easiest mistake to make in a .env file: putting two
 * assignments on one line.
 *
 *   BOUNCER_ENGINE_PRESET="gemini" BOUNCER_ENGINE_API_KEY="AQ..."
 *
 * dotenv does not complain. It gives the first variable a value containing the
 * second variable's name, and never defines the second at all. Every downstream
 * error then describes a symptom ("unknown preset") rather than the cause, and
 * the person editing the file has no way to work back from one to the other.
 *
 * This looks for another of our own variable names followed by `=` inside a
 * value, which cannot happen in a legitimate key, URL or base64 blob.
 */
function mergedLine(value: string): string | null {
  for (const name of OWN_VARIABLES) {
    if (new RegExp(`\\b${name}\\s*=`).test(value)) return name;
  }
  return null;
}

/** Pure so it is testable; reads a snapshot rather than `process.env` directly. */
export function checkConfiguration(
  env: Record<string, string | undefined>,
): ConfigProblem[] {
  const problems: ConfigProblem[] = [];
  const value = (name: string): string | undefined => {
    const raw = env[name];
    return raw && raw.trim().length > 0 ? raw.trim() : undefined;
  };

  /*
   * Run this before anything else. A merged line makes some OTHER check fail
   * with a message about the wrong variable, and chasing that message is how
   * an evening disappears.
   */
  for (const name of OWN_VARIABLES) {
    const raw = value(name);
    const swallowed = raw ? mergedLine(raw) : null;
    if (swallowed) {
      problems.push({
        variable: name,
        severity: "fatal",
        detail: `Its value contains "${swallowed}=", so two variables are on one line in .env. Each variable needs its own line, and ${swallowed} is currently not set at all.`,
      });
    }
  }

  if (!value("DATABASE_URL")) {
    problems.push({
      variable: "DATABASE_URL",
      severity: "fatal",
      detail:
        "Not set. Prisma cannot open the database. Copy .env.example to .env.",
    });
  }

  // The single most dangerous misconfiguration in the whole product: a live
  // key would move real money. The client refuses it at call time too; this
  // surfaces it at boot instead of at checkout.
  const keyId = value("RAZORPAY_KEY_ID");
  if (keyId && !keyId.startsWith("rzp_test_")) {
    problems.push({
      variable: "RAZORPAY_KEY_ID",
      severity: "fatal",
      detail:
        "Must be a TEST-mode key beginning with rzp_test_. Bouncer refuses live-mode keys, because an ALLOW creates a real order.",
    });
  }
  if (keyId && !value("RAZORPAY_KEY_SECRET")) {
    problems.push({
      variable: "RAZORPAY_KEY_SECRET",
      severity: "fatal",
      detail: "RAZORPAY_KEY_ID is set but its secret is missing.",
    });
  }

  const preset = value("BOUNCER_ENGINE_PRESET");
  if (preset && !KNOWN_PRESETS.includes(preset)) {
    problems.push({
      variable: "BOUNCER_ENGINE_PRESET",
      severity: "fatal",
      detail: `Unknown preset. Expected one of: ${KNOWN_PRESETS.join(", ")}.`,
    });
  }
  if (preset && !value("BOUNCER_ENGINE_API_KEY")) {
    problems.push({
      variable: "BOUNCER_ENGINE_API_KEY",
      severity: "fatal",
      detail:
        "A preset is configured but no API key is set, so every model call would fail at request time.",
    });
  }

  /*
   * Field encryption is the one capability that may NOT degrade.
   *
   * Everything else here fails soft on purpose: no model backend means
   * escalate, no Razorpay key means record the decision and say no order was
   * created. Encryption cannot work that way. A deployment that silently fell
   * back to plaintext would still render, still decide correctly, and still
   * describe itself as encrypted on /privacy, which is the exact shape of a
   * privacy claim that is not true. So a missing or malformed key is fatal.
   */
  const encryptionKey = value("BOUNCER_ENCRYPTION_KEY");
  if (!encryptionKey) {
    problems.push({
      variable: "BOUNCER_ENCRYPTION_KEY",
      severity: "fatal",
      detail:
        "Not set. Four columns are stored encrypted and cannot be read or written without it. Generate one with `npm run privacy:keygen` and add it to .env. Bouncer will not fall back to plaintext.",
    });
  } else {
    const decoded = Buffer.from(encryptionKey, "base64");
    if (decoded.length !== ENCRYPTION_KEY_BYTES) {
      problems.push({
        variable: "BOUNCER_ENCRYPTION_KEY",
        severity: "fatal",
        // The length is safe to report. The value never is.
        detail: `Decodes to ${decoded.length} bytes; AES-256 needs ${ENCRYPTION_KEY_BYTES}. Generate a correct one with \`npm run privacy:keygen\`.`,
      });
    }
  }

  // Degradations worth announcing, but never worth refusing to boot for.
  if (!value("ANTHROPIC_API_KEY") && !preset && !value("BOUNCER_ENGINE_BASE_URL")) {
    problems.push({
      variable: "BOUNCER_ENGINE_API_KEY",
      severity: "warning",
      detail:
        "No model backend. The Intent-Cart Engine will not be called; requests that reach it escalate to a human instead of being allowed.",
    });
  }
  if (!keyId) {
    problems.push({
      variable: "RAZORPAY_KEY_ID",
      severity: "warning",
      detail:
        "Not set. An ALLOW will record its decision and report that no order could be created. It will not pretend one was.",
    });
  }

  return problems;
}

export function formatConfigProblems(problems: ConfigProblem[]): string {
  return problems
    .map((p) => `  [${p.severity}] ${p.variable}: ${p.detail}`)
    .join("\n");
}

/**
 * Called once at server start. Throws on a fatal problem so the process dies
 * loudly at boot rather than misbehaving quietly at checkout.
 */
export function assertConfiguration(
  env: Record<string, string | undefined> = process.env,
): void {
  const problems = checkConfiguration(env);
  const fatal = problems.filter((p) => p.severity === "fatal");
  const warnings = problems.filter((p) => p.severity === "warning");

  if (warnings.length > 0) {
    console.warn(
      `[bouncer] configuration notes:\n${formatConfigProblems(warnings)}`,
    );
  }

  if (fatal.length > 0) {
    throw new Error(
      `Bouncer cannot start. Configuration is present but invalid:\n${formatConfigProblems(fatal)}`,
    );
  }
}
