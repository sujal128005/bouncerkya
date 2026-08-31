import type { ReactNode } from "react";

/**
 * One numbered stage of the pipeline, on the request detail page.
 *
 * The point of numbering is that a checkout is a SEQUENCE, and the old console
 * showed it as a grid — four panels of equal weight with no indication that
 * one of them ran before the others, or that a failure in the first meant the
 * third never happened at all. A reader had to already know the architecture
 * to read the screen.
 *
 * So a stage that did not run is still rendered, greyed, saying why. "Never
 * reached" is one of the more interesting things this system can tell you: it
 * is the difference between a request that was judged and one that was
 * rejected for a few microseconds' worth of arithmetic.
 */

export type StageState = "ran" | "skipped" | "failed";

const STATE_TEXT: Record<StageState, string> = {
  ran: "text-ink-2",
  skipped: "text-ink-3",
  failed: "text-decline",
};

const STATE_MARK: Record<StageState, string> = {
  ran: "✓",
  skipped: "–", // en dash: nothing happened here
  failed: "×",
};

/*
 * A stage that ran takes the violet decorative hue, a stage that never ran is
 * left grey, and a stage that FAILED takes the decline colour -- the one
 * functional colour on this rail, and it is functional because a failed stage
 * is exactly what a DECLINE is made of.
 */
const STATE_RING: Record<StageState, string> = {
  ran: "border-violet-line bg-violet-soft text-violet",
  skipped: "border-line bg-inset text-ink-3",
  failed: "border-decline-line bg-decline-soft text-decline",
};

export function StageSection({
  n,
  name,
  state,
  /** What this stage did for THIS request, in one sentence. */
  outcome,
  children,
}: {
  n: number;
  name: string;
  state: StageState;
  outcome: string;
  children?: ReactNode;
}) {
  return (
    <section className="grid grid-cols-[32px_minmax(0,1fr)] gap-x-4">
      {/* The rail: number, then a line down to the next stage. */}
      <div className="flex flex-col items-center">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border font-mono text-meta font-semibold tabular-nums ${STATE_RING[state]}`}
        >
          {n}
        </span>
        <span aria-hidden className="mt-1 w-px flex-1 bg-gradient-to-b from-violet-line to-line" />
      </div>

      <div className="pb-8">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h2 className="font-display text-head font-bold text-ink">{name}</h2>
          <span
            className={`flex items-center gap-1.5 font-mono text-label ${STATE_TEXT[state]}`}
          >
            <span aria-hidden className="font-semibold">
              {STATE_MARK[state]}
            </span>
            {state === "ran" ? "ran" : state === "failed" ? "failed" : "not reached"}
          </span>
        </div>

        <p className={`mt-1.5 max-w-[84ch] text-body leading-[1.6] ${STATE_TEXT[state]}`}>
          {outcome}
        </p>

        {children ? <div className="mt-4">{children}</div> : null}
      </div>
    </section>
  );
}
