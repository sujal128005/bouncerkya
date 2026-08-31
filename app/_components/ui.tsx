import type { ReactNode } from "react";

import type { DiffClauseSeverity, PolicyOutcome } from "@/schemas";

/* ------------------------------------------------------------------ panels */

export function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`flex flex-col rounded-panel border border-line bg-surface ${className}`}
    >
      {children}
    </section>
  );
}

export function PanelHeader({
  title,
  meta,
  icon,
}: {
  title: string;
  meta?: ReactNode;
  /** Semantic only. A panel that reads the same without one does not get one. */
  icon?: ReactNode;
}) {
  return (
    // min-h rather than a fixed height, and the meta chips wrap. On a narrow
    // screen a header carrying two chips ("3 clauses", "drift_detected") could
    // not fit on one line and pushed the whole page sideways; a taller header
    // is a far smaller cost than a horizontally scrolling document.
    <header className="flex min-h-11 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line px-4 py-2">
      <h2 className="flex items-center gap-2 label-caps text-ink-2">
        {icon ? <span className="text-ink-3">{icon}</span> : null}
        {title}
      </h2>
      {meta ? (
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          {meta}
        </div>
      ) : null}
    </header>
  );
}

export function PanelBody({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`px-4 py-3 ${className}`}>{children}</div>;
}

/* ------------------------------------------------------------------ fields */

export function FieldList({ children }: { children: ReactNode }) {
  // The label column narrows on small screens. At 390px a fixed 104px gutter
  // left 144px for the value, and a single category slug — the one thing in
  // here that cannot be abbreviated — needed 151px and pushed the page sideways.
  return (
    <dl className="grid grid-cols-[84px_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2 sm:grid-cols-[104px_minmax(0,1fr)]">
      {children}
    </dl>
  );
}

export function Field({
  label,
  children,
  mono = true,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <>
      <dt className="label-caps pt-px">{label}</dt>
      <dd
        className={
          mono
            ? "font-mono text-meta break-words text-ink"
            : "text-body break-words text-ink"
        }
      >
        {children}
      </dd>
    </>
  );
}

/** Monospace inline value — amounts, IDs, timestamps, hashes. */
export function Mono({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`font-mono text-meta text-ink ${className}`}>
      {children}
    </span>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return <span className="text-ink-3">{children}</span>;
}

/* ---------------------------------------------------------------- outcomes */

const OUTCOME_STYLES: Record<PolicyOutcome, string> = {
  ALLOW: "border-allow-line bg-allow-soft text-allow",
  STEP_UP: "border-stepup-line bg-stepup-soft text-stepup",
  DECLINE: "border-decline-line bg-decline-soft text-decline",
};

/**
 * Status is never carried by colour alone: every outcome renders as
 * glyph + semantic colour + text. The glyphs are distinguishable in
 * greyscale and to a screen reader, so the meaning survives both.
 */
const OUTCOME_GLYPH: Record<PolicyOutcome, string> = {
  ALLOW: "\u2713", // check
  STEP_UP: "!",
  DECLINE: "\u00d7", // multiplication sign, not the letter x
};

const OUTCOME_WORD: Record<PolicyOutcome, string> = {
  ALLOW: "Allowed",
  STEP_UP: "Review",
  DECLINE: "Blocked",
};

const OUTCOME_TEXT: Record<PolicyOutcome, string> = {
  ALLOW: "text-allow",
  STEP_UP: "text-stepup",
  DECLINE: "text-decline",
};

const OUTCOME_RULE: Record<PolicyOutcome, string> = {
  ALLOW: "border-allow",
  STEP_UP: "border-stepup",
  DECLINE: "border-decline",
};

export function outcomeRuleClass(outcome: PolicyOutcome): string {
  return OUTCOME_RULE[outcome];
}

export function OutcomeBadge({
  outcome,
  size = "sm",
}: {
  outcome: PolicyOutcome;
  size?: "sm" | "lg";
}) {
  const scale =
    size === "lg"
      ? "px-2 py-1 text-meta tracking-[0.08em]"
      : "px-2 py-[2px] text-label tracking-[0.07em]";
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-control border font-mono font-medium ${scale} ${OUTCOME_STYLES[outcome]}`}
    >
      <span aria-hidden className="leading-none font-semibold">
        {OUTCOME_GLYPH[outcome]}
      </span>
      {outcome}
    </span>
  );
}

/**
 * Compact status for tabs and dense rows, where the adjacent text is an
 * identifier rather than the verdict. A bare coloured dot would make colour the
 * only carrier of meaning here, so this renders the glyph and a screen-reader
 * word alongside it.
 */
export function StatusGlyph({ outcome }: { outcome: PolicyOutcome | null }) {
  if (!outcome) {
    return (
      <span className="inline-flex w-3 shrink-0 justify-center">
        <span aria-hidden className="text-label leading-none text-ink-3">
          &middot;
        </span>
        <span className="sr-only">No decision recorded</span>
      </span>
    );
  }
  return (
    <span className="inline-flex w-3 shrink-0 justify-center">
      <span
        aria-hidden
        className={`text-meta leading-none font-semibold ${OUTCOME_TEXT[outcome]}`}
      >
        {OUTCOME_GLYPH[outcome]}
      </span>
      <span className="sr-only">{OUTCOME_WORD[outcome]}</span>
    </span>
  );
}

/* ---------------------------------------------------------------- severity */

/**
 * Severity is deliberately NOT colour-coded: green/amber/red are reserved for
 * decision outcomes. Weight is carried by a three-segment meter instead.
 */
const SEVERITY_FILL: Record<DiffClauseSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

const SEVERITY_TEXT: Record<DiffClauseSeverity, string> = {
  low: "text-ink-3",
  medium: "text-ink-2",
  high: "text-ink",
};

export function SeverityTag({ severity }: { severity: DiffClauseSeverity }) {
  const filled = SEVERITY_FILL[severity];
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden className="flex items-center gap-[2px]">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className={`block h-[9px] w-[3px] rounded-[1px] ${
              index < filled ? "bg-ink-2" : "bg-line-strong"
            }`}
          />
        ))}
      </span>
      <span
        className={`font-mono text-label tracking-[0.07em] uppercase ${SEVERITY_TEXT[severity]}`}
      >
        {severity}
      </span>
    </span>
  );
}

/* -------------------------------------------------------------------- misc */

/** Neutral chip for non-outcome metadata (counts, states, provenance). */
export function Chip({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "quiet";
}) {
  const styles =
    tone === "quiet"
      ? "border-line-soft bg-inset text-ink-3"
      : "border-line bg-inset text-ink-2";
  return (
    <span
      className={`inline-flex items-center rounded-control border px-2 py-[1px] font-mono text-label tracking-[0.04em] ${styles}`}
    >
      {children}
    </span>
  );
}

/** Thin neutral meter — used for confidence and cap utilisation. */
export function Meter({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <span className="block h-[3px] w-full rounded-[2px] bg-line">
      <span
        className="block h-full rounded-[2px] bg-ink-2"
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}
