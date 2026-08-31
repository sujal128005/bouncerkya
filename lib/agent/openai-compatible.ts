import {
  AgentTransportError,
  type AgentModelClient,
  type AgentModelReply,
  type AgentToolCall,
  type AgentTurn,
} from "./contract";

/** Agent adapter for any OpenAI-compatible chat-completions endpoint. */

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
};

function toMessages(system: string, turns: AgentTurn[]): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: "system", content: system }];

  for (const turn of turns) {
    if (turn.role === "user") {
      messages.push({ role: "user", content: turn.content });
    } else if (turn.role === "assistant") {
      messages.push({
        role: "assistant",
        content: turn.content,
        tool_calls:
          turn.toolCalls.length > 0
            ? turn.toolCalls.map((call) => ({
                id: call.id,
                type: "function" as const,
                function: {
                  name: call.name,
                  arguments: JSON.stringify(call.input),
                },
              }))
            : undefined,
      });
    } else {
      messages.push({
        role: "tool",
        tool_call_id: turn.toolCallId,
        content: turn.content,
      });
    }
  }

  return messages;
}

function parseArguments(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function createOpenAICompatibleAgentClient(options: {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}): AgentModelClient {
  const endpoint = `${options.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const timeoutMs = options.timeoutMs ?? 45_000;

  return async (request): Promise<AgentModelReply> => {
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${options.apiKey}`,
        },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          model: request.model,
          temperature: request.temperature,
          max_tokens: request.maxTokens,
          messages: toMessages(request.system, request.turns),
          tools: request.tools.map((tool) => ({
            type: "function",
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.inputSchema,
            },
          })),
          tool_choice: "auto",
        }),
      });
    } catch (error) {
      const aborted =
        error instanceof Error &&
        (error.name === "AbortError" || error.name === "TimeoutError");
      throw new AgentTransportError(
        aborted ? "timeout" : "api_error",
        error instanceof Error ? error.message : String(error),
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new AgentTransportError(
        "api_error",
        `${response.status} ${response.statusText}${body ? `: ${body.slice(0, 300)}` : ""}`,
      );
    }

    const payload = (await response.json()) as {
      choices?: Array<{
        finish_reason?: string | null;
        message?: {
          content?: string | null;
          tool_calls?: Array<{
            id?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
      }>;
    };

    const choice = payload.choices?.[0];
    const toolCalls: AgentToolCall[] = (choice?.message?.tool_calls ?? [])
      .filter((call) => typeof call.function?.name === "string")
      .map((call, index) => ({
        id: call.id ?? `call_${index}`,
        name: call.function!.name!,
        input: parseArguments(call.function!.arguments),
      }));

    return {
      content: choice?.message?.content ?? null,
      toolCalls,
      stopReason: choice?.finish_reason ?? null,
    };
  };
}
