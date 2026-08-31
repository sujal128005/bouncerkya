import Link from "next/link";

import { OutcomeBadge, Chip } from "@/app/_components/ui";
import {
  capUtilisation,
  formatConfidence,
  formatMinor,
  formatTimestamp,
} from "@/lib/format";
import { labelForScenario } from "@/lib/scenario-label";
import type { ScenarioView } from "@/lib/scenarios";

/**
 * The list of checkout attempts.
 *
 * This replaces a ten-column table. The table was not wrong — it was
 * unreadable: ten narrow columns of monospace, with the only human-meaningful
 * cell (the product name) truncated at 260px, and the row's identity carried
 * by a hex id. Nothing on a row told you what the row was ABOUT.
 *
 * So each attempt is now one wide row that reads as a sentence: what happened,
 * why, and then the numbers. The identifiers are still here — they are just no
 * longer the headline, because `req_B2D95E` is a key, not a name.
 *
 * Sorted newest first, so a live run the visitor just triggered is at the top
 * where they will look for it.
 */

function stageOf(scenario: ScenarioView): string {
  if (!scenario.mandateVerification.valid) return "mandate verifier";
  if (scenario.diff) return "threshold policy";
  return "fail-safe";
}

function latencyOf(scenario: ScenarioView): string {
  const ms =
    scenario.decision?.latencyMs ?? scenario.diffProvenance?.engineLatencyMs ?? null;
  if (ms === null) return "n/a";
  return ms === 0 ? "<1 ms" : `${ms} ms`;
}

/** Dot-separated facts, so the eye can skip them until it wants them. */
function FactLine({ facts }: { facts: string[] }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-label text-ink-3">
      {facts.map((fact, index) => (
        <span key={fact} className="flex items-center gap-2 whitespace-nowrap">
          {index > 0 ? <span aria-hidden>&middot;</span> : null}
          {fact}
        </span>
      ))}
    </div>
  );
}

export function RequestList({ scenarios }: { scenarios: ScenarioView[] }) {
  const rows = [...scenarios].sort(
    (a, b) =>
      b.purchaseRequest.requestedAt.getTime() -
      a.purchaseRequest.requestedAt.getTime(),
  );

  return (
    <ul className="flex flex-col gap-2">
      {rows.map((scenario) => {
        const label = labelForScenario(scenario);
        const item = scenario.purchaseRequest.items[0];
        const extra = scenario.purchaseRequest.items.length - 1;

        return (
          <li key={scenario.key}>
            <Link
              href={`/requests/${scenario.key}`}
              className="group flex flex-col gap-1 rounded-panel border border-line bg-surface px-4 py-4 transition-colors hover:border-accent hover:bg-accent-soft/40 sm:flex-row sm:items-start sm:gap-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h3 className="font-display text-lead font-bold text-ink group-hover:text-accent-strong">
                    {label.title}
                  </h3>
                  <span className="text-meta text-ink-2">
                    {item.name}
                    {extra > 0 ? ` +${extra} more` : ""}
                  </span>
                </div>

                <p className="mt-1.5 max-w-[86ch] text-body leading-[1.55] text-ink-2">
                  {label.subtitle}
                </p>

                <FactLine
                  facts={[
                    formatMinor(scenario.purchaseRequest.totalMinor),
                    `${capUtilisation(
                      scenario.purchaseRequest.totalMinor,
                      scenario.mandate.spendCapMinor,
                    )} of cap`,
                    `stopped at ${stageOf(scenario)}`,
                    scenario.diff
                      ? `confidence ${formatConfidence(scenario.diff.confidence)}`
                      : "no diff",
                    latencyOf(scenario),
                    scenario.key,
                    formatTimestamp(scenario.purchaseRequest.requestedAt),
                  ]}
                />
              </div>

              <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end">
                {scenario.decision ? (
                  <OutcomeBadge outcome={scenario.decision.outcome} size="lg" />
                ) : (
                  <Chip tone="quiet">not evaluated</Chip>
                )}
                {scenario.stepUp?.status === "pending" ? (
                  <span className="font-mono text-label text-stepup">
                    awaiting a human
                  </span>
                ) : null}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
