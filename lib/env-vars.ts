/**
 * The project's own environment variables, in one place.
 *
 * The product was renamed from Bouncer to STEALTH. Renaming ten variables in
 * lockstep would have been a silent breaking change for anyone with an
 * existing .env: the app would boot, find nothing configured, and degrade
 * exactly as it does when a key is genuinely missing. That failure is
 * indistinguishable from the real thing, which is the worst kind.
 *
 * So every setting is read under its new STEALTH_ name first and its old
 * BOUNCER_ name second. An existing .env keeps working untouched, a new one
 * uses the new names, and a file holding both is resolved in favour of the new
 * one rather than by accident of declaration order.
 *
 * Kept free of filesystem and Node built-ins so the Next server bundle can
 * import it.
 */

export const PREFIX = "STEALTH_";

/** Retained for compatibility with .env files written before the rename. */
export const LEGACY_PREFIX = "BOUNCER_";

/** Every prefixed variable the project reads, written without its prefix. */
export const SETTINGS = [
  "ENGINE_PRESET",
  "ENGINE_API_KEY",
  "ENGINE_BASE_URL",
  "ENGINE_MODEL",
  "ENGINE_MAX_TOKENS",
  "ENCRYPTION_KEY",
  "AGENT_MODEL",
  "AGENT_RUN_GAP_MS",
  "EVAL_GAP_MS",
  "EVAL_FAILURE_LIMIT",
] as const;

export type Setting = (typeof SETTINGS)[number];

export type EnvLike = Record<string, string | undefined>;

/** The name to print in a message, and to write in a .env file. */
export function settingName(setting: Setting): string {
  return `${PREFIX}${setting}`;
}

/** The pre-rename name, still accepted on read. */
export function legacyName(setting: Setting): string {
  return `${LEGACY_PREFIX}${setting}`;
}

/** Both spellings, new first. Used by the configuration checker. */
export function bothNames(setting: Setting): [string, string] {
  return [settingName(setting), legacyName(setting)];
}

/** Blank and unset are the same thing: an empty .env line is not a value. */
function trimmed(value: string | undefined): string | undefined {
  const raw = value?.trim();
  return raw ? raw : undefined;
}

/**
 * Reads one setting, new name first.
 *
 * Returns undefined for a variable that is unset or blank under both names, so
 * callers can use `??` without treating an empty string as configuration.
 */
export function setting(
  name: Setting,
  env: EnvLike = process.env,
): string | undefined {
  return trimmed(env[settingName(name)]) ?? trimmed(env[legacyName(name)]);
}

/**
 * Which spelling actually supplied the value, or null if neither did.
 * The configuration checker uses this so its messages name the variable the
 * reader will find in their own file.
 */
export function settingSource(
  name: Setting,
  env: EnvLike = process.env,
): string | null {
  if (trimmed(env[settingName(name)]) !== undefined) return settingName(name);
  if (trimmed(env[legacyName(name)]) !== undefined) return legacyName(name);
  return null;
}
