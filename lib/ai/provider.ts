import type { DiffModelClient } from "./contract";
import { createAnthropicDiffClient } from "./anthropic";
import { DEFAULT_MODEL } from "./engine";
import { createOpenAICompatibleDiffClient } from "./openai-compatible";

/**
 * Which model backend the Intent-Cart Engine talks to.
 *
 * The engine itself does not know or care — it only ever sees a
 * DiffModelClient. This selector exists so the provider is an env var rather
 * than a code change, which is what lets the project run on a free tier now
 * and move back to Claude the moment a key exists.
 */

export type EngineProvider = "anthropic" | "openai-compatible";

/** Presets so a working setup is one env var, not four. */
const PRESETS: Record<string, { baseUrl: string; model: string }> = {
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    model: "openai/gpt-oss-120b",
  },
  xai: { baseUrl: "https://api.x.ai/v1", model: "grok-4.6" },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    model: "meta-llama/llama-3.3-70b-instruct",
  },
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    // Google retires model aliases for NEW keys without breaking existing
    // ones, so a preset that worked when written can 404 for a fresh account:
    // "models/gemini-2.5-flash is no longer available to new users". Override
    // with BOUNCER_ENGINE_MODEL rather than waiting on a code change.
    model: "gemini-3.6-flash",
  },
};

export type EngineConfig = {
  provider: EngineProvider;
  /** Preset name when one was used, for the record. */
  preset: string | null;
  model: string;
  baseUrl: string | null;
};

/** Blank and unset are the same thing here: an empty .env line is not a value. */
function envValue(name: string): string | undefined {
  const raw = process.env[name]?.trim();
  return raw ? raw : undefined;
}

function preset(): { name: string; baseUrl: string; model: string } | null {
  const name = envValue("BOUNCER_ENGINE_PRESET")?.toLowerCase();
  if (!name) return null;

  const found = PRESETS[name];
  if (!found) {
    throw new Error(
      `Unknown BOUNCER_ENGINE_PRESET "${name}". Known presets: ${Object.keys(PRESETS).join(", ")}.`,
    );
  }
  return { name, ...found };
}

function apiKey(): string | undefined {
  return envValue("BOUNCER_ENGINE_API_KEY") ?? envValue("ANTHROPIC_API_KEY");
}

/**
 * Resolves the configured backend without creating a client, so callers can
 * report what is configured before deciding whether to call anything.
 */
export function resolveEngineConfig(): EngineConfig | null {
  const chosen = preset();
  const explicitBaseUrl = envValue("BOUNCER_ENGINE_BASE_URL");
  const explicitModel = envValue("BOUNCER_ENGINE_MODEL");

  if (!apiKey()) return null;

  if (chosen || explicitBaseUrl) {
    const baseUrl = explicitBaseUrl ?? chosen?.baseUrl;
    if (!baseUrl) return null;
    return {
      provider: "openai-compatible",
      preset: chosen?.name ?? null,
      model: explicitModel ?? chosen?.model ?? "",
      baseUrl,
    };
  }

  return {
    provider: "anthropic",
    preset: null,
    model: explicitModel ?? DEFAULT_MODEL,
    baseUrl: null,
  };
}

/**
 * True when a usable model backend is configured.
 *
 * WHY THIS SWALLOWS THE ERROR
 *
 * resolveEngineConfig() throws on an unknown preset, which is correct for a
 * function whose job is to hand back a configuration: refusing to guess beats
 * inventing a backend. But this is a PREDICATE. A predicate that throws makes
 * every caller responsible for a failure mode they did not ask about, and not
 * one of them did: an unknown preset used to abort `db:seed` between deleting
 * the old rows and writing the new ones, leaving an empty database and a stack
 * trace that named the preset rather than the typo that produced it.
 *
 * So the honest answer to "is a usable backend configured" when the preset is
 * gibberish is no. That is also the safe answer, because no backend means the
 * pipeline escalates to a human and never allows. The misconfiguration is not
 * hidden: assertConfiguration() reports it by name at every entry point,
 * before any of this runs.
 */
export function isEngineConfigured(): boolean {
  try {
    return resolveEngineConfig() !== null;
  } catch {
    return false;
  }
}

export function describeEngine(): string {
  let config: EngineConfig | null;
  try {
    config = resolveEngineConfig();
  } catch (error) {
    // Named, not swallowed. A console line reading "misconfigured" with the
    // reason attached is worth more than a crash inside a summary printer.
    return `misconfigured (${error instanceof Error ? error.message : String(error)})`;
  }
  if (!config) return "not configured";
  return config.provider === "anthropic"
    ? `anthropic · ${config.model}`
    : `${config.preset ?? "openai-compatible"} · ${config.model}`;
}

export function createDiffClient(): {
  client: DiffModelClient;
  config: EngineConfig;
} {
  const config = resolveEngineConfig();
  if (!config) {
    throw new Error(
      "No model backend configured. Set ANTHROPIC_API_KEY, or BOUNCER_ENGINE_PRESET + BOUNCER_ENGINE_API_KEY.",
    );
  }

  if (config.provider === "anthropic") {
    return { client: createAnthropicDiffClient({ apiKey: apiKey() }), config };
  }

  if (!config.model) {
    throw new Error(
      "BOUNCER_ENGINE_MODEL is required when BOUNCER_ENGINE_BASE_URL is set without a preset.",
    );
  }

  return {
    client: createOpenAICompatibleDiffClient({
      baseUrl: config.baseUrl!,
      apiKey: apiKey()!,
    }),
    config,
  };
}
