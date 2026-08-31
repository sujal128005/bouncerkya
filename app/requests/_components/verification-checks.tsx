import type { MandateCheckResult, MandateCheckStatus } from "@/lib/mandate";

/**
 * The Mandate Verifier's four checks, in evaluation order, including the ones
 * it never reached. Deliberately not colour-coded: green/amber/red belong to
 * decision outcomes, so weight and glyph carry the difference here.
 */

const GLYPH: Record<MandateCheckStatus, string> = {
  pass: "✓",
  fail: "✕",
  not_evaluated: "·",
};

const GLYPH_TONE: Record<MandateCheckStatus, string> = {
  pass: "text-ink-3",
  fail: "text-ink",
  not_evaluated: "text-line-strong",
};

const LABEL_TONE: Record<MandateCheckStatus, string> = {
  pass: "text-ink-2",
  fail: "text-ink",
  not_evaluated: "text-ink-3",
};

const STATUS_LABEL: Record<MandateCheckStatus, string> = {
  pass: "pass",
  fail: "fail",
  not_evaluated: "skipped",
};

export function VerificationChecks({
  checks,
}: {
  checks: MandateCheckResult[];
}) {
  return (
    <ul className="flex flex-col">
      {checks.map((check) => (
        <li
          key={check.check}
          className={`grid grid-cols-[12px_72px_minmax(0,1fr)] items-baseline gap-x-2 py-[3px] ${
            check.status === "fail" ? "font-medium" : ""
          }`}
        >
          <span
            aria-hidden
            className={`font-mono text-label ${GLYPH_TONE[check.status]}`}
          >
            {GLYPH[check.status]}
          </span>
          <span
            className={`font-mono text-meta ${LABEL_TONE[check.status]}`}
          >
            {check.check}
          </span>
          <span className="text-meta leading-[1.45] text-ink-2">
            <span className="sr-only">{STATUS_LABEL[check.status]}: </span>
            {check.detail}
          </span>
        </li>
      ))}
    </ul>
  );
}
