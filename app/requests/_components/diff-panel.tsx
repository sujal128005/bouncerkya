import { IconDiff } from "@/app/_components/icons";
import { Chip, Panel, PanelHeader, SeverityTag } from "@/app/_components/ui";
import type { ScenarioView } from "@/lib/scenarios";
import type { AuthorizationDiff, DiffClause } from "@/schemas";

/**
 * Emphasis on the attempted value scales with severity. Low severity gets the
 * same neutral rule as the authorized line — a near-miss should look calm.
 * Only a clause the policy will actually decline on gets the decline colour.
 */
const DEVIATION_RULE: Record<DiffClause["severity"], string> = {
  low: "border-line",
  medium: "border-stepup",
  high: "border-decline",
};

function ClauseRow({ clause }: { clause: DiffClause }) {
  return (
    <li className="border-b border-line-soft px-4 py-3 last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-meta tracking-[0.03em] text-ink">
          {clause.type}
        </span>
        <SeverityTag severity={clause.severity} />
      </div>

      {/*
        The divergence is the story, so the two values sit on one axis, one
        directly under the other, same font and same size — the only thing that
        differs is what they say. "Authorized" matches the wording used in the
        step-up inbox; it read "Mandate" here and "AUTHORIZED" there for the
        same idea. The attempted value carries a 2px rule in the outcome colour
        so the eye lands on the deviation, not on the label.
      */}
      <dl className="mt-3 grid grid-cols-[84px_minmax(0,1fr)] gap-x-3 gap-y-2">
        <dt className="label-caps pt-px">Authorized</dt>
        <dd className="border-l-2 border-line pl-3 font-mono text-meta break-words text-ink-2">
          {clause.mandateValue}
        </dd>
        <dt className="label-caps pt-px">Attempted</dt>
        <dd
          className={`border-l-2 pl-3 font-mono text-meta break-words text-ink ${DEVIATION_RULE[clause.severity]}`}
        >
          {clause.attemptedValue}
        </dd>
      </dl>

      <p className="mt-2 text-meta leading-[1.55] text-ink-2">
        {clause.explanation}
      </p>
    </li>
  );
}

export function DiffPanel({
  diff,
  diffId,
  provenance,
}: {
  diff: AuthorizationDiff;
  diffId: string;
  provenance: ScenarioView["diffProvenance"];
}) {
  const live = provenance?.source === "live";
  return (
    <Panel>
      <PanelHeader
        icon={<IconDiff className="h-4 w-4" />}
        title="Authorization diff"
        meta={
          <>
            <Chip tone="quiet">
              {diff.clauses.length}{" "}
              {diff.clauses.length === 1 ? "clause" : "clauses"}
            </Chip>
            <Chip>{diff.overallVerdictRecommendation}</Chip>
          </>
        }
      />

      <div className="border-b border-line-soft px-4 py-3">
        <p className="text-body leading-[1.55] text-ink">{diff.summary}</p>
        <p className="mt-2 font-mono text-label tracking-[0.04em] text-ink-3">
          {diffId} ·{" "}
          {live
            ? `computed by ${provenance?.model ?? "the engine"}${
                provenance?.engineLatencyMs !== null &&
                provenance?.engineLatencyMs !== undefined
                  ? ` in ${provenance.engineLatencyMs} ms`
                  : ""
              }`
            : "placeholder, engine not run"}{" "}
          · recommendation only, the policy engine decides
        </p>
      </div>

      <ol className="flex flex-col">
        {diff.clauses.map((clause, index) => (
          <ClauseRow key={`${clause.type}-${index}`} clause={clause} />
        ))}
      </ol>
    </Panel>
  );
}
