import {
  createAgentClient,
  isAgentConfigured,
  runAgent,
  submitAgentRun,
  type AgentEvent,
} from "@/lib/agent";
import { stamp } from "@/lib/agent/events";
import { agentRunGuard } from "@/lib/rate-limit";

/**
 * Runs the demo agent live and streams what actually happens.
 *
 * WHY SERVER-SENT EVENTS RATHER THAN A SINGLE JSON RESPONSE
 *
 * A run takes up to two minutes: a dozen model turns, then the pipeline, then
 * possibly a Razorpay order. The previous version awaited all of that and
 * returned one JSON blob, so the console sat on "running…" with no signal for
 * up to 120 seconds. A viewer cannot tell that apart from a hang, and a demo
 * that looks hung is a demo that failed.
 *
 * Every frame here corresponds to something that already happened — a tool the
 * agent called, a stage the pipeline completed. Nothing is emitted in advance
 * and nothing is invented to fill the silence.
 *
 * ERROR CONTRACT. Every failure path, including an unexpected throw, ends with
 * exactly one terminal frame: `run.done` or `run.failed`. The client therefore
 * cannot be left waiting. Error bodies carry a stable `code` and a `detail`
 * written for a human; provider payloads and stack traces are logged
 * server-side and never streamed, because they can carry request context and
 * fragments of credentials.
 */

export const maxDuration = 120;

/**
 * Wall-clock budget for one run, checked between agent turns.
 *
 * Sits under `maxDuration` with room for one in-flight request timeout (45s)
 * to drain, so the guard always releases inside the platform's limit rather
 * than being killed mid-`finally`.
 */
const RUN_DEADLINE_MS = 70_000;
export const dynamic = "force-dynamic";

const GOAL = {
  principalName: "Aarav Menon",
  categoryScope: ["footwear/running-shoes"],
  spendCapMinor: 500_000,
};

/** Structured, safe, and identical in shape whatever went wrong. */
function errorResponse(
  code: string,
  detail: string,
  status: number,
  extra: Record<string, unknown> = {},
): Response {
  return Response.json({ error: code, detail, ...extra }, { status });
}

export async function POST(request: Request): Promise<Response> {
  if (!isAgentConfigured()) {
    return errorResponse(
      "not_configured",
      "No model backend is configured on the server. Set ANTHROPIC_API_KEY, or BOUNCER_ENGINE_PRESET and BOUNCER_ENGINE_API_KEY, then restart.",
      503,
    );
  }

  let mode: unknown;
  try {
    mode = ((await request.json()) as { mode?: unknown }).mode;
  } catch {
    return errorResponse(
      "bad_request",
      "Request body must be JSON.",
      400,
    );
  }

  if (mode !== "clean" && mode !== "adversarial") {
    return errorResponse(
      "bad_request",
      'mode must be "clean" or "adversarial".',
      400,
    );
  }

  // Server-side, because a disabled button is not a control. Acquire BEFORE
  // any model call so a second click cannot start a second run.
  const verdict = agentRunGuard.tryAcquire();
  if (!verdict.ok) {
    return errorResponse(
      verdict.code,
      verdict.detail,
      verdict.code === "in_flight" ? 409 : 429,
      verdict.code === "rate_limited"
        ? { retryAfterMs: verdict.retryAfterMs }
        : {},
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: AgentEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // The client went away. Stop writing; the run still finishes so any
          // Razorpay order it creates is recorded rather than orphaned.
          closed = true;
        }
      };

      try {
        const { client, model } = createAgentClient();
        send({ type: "run.start", mode, model, at: stamp() });
        send({
          type: "stage.start",
          stage: "agent.browse",
          detail: `${mode} storefront, the agent chooses for itself`,
          at: stamp(),
        });

        const run = await runAgent(mode, GOAL, client, {
          model,
          onEvent: send,
          deadlineAt: Date.now() + RUN_DEADLINE_MS,
        });

        if (run.stoppedBecause !== "checkout") {
          send({
            type: "run.failed",
            code:
              run.stoppedBecause === "deadline"
                ? "deadline_exceeded"
                : "agent_did_not_checkout",
            detail:
              run.stoppedBecause === "deadline"
                ? "The run passed its time budget and was stopped, most likely because the model provider is slow or unresponsive. Nothing was decided and no order was created. Try again."
                : run.error && /rate limit|429/i.test(run.error)
                  ? "The model provider rate-limited this run. Wait about a minute and try again."
                  : `The agent stopped without checking out (${run.stoppedBecause}). No decision was recorded and no order was created.`,
            at: stamp(),
          });
          return;
        }

        send({
          type: "stage.ok",
          stage: "agent.browse",
          detail: `agent checked out ${run.session.cart.length} line(s) after ${run.modelCalls} model call(s)`,
          at: stamp(),
        });

        const submitted = await submitAgentRun(run, GOAL, send);

        send({
          type: "run.done",
          purchaseRequestId: submitted.purchaseRequestId,
          outcome: submitted.outcome,
          decidedBy: submitted.decidedBy,
          reason: submitted.reason,
          razorpayOrderId: submitted.razorpay?.orderId ?? null,
          razorpayNote: submitted.razorpay?.note ?? null,
          at: stamp(),
        });
      } catch (error: unknown) {
        // The full error goes to the server log; the client gets a safe line.
        console.error("[agent.run] unhandled failure", error);
        send({
          type: "run.failed",
          code: "internal_error",
          detail:
            "The run failed partway through. Any decision already recorded is in the requests table and the audit chain; check there before retrying, because a retry starts a new run.",
          at: stamp(),
        });
      } finally {
        // Released here and nowhere else. A leaked slot would wedge the
        // endpoint until restart — a worse failure than the one it prevents.
        agentRunGuard.release();
        closed = true;
        try {
          controller.close();
        } catch {
          // Already closed by a client disconnect.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Nginx and similar proxies buffer by default, which would defeat the
      // entire point of streaming.
      "x-accel-buffering": "no",
    },
  });
}
