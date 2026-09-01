import type { ExtractedEvidence } from "@/lib/extraction";
import { setting } from "@/lib/env-vars";
import { AuthorizationDiff } from "@/schemas";

import {
  authorizationDiffToolSchema,
  DIFF_TOOL_DESCRIPTION,
  DIFF_TOOL_NAME,
  EngineTransportError,
  type DiffModelClient,
  type DiffModelRequest,
  type ModelMessage,
} from "./contract";
import {
  buildUserMessage,
  CORRECTIVE_NOTE_PREFIX,
  SYSTEM_PROMPT,
} from "./prompt";

/**
 * Intent-Cart Consistency Engine.
 *
 * Given evidence about a mandate that has ALREADY passed the Mandate Verifier,
 * produce an Authorization Diff. This engine returns evidence; it has no
 * authority to allow, decline or escalate. A typed failure is a real outcome
 * here — what a failure *means* is the Policy Engine's call (Prompt 4), not
 * ours, and we never invent a diff to paper over one.
 */

export const DEFAULT_MODEL = "claude-sonnet-5";

/**
 * Providers that meter tokens-per-minute count `prompt + max_tokens` against
 * the budget, so an over-generous ceiling costs throughput on a free tier.
 * 1500 comfortably fits the largest diff observed (4 clauses, ~800 tokens).
 */
export const DEFAULT_MAX_TOKENS = Number(
  setting("ENGINE_MAX_TOKENS") ?? 1500,
);
export const DEFAULT_TEMPERATURE = 0.1;

export type EngineFailureReason = "timeout" | "malformed_output" | "api_error";

export type EngineMeta = {
  model: string;
  /** 1 when the first call validated, 2 when the corrective retry was used. */
  attempts: number;
  latencyMs: number;
  usage?: { inputTokens: number; outputTokens: number };
};

export type EngineResult =
  | { success: true; diff: AuthorizationDiff; meta: EngineMeta }
  | {
      success: false;
      failureReason: EngineFailureReason;
      details: string;
      meta: EngineMeta;
    };

export type EngineOptions = {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /** Injected for deterministic latency in tests. */
  now?: () => number;
};

function issuesFor(error: unknown): string {
  if (error && typeof error === "object" && "issues" in error) {
    const { issues } = error as { issues: Array<{ path: PropertyKey[]; message: string }> };
    return issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
  }
  return String(error);
}

export async function computeAuthorizationDiff(
  evidence: ExtractedEvidence,
  client: DiffModelClient,
  options: EngineOptions = {},
): Promise<EngineResult> {
  const model = options.model ?? DEFAULT_MODEL;
  const now = options.now ?? (() => Date.now());
  const startedAt = now();

  const messages: ModelMessage[] = [
    { role: "user", content: buildUserMessage(evidence) },
  ];

  const baseRequest: Omit<DiffModelRequest, "messages"> = {
    model,
    system: SYSTEM_PROMPT,
    maxTokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: options.temperature ?? DEFAULT_TEMPERATURE,
    tool: {
      name: DIFF_TOOL_NAME,
      description: DIFF_TOOL_DESCRIPTION,
      inputSchema: authorizationDiffToolSchema(),
    },
  };

  let attempts = 0;
  let lastDetails = "";
  let usage: EngineMeta["usage"];

  // One corrective retry, and only for output that failed validation.
  // Transport failures are returned immediately: retrying a timeout inside a
  // checkout path just spends more of the shopper's patience.
  while (attempts < 2) {
    attempts += 1;

    let invocation;
    try {
      invocation = await client({ ...baseRequest, messages });
    } catch (error) {
      const kind =
        error instanceof EngineTransportError ? error.kind : "api_error";
      return {
        success: false,
        failureReason: kind,
        details:
          error instanceof Error ? error.message : `model call failed: ${String(error)}`,
        meta: { model, attempts, latencyMs: now() - startedAt, usage },
      };
    }

    usage = invocation.usage ?? usage;

    const toolCall = invocation.toolCalls.find(
      (call) => call.name === DIFF_TOOL_NAME,
    );

    if (!toolCall) {
      lastDetails = `model returned no ${DIFF_TOOL_NAME} tool call (stop reason: ${invocation.stopReason ?? "unknown"})`;
    } else {
      const parsed = AuthorizationDiff.safeParse(toolCall.input);
      if (parsed.success) {
        return {
          success: true,
          diff: parsed.data,
          meta: { model, attempts, latencyMs: now() - startedAt, usage },
        };
      }
      lastDetails = issuesFor(parsed.error);
    }

    if (attempts < 2) {
      messages.push({
        role: "user",
        content: `${CORRECTIVE_NOTE_PREFIX} ${lastDetails}`,
      });
    }
  }

  return {
    success: false,
    failureReason: "malformed_output",
    details: lastDetails,
    meta: { model, attempts, latencyMs: now() - startedAt, usage },
  };
}
