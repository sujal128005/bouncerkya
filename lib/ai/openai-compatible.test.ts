import { afterEach, describe, expect, it, vi } from "vitest";

import { EngineTransportError, type DiffModelRequest } from "./contract";
import { createOpenAICompatibleDiffClient } from "./openai-compatible";
import { resolveEngineConfig } from "./provider";

const REQUEST: DiffModelRequest = {
  model: "openai/gpt-oss-120b",
  system: "system prompt",
  messages: [{ role: "user", content: "user content" }],
  maxTokens: 2000,
  temperature: 0.1,
  tool: {
    name: "emit_authorization_diff",
    description: "emit it",
    inputSchema: { type: "object" },
  },
};

function jsonResponse(body: unknown, init?: { status?: number }): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

const client = () =>
  createOpenAICompatibleDiffClient({
    baseUrl: "https://api.example.com/v1/",
    apiKey: "test-key",
  });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("openai-compatible adapter", () => {
  it("posts a forced tool call and parses stringified arguments", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              tool_calls: [
                {
                  function: {
                    name: "emit_authorization_diff",
                    arguments: '{"confidence":0.42}',
                  },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 120, completion_tokens: 34 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await client()(REQUEST);

    expect(result.toolCalls).toEqual([
      { name: "emit_authorization_diff", input: { confidence: 0.42 } },
    ]);
    expect(result.stopReason).toBe("tool_calls");
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 34 });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.example.com/v1/chat/completions");

    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.tool_choice).toEqual({
      type: "function",
      function: { name: "emit_authorization_diff" },
    });
    expect(body.messages).toEqual([
      { role: "system", content: "system prompt" },
      { role: "user", content: "user content" },
    ]);
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer test-key",
    );
  });

  it("passes unparseable tool arguments through so validation reports them", async () => {
    vi.stubGlobal("fetch", async () =>
      jsonResponse({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              tool_calls: [
                { function: { name: "emit_authorization_diff", arguments: "{oops" } },
              ],
            },
          },
        ],
      }),
    );

    const result = await client()(REQUEST);
    expect(result.toolCalls[0].input).toBe("{oops");
  });

  it("reports an empty tool_calls list rather than inventing one", async () => {
    vi.stubGlobal("fetch", async () =>
      jsonResponse({ choices: [{ finish_reason: "stop", message: {} }] }),
    );

    const result = await client()(REQUEST);
    expect(result.toolCalls).toEqual([]);
    expect(result.stopReason).toBe("stop");
  });

  it("maps a non-2xx response to api_error with the status and body", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response("rate limit reached", { status: 429, statusText: "Too Many Requests" }),
    );

    await expect(client()(REQUEST)).rejects.toMatchObject({
      kind: "api_error",
      message: expect.stringContaining("429"),
    });
  });

  it("maps an aborted request to timeout", async () => {
    vi.stubGlobal("fetch", async () => {
      const error = new Error("The operation was aborted");
      error.name = "TimeoutError";
      throw error;
    });

    const error = await client()(REQUEST).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(EngineTransportError);
    expect((error as EngineTransportError).kind).toBe("timeout");
  });

  it("maps a non-JSON body to api_error", async () => {
    vi.stubGlobal("fetch", async () => new Response("<html>502</html>", { status: 200 }));

    await expect(client()(REQUEST)).rejects.toMatchObject({ kind: "api_error" });
  });
});

describe("provider selection", () => {
  it("is unconfigured when no key is present", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("BOUNCER_ENGINE_API_KEY", "");
    expect(resolveEngineConfig()).toBeNull();
  });

  it("defaults to Anthropic when only ANTHROPIC_API_KEY is set", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    vi.stubEnv("BOUNCER_ENGINE_API_KEY", "");
    vi.stubEnv("BOUNCER_ENGINE_PRESET", "");
    vi.stubEnv("BOUNCER_ENGINE_BASE_URL", "");
    vi.stubEnv("BOUNCER_ENGINE_MODEL", "");

    expect(resolveEngineConfig()).toEqual({
      provider: "anthropic",
      preset: null,
      model: "claude-sonnet-5",
      baseUrl: null,
    });
  });

  it("resolves the groq preset to its base url and default model", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("BOUNCER_ENGINE_API_KEY", "gsk-test");
    vi.stubEnv("BOUNCER_ENGINE_PRESET", "groq");
    vi.stubEnv("BOUNCER_ENGINE_MODEL", "");

    expect(resolveEngineConfig()).toEqual({
      provider: "openai-compatible",
      preset: "groq",
      model: "openai/gpt-oss-120b",
      baseUrl: "https://api.groq.com/openai/v1",
    });
  });

  it("lets BOUNCER_ENGINE_MODEL override a preset's default", () => {
    vi.stubEnv("BOUNCER_ENGINE_API_KEY", "gsk-test");
    vi.stubEnv("BOUNCER_ENGINE_PRESET", "groq");
    vi.stubEnv("BOUNCER_ENGINE_MODEL", "llama-3.3-70b-versatile");

    expect(resolveEngineConfig()?.model).toBe("llama-3.3-70b-versatile");
  });

  it("rejects an unknown preset by name", () => {
    vi.stubEnv("BOUNCER_ENGINE_API_KEY", "test");
    vi.stubEnv("BOUNCER_ENGINE_PRESET", "notaprovider");

    expect(() => resolveEngineConfig()).toThrow(/Unknown BOUNCER_ENGINE_PRESET/);
  });
});
