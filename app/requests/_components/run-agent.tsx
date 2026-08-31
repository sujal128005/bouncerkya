"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

import type { AgentEvent } from "@/lib/agent/events";

/**
 * Runs the demo agent live and streams the real execution trace.
 *
 * Every line rendered here corresponds to an event the server emitted after
 * the thing it describes had already happened. There is no simulated progress,
 * no interpolated stage, and no spinner standing in for work — a run that
 * pauses shows why it paused.
 *
 * The result lands in the same console as every seeded scenario, because there
 * is no separate demo code path.
 */

type Phase = "idle" | "running" | "done" | "failed";

const STAGE_LABEL: Record<string, string> = {
  "agent.browse": "agent",
  "mandate.sign": "mandate.sign",
  "mandate.verify": "mandate.verify",
  "evidence.extract": "evidence",
  "intent.diff": "intent.diff",
  "policy.evaluate": "policy",
  "audit.append": "audit",
  "razorpay.order": "razorpay",
};

function clockOf(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "--:--:--" : at.toISOString().slice(11, 19);
}

/** One trace line. Mark carries success/failure; colour never carries it alone. */
function TraceLine({ event }: { event: AgentEvent }) {
  let mark = "·";
  let markClass = "text-ink-3";
  let label = "";
  let detail = "";

  switch (event.type) {
    case "run.start":
      mark = "▸";
      markClass = "text-ink-2";
      label = "agent.run";
      detail = `${event.mode} · ${event.model}`;
      break;
    case "tool":
      mark = "✓";
      markClass = "text-ink-2";
      label = event.name;
      detail = event.summary;
      break;
    case "stage.start":
      mark = "…";
      markClass = "text-ink-3";
      label = STAGE_LABEL[event.stage] ?? event.stage;
      detail = event.detail;
      break;
    case "stage.ok":
      mark = "✓";
      markClass = "text-allow";
      label = STAGE_LABEL[event.stage] ?? event.stage;
      detail = event.detail;
      break;
    case "stage.failed":
      mark = "×";
      markClass = "text-decline";
      label = STAGE_LABEL[event.stage] ?? event.stage;
      detail = event.detail;
      break;
    case "waiting":
      mark = "!";
      markClass = "text-stepup";
      label = "waiting";
      detail = `${event.detail} (${(event.ms / 1000).toFixed(1)}s)`;
      break;
    case "run.done":
      mark = event.outcome === "ALLOW" ? "✓" : event.outcome === "DECLINE" ? "×" : "!";
      markClass =
        event.outcome === "ALLOW"
          ? "text-allow"
          : event.outcome === "DECLINE"
            ? "text-decline"
            : "text-stepup";
      label = event.outcome;
      detail = `by ${event.decidedBy}`;
      break;
    case "run.failed":
      mark = "×";
      markClass = "text-decline";
      label = event.code;
      detail = event.detail;
      break;
  }

  return (
    <div className="flex gap-3 px-3 py-1">
      <span className="shrink-0 font-mono text-label text-ink-3">
        {clockOf(event.at)}
      </span>
      <span className={`shrink-0 font-mono text-label font-semibold ${markClass}`}>
        {mark}
      </span>
      <span className="shrink-0 font-mono text-label text-ink">{label}</span>
      <span className="min-w-0 flex-1 font-mono text-label break-words text-ink-2">
        {detail}
      </span>
    </div>
  );
}

export function RunAgent() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [mode, setMode] = useState<"clean" | "adversarial" | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Guards against a double-click landing before React re-renders the disabled
  // button. The server enforces this too; this only avoids a pointless request.
  const busy = useRef(false);

  const run = useCallback(
    async (which: "clean" | "adversarial") => {
      if (busy.current) return;
      busy.current = true;

      setPhase("running");
      setMode(which);
      setEvents([]);
      setError(null);

      let landedOn: string | null = null;

      try {
        const response = await fetch("/api/agent/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: which }),
        });

        // Guard rejections and misconfiguration come back as JSON, not a stream.
        if (!response.ok || !response.body) {
          const body = (await response.json().catch(() => null)) as
            | { detail?: string; error?: string }
            | null;
          setError(body?.detail ?? `Run failed with HTTP ${response.status}.`);
          setPhase("failed");
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // SSE frames are separated by a blank line. A partial frame stays in
          // the buffer until the rest of it arrives.
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";

          for (const frame of frames) {
            const line = frame.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;
            let event: AgentEvent;
            try {
              event = JSON.parse(line.slice(6)) as AgentEvent;
            } catch {
              continue; // A malformed frame is skipped, never rendered as truth.
            }
            setEvents((previous) => [...previous, event]);
            if (event.type === "run.done") {
              landedOn = event.purchaseRequestId;
              setPhase("done");
            }
            if (event.type === "run.failed") {
              setError(event.detail);
              setPhase("failed");
            }
          }
        }

        // The stream ended without a terminal frame — a dropped connection or
        // a killed server. Say so rather than leaving the trace looking live.
        setPhase((current) => {
          if (current === "running") {
            setError(
              "The connection ended before the run reported a result. Check the list below: the decision may still have been recorded.",
            );
            return "failed";
          }
          return current;
        });
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        setPhase("failed");
      } finally {
        busy.current = false;
        if (landedOn) {
          router.push(`/requests/${landedOn}`);
          router.refresh();
        }
      }
    },
    [router],
  );

  const running = phase === "running";

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <span className="label-caps hidden sm:inline">Live agent</span>
        <button
          type="button"
          disabled={running}
          onClick={() => void run("clean")}
          className="inline-flex h-9 items-center justify-center rounded-control px-4 transition-colors disabled:opacity-50 border border-line bg-surface font-mono text-meta text-ink-2 hover:border-line-strong hover:text-ink"
        >
          {running && mode === "clean" ? "running…" : "clean run"}
        </button>
        <button
          type="button"
          disabled={running}
          onClick={() => void run("adversarial")}
          className="inline-flex h-9 items-center justify-center rounded-control px-4 transition-colors disabled:opacity-50 border border-accent bg-accent font-mono text-meta text-white hover:border-accent-strong hover:bg-accent-strong"
        >
          {running && mode === "adversarial" ? "running…" : "adversarial run"}
        </button>
      </div>

      {events.length > 0 || error ? (
        <div className="w-full max-w-[760px] overflow-hidden rounded-panel border border-line bg-surface">
          <div className="flex items-center justify-between border-b border-line-soft px-3 py-2">
            <span className="label-caps">Live trace</span>
            <span className="font-mono text-label text-ink-3">
              {phase === "running"
                ? "streaming"
                : phase === "done"
                  ? "complete"
                  : phase === "failed"
                    ? "ended"
                    : ""}
            </span>
          </div>

          <div className="max-h-[320px] overflow-y-auto py-1">
            {events.map((event, index) => (
              <TraceLine key={`${event.type}-${index}`} event={event} />
            ))}
          </div>

          {/*
            Only shown when the failure did NOT arrive as a trace line — a
            dropped connection, or a guard rejection that never opened a
            stream. When the stream reported it, the last line already says
            so and repeating it underneath is noise.
          */}
          {error && events.length === 0 ? (
            <p className="border-t border-line-soft px-3 py-2 text-left text-label leading-[1.5] text-ink">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
