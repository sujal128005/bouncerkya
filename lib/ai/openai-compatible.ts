import {
  EngineTransportError,
  type DiffModelClient,
  type ModelInvocation,
  type ModelToolCall,
} from "./contract";

/**
 * Adapter for any OpenAI-compatible chat-completions endpoint: Groq, xAI,
 * OpenRouter, Together, Gemini's compatibility endpoint, a local llama.cpp
 * server. One file covers all of them because they speak the same wire format.
 *
 * Plain fetch rather than the OpenAI SDK — the request is a single POST and
 * the port above it is already narrow, so a dependency would buy nothing.
 */

export const OPENAI_COMPATIBLE_TIMEOUT_MS = 45_000;

type ChatCompletionResponse = {
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      tool_calls?: Array<{
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

function isAbort(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

/**
 * Tool arguments arrive as a JSON *string*. If it will not parse we hand the
 * raw string through as the tool input: the engine's Zod validation then fails
 * with a real message and spends its one corrective retry, which is a better
 * outcome than silently dropping the call.
 */
function parseToolArguments(raw: string | undefined): unknown {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

export function createOpenAICompatibleDiffClient(options: {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}): DiffModelClient {
  const endpoint = `${options.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const timeoutMs = options.timeoutMs ?? OPENAI_COMPATIBLE_TIMEOUT_MS;

  return async (request): Promise<ModelInvocation> => {
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
          messages: [
            { role: "system", content: request.system },
            ...request.messages.map((message) => ({
              role: message.role,
              content: message.content,
            })),
          ],
          tools: [
            {
              type: "function",
              function: {
                name: request.tool.name,
                description: request.tool.description,
                parameters: request.tool.inputSchema,
              },
            },
          ],
          tool_choice: {
            type: "function",
            function: { name: request.tool.name },
          },
        }),
      });
    } catch (error) {
      if (isAbort(error)) {
        throw new EngineTransportError(
          "timeout",
          `no response within ${timeoutMs}ms`,
        );
      }
      throw new EngineTransportError(
        "api_error",
        error instanceof Error ? error.message : String(error),
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new EngineTransportError(
        "api_error",
        `${response.status} ${response.statusText}${body ? `: ${body.slice(0, 400)}` : ""}`,
      );
    }

    let payload: ChatCompletionResponse;
    try {
      payload = (await response.json()) as ChatCompletionResponse;
    } catch (error) {
      throw new EngineTransportError(
        "api_error",
        `response was not JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const choice = payload.choices?.[0];
    const toolCalls: ModelToolCall[] = (choice?.message?.tool_calls ?? [])
      .filter((call) => typeof call.function?.name === "string")
      .map((call) => ({
        name: call.function!.name!,
        input: parseToolArguments(call.function!.arguments),
      }));

    return {
      toolCalls,
      stopReason: choice?.finish_reason ?? null,
      usage: {
        inputTokens: payload.usage?.prompt_tokens ?? 0,
        outputTokens: payload.usage?.completion_tokens ?? 0,
      },
    };
  };
}
