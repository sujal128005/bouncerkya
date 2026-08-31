/**
 * The demo agent's model port.
 *
 * Multi-turn, multi-tool, and free to choose — deliberately unlike the
 * Intent-Cart Engine's single forced tool. The agent has to be able to decide
 * for itself, including deciding wrongly; a port that constrained its choices
 * would make the adversarial run meaningless.
 */

export type AgentToolSpec = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type AgentToolCall = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type AgentTurn =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls: AgentToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export type AgentModelRequest = {
  model: string;
  system: string;
  turns: AgentTurn[];
  tools: AgentToolSpec[];
  maxTokens: number;
  temperature: number;
};

export type AgentModelReply = {
  content: string | null;
  toolCalls: AgentToolCall[];
  stopReason: string | null;
};

export type AgentModelClient = (
  request: AgentModelRequest,
) => Promise<AgentModelReply>;

export class AgentTransportError extends Error {
  constructor(
    readonly kind: "timeout" | "api_error",
    message: string,
  ) {
    super(message);
    this.name = "AgentTransportError";
  }
}
