import { resolveEngineConfig } from "@/lib/ai";

import { createAnthropicAgentClient } from "./anthropic";
import { setting, settingName, type Setting } from "@/lib/env-vars";
import type { AgentModelClient } from "./contract";
import { createOpenAICompatibleAgentClient } from "./openai-compatible";

/**
 * The demo agent's backend, selected from the same env vars as the engine.
 *
 * The spec calls for Claude Haiku 4.5, which is the default whenever Anthropic
 * is configured. When the project is running on an OpenAI-compatible backend
 * instead, the agent uses that — a demo agent that cannot run at all is worth
 * less than one running on a documented substitute.
 */

export const DEFAULT_AGENT_MODEL = "claude-haiku-4-5-20251001";

function envValue(name: Setting): string | undefined {
  return setting(name);
}

export function resolveAgentConfig():
  | { provider: "anthropic" | "openai-compatible"; model: string; baseUrl: string | null }
  | null {
  const engine = resolveEngineConfig();
  if (!engine) return null;

  const override = envValue("AGENT_MODEL");

  if (engine.provider === "anthropic") {
    return {
      provider: "anthropic",
      model: override ?? DEFAULT_AGENT_MODEL,
      baseUrl: null,
    };
  }

  return {
    provider: "openai-compatible",
    model: override ?? engine.model,
    baseUrl: engine.baseUrl,
  };
}

/**
 * Same reasoning as isEngineConfigured in lib/ai/provider: a predicate must
 * answer, not throw. This one is the first line of the POST handler behind the
 * live-agent button, outside any try/catch, so an unknown preset used to turn
 * the demo's most important control into an unhandled 500 instead of the
 * "no model backend is configured" response the route was written to give.
 */
export function isAgentConfigured(): boolean {
  try {
    return resolveAgentConfig() !== null;
  } catch {
    return false;
  }
}

export function describeAgent(): string {
  let config: ReturnType<typeof resolveAgentConfig>;
  try {
    config = resolveAgentConfig();
  } catch (error) {
    return `misconfigured (${error instanceof Error ? error.message : String(error)})`;
  }
  return config ? `${config.provider} · ${config.model}` : "not configured";
}

export function createAgentClient(): {
  client: AgentModelClient;
  model: string;
} {
  const config = resolveAgentConfig();
  if (!config) {
    throw new Error(
      `No model backend configured for the demo agent. Set ANTHROPIC_API_KEY, or ${settingName("ENGINE_PRESET")} + ${settingName("ENGINE_API_KEY")}.`,
    );
  }

  const apiKey =
    envValue("ENGINE_API_KEY") ?? process.env.ANTHROPIC_API_KEY?.trim() ?? "";

  if (config.provider === "anthropic") {
    return { client: createAnthropicAgentClient({ apiKey }), model: config.model };
  }

  return {
    client: createOpenAICompatibleAgentClient({
      baseUrl: config.baseUrl!,
      apiKey,
    }),
    model: config.model,
  };
}
