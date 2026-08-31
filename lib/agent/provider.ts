import { resolveEngineConfig } from "@/lib/ai";

import { createAnthropicAgentClient } from "./anthropic";
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

function envValue(name: string): string | undefined {
  const raw = process.env[name]?.trim();
  return raw ? raw : undefined;
}

export function resolveAgentConfig():
  | { provider: "anthropic" | "openai-compatible"; model: string; baseUrl: string | null }
  | null {
  const engine = resolveEngineConfig();
  if (!engine) return null;

  const override = envValue("BOUNCER_AGENT_MODEL");

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

export function isAgentConfigured(): boolean {
  return resolveAgentConfig() !== null;
}

export function describeAgent(): string {
  const config = resolveAgentConfig();
  return config ? `${config.provider} · ${config.model}` : "not configured";
}

export function createAgentClient(): {
  client: AgentModelClient;
  model: string;
} {
  const config = resolveAgentConfig();
  if (!config) {
    throw new Error(
      "No model backend configured for the demo agent. Set ANTHROPIC_API_KEY, or BOUNCER_ENGINE_PRESET + BOUNCER_ENGINE_API_KEY.",
    );
  }

  const apiKey =
    envValue("BOUNCER_ENGINE_API_KEY") ?? envValue("ANTHROPIC_API_KEY") ?? "";

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
