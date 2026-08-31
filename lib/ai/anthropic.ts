import Anthropic from "@anthropic-ai/sdk";

import {
  EngineTransportError,
  type DiffModelClient,
  type ModelInvocation,
} from "./contract";

/**
 * The only place the Anthropic SDK is touched. Everything above this file
 * talks to the DiffModelClient port, which is why the engine's branches are
 * unit-testable without a network or a key.
 */

export const ANTHROPIC_TIMEOUT_MS = 30_000;

export function isAnthropicConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function createAnthropicDiffClient(options?: {
  apiKey?: string;
  timeoutMs?: number;
}): DiffModelClient {
  const apiKey = options?.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set, so the Intent-Cart Engine cannot be created.",
    );
  }

  const client = new Anthropic({
    apiKey,
    timeout: options?.timeoutMs ?? ANTHROPIC_TIMEOUT_MS,
    maxRetries: 0, // The engine owns retry policy.
  });

  return async (request): Promise<ModelInvocation> => {
    try {
      const response = await client.messages.create({
        model: request.model,
        max_tokens: request.maxTokens,
        temperature: request.temperature,
        system: request.system,
        tools: [
          {
            name: request.tool.name,
            description: request.tool.description,
            // The SDK types this as its own JSON-schema shape; ours is
            // generated from Zod and structurally compatible.
            input_schema: request.tool
              .inputSchema as Anthropic.Tool["input_schema"],
          },
        ],
        tool_choice: { type: "tool", name: request.tool.name },
        messages: request.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      });

      return {
        toolCalls: response.content
          .filter((block) => block.type === "tool_use")
          .map((block) => ({ name: block.name, input: block.input })),
        stopReason: response.stop_reason,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      };
    } catch (error) {
      if (
        error instanceof Anthropic.APIConnectionTimeoutError ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        throw new EngineTransportError("timeout", error.message);
      }
      throw new EngineTransportError(
        "api_error",
        error instanceof Error ? error.message : String(error),
      );
    }
  };
}
