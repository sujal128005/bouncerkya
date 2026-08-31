import { z } from "zod";

import { AuthorizationDiff } from "@/schemas";

/**
 * The engine talks to a model through this narrow port, not through the
 * Anthropic SDK directly. Two reasons: the unit tests can drive every branch
 * with a plain function instead of mocking an SDK surface, and swapping the
 * transport (or the provider) later touches one adapter file.
 */

export type ModelMessage = { role: "user" | "assistant"; content: string };

export type ModelToolSpec = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type DiffModelRequest = {
  model: string;
  system: string;
  messages: ModelMessage[];
  maxTokens: number;
  temperature: number;
  tool: ModelToolSpec;
};

export type ModelToolCall = { name: string; input: unknown };

export type ModelInvocation = {
  toolCalls: ModelToolCall[];
  stopReason: string | null;
  usage?: { inputTokens: number; outputTokens: number };
};

export type DiffModelClient = (
  request: DiffModelRequest,
) => Promise<ModelInvocation>;

/** Transport-level failures, classified by the adapter, mapped by the engine. */
export class EngineTransportError extends Error {
  constructor(
    readonly kind: "timeout" | "api_error",
    message: string,
  ) {
    super(message);
    this.name = "EngineTransportError";
  }
}

export const DIFF_TOOL_NAME = "emit_authorization_diff";

/**
 * Generated from the same Zod schema the response is validated against, so the
 * contract the model is given and the contract it is held to cannot drift.
 */
export function authorizationDiffToolSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(AuthorizationDiff, {
    target: "draft-7",
  }) as Record<string, unknown>;
  // Anthropic wants a bare top-level object schema, without the $schema key.
  delete schema.$schema;
  return schema;
}

export const DIFF_TOOL_DESCRIPTION =
  "Emit the Authorization Diff: a clause-by-clause comparison of what the " +
  "principal authorized against what the agent is attempting to buy. This is " +
  "evidence for a downstream policy engine, not a decision.";
