import type { DiffModelClient } from "./contract";
import { createAnthropicDiffClient } from "./anthropic";
import { DEFAULT_MODEL } from "./engine";
import { createOpenAICompatibleDiffClient } from "./openai-compatible";
import { setting, settingName, type Setting } from "@/lib/env-vars";

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
    // with STEALTH_ENGINE_MODEL rather than waiting on a code change.
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

/**
 * Reads one of the project's own settings, new name first, old name second.
 * See lib/env-vars.ts for why both spellings are accepted.
 */
function envValue(name: Setting): string | undefined {
  return setting(name);
}

/** ANTHROPIC_API_KEY is not ours to rename: it is the vendor's own name. */
function anthropicKey(): string | undefined {
  const raw = process.env.ANTHROPIC_API_KEY?.trim();
  return raw ? raw : undefined;
}

function preset(): { name: string; baseUrl: string; model: string } | null {
  const name = envValue("ENGINE_PRESET")?.toLowerCase();
  if (!name) return null;

  const found = PRESETS[name];
  if (!found) {
    throw new Error(
      `Unknown ${settingName("ENGINE_PRESET")} "${name}". Known presets: ${Object.keys(PRESETS).join(", ")}.`,
    );
  }
  return { name, ...found };
}

function apiKey(): string | undefined {
  return envValue("ENGINE_API_KEY") ?? anthropicKey();
}

/**
 * Resolves the configured backend without creating a client, so callers can
 * report what is configured before deciding whether to call anything.
 */
export function resolveEngineConfig(): EngineConfig | null {
  const chosen = preset();
  const explicitBaseUrl = envValue("ENGINE_BASE_URL");
  const explicitModel = envValue("ENGINE_MODEL");

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
      `No model backend configured. Set ANTHROPIC_API_KEY, or ${settingName("ENGINE_PRESET")} + ${settingName("ENGINE_API_KEY")}.`,
    );
  }

  if (config.provider === "anthropic") {
    return { client: createAnthropicDiffClient({ apiKey: apiKey() }), config };
  }

  if (!config.model) {
    throw new Error(
      `${settingName("ENGINE_MODEL")} is required when ${settingName("ENGINE_BASE_URL")} is set without a preset.`,
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
