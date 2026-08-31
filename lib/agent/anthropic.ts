import Anthropic from "@anthropic-ai/sdk";

import {
  AgentTransportError,
  type AgentModelClient,
  type AgentModelReply,
  type AgentToolCall,
  type AgentTurn,
} from "./contract";

/** Agent adapter for the Anthropic Messages API. */

function toMessages(turns: AgentTurn[]): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = [];

  for (const turn of turns) {
    if (turn.role === "user") {
      messages.push({ role: "user", content: turn.content });
      continue;
    }

    if (turn.role === "assistant") {
      const blocks: Anthropic.ContentBlockParam[] = [];
      if (turn.content) blocks.push({ type: "text", text: turn.content });
      for (const call of turn.toolCalls) {
        blocks.push({
          type: "tool_use",
          id: call.id,
          name: call.name,
          input: call.input,
        });
      }
      messages.push({ role: "assistant", content: blocks });
      continue;
    }

    // Tool results are user-role blocks in the Messages API. Consecutive
    // results are merged into the preceding user turn.
    const block: Anthropic.ContentBlockParam = {
      type: "tool_result",
      tool_use_id: turn.toolCallId,
      content: turn.content,
    };
    const last = messages[messages.length - 1];
    if (last && last.role === "user" && Array.isArray(last.content)) {
      last.content.push(block);
    } else {
      messages.push({ role: "user", content: [block] });
    }
  }

  return messages;
}

export function createAnthropicAgentClient(options?: {
  apiKey?: string;
  timeoutMs?: number;
}): AgentModelClient {
  const apiKey = options?.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");

  const client = new Anthropic({
    apiKey,
    timeout: options?.timeoutMs ?? 45_000,
    maxRetries: 0,
  });

  return async (request): Promise<AgentModelReply> => {
    try {
      const response = await client.messages.create({
        model: request.model,
        max_tokens: request.maxTokens,
        temperature: request.temperature,
        system: request.system,
        tools: request.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema as Anthropic.Tool["input_schema"],
        })),
        messages: toMessages(request.turns),
      });

      const toolCalls: AgentToolCall[] = response.content
        .filter((block) => block.type === "tool_use")
        .map((block) => ({
          id: block.id,
          name: block.name,
          input: (block.input ?? {}) as Record<string, unknown>,
        }));

      const text = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");

      return {
        content: text.length > 0 ? text : null,
        toolCalls,
        stopReason: response.stop_reason,
      };
    } catch (error) {
      if (error instanceof Anthropic.APIConnectionTimeoutError) {
        throw new AgentTransportError("timeout", error.message);
      }
      throw new AgentTransportError(
        "api_error",
        error instanceof Error ? error.message : String(error),
      );
    }
  };
}
