/**
 * The live agent's event contract.
 *
 * WHY A CONTRACT AND NOT JUST LOG LINES
 *
 * The console shows a judge what the system is doing while it does it. That is
 * only worth anything if every line corresponds to something that actually
 * happened. So these events are emitted from the real execution points — the
 * tool dispatcher, the verifier, the engine, the policy, the Razorpay client —
 * and never synthesised to make the trace look busier or more orderly than the
 * run really was.
 *
 * Rules this file exists to enforce:
 *
 *   1. No event is emitted before the thing it describes has happened.
 *   2. A failed stage emits a FAILED event. It is never omitted to keep the
 *      trace tidy, and never downgraded to look like a success.
 *   3. No event carries a secret, a key, a raw provider response or a stack
 *      trace. `detail` is written for a human reading a screen.
 *   4. A run always terminates with exactly one `run.done` or `run.failed`,
 *      so the UI can never sit on a spinner forever.
 */

import type { PolicyOutcome } from "@/schemas";

export type AgentStage =
  | "agent.browse"
  | "mandate.sign"
  | "mandate.verify"
  | "evidence.extract"
  | "intent.diff"
  | "policy.evaluate"
  | "audit.append"
  | "razorpay.order";

export type AgentEvent =
  | { type: "run.start"; mode: "clean" | "adversarial"; model: string; at: string }
  /** One tool call the agent actually made, after it returned. */
  | { type: "tool"; name: string; summary: string; at: string }
  | { type: "stage.start"; stage: AgentStage; detail: string; at: string }
  | { type: "stage.ok"; stage: AgentStage; detail: string; at: string }
  | { type: "stage.failed"; stage: AgentStage; detail: string; at: string }
  /** Waiting out a provider rate limit. Shown so a pause is never mistaken for a hang. */
  | { type: "waiting"; detail: string; ms: number; at: string }
  | {
      type: "run.done";
      purchaseRequestId: string;
      outcome: PolicyOutcome;
      decidedBy: string;
      reason: string;
      razorpayOrderId: string | null;
      razorpayNote: string | null;
      at: string;
    }
  | { type: "run.failed"; code: string; detail: string; at: string };

export type AgentEventSink = (event: AgentEvent) => void;

export const stamp = (): string => new Date().toISOString();

/**
 * A sink that never throws. A trace consumer that fails — a closed SSE stream,
 * a disconnected browser — must not be able to kill an agent run that is
 * already spending money-adjacent API calls.
 */
export function safeSink(sink: AgentEventSink | undefined): AgentEventSink {
  if (!sink) return () => {};
  return (event) => {
    try {
      sink(event);
    } catch {
      // A broken trace is a cosmetic failure. The run continues.
    }
  };
}

/** Short, human-readable, never the raw tool payload. */
export function summariseToolCall(
  name: string,
  input: Record<string, unknown>,
  result: string,
): string {
  switch (name) {
    case "browse_catalog": {
      const category = typeof input.category === "string" ? input.category : "all categories";
      let count = "";
      try {
        const parsed: unknown = JSON.parse(result);
        if (Array.isArray(parsed)) count = `: ${parsed.length} listings`;
      } catch {
        // Result shape is the tool's business, not the trace's.
      }
      return `${category}${count}`;
    }
    case "view_listing":
      return typeof input.listing_id === "string" ? input.listing_id : "unknown listing";
    case "add_to_cart": {
      const id = typeof input.listing_id === "string" ? input.listing_id : "?";
      const qty = typeof input.quantity === "number" ? input.quantity : 1;
      return `${qty} x ${id}`;
    }
    case "checkout":
      return "cart submitted for evaluation";
    default:
      return name;
  }
}
