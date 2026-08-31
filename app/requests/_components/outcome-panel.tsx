import Link from "next/link";

import { IconVerdict } from "@/app/_components/icons";
import {
  Meter,
  OutcomeBadge,
  Panel,
  PanelBody,
  PanelHeader,
  outcomeRuleClass,
} from "@/app/_components/ui";
import { formatConfidence, formatMinor, formatTimestamp } from "@/lib/format";
import type { ScenarioView } from "@/lib/scenarios";
import type { AuthorizationDiff, PolicyDecision, StepUpRequest } from "@/schemas";

/** Which stage produced this outcome, derived from what the pipeline stored. */
function decidedBy(scenario: {
  mandateVerification: { valid: boolean };
  diff: AuthorizationDiff | null;
}): { stage: string; note: string } {
  if (!scenario.mandateVerification.valid) {
    return {
      stage: "mandate verifier",
      note: "deterministic · no model call",
    };
  }
  if (!scenario.diff) {
    return {
      stage: "fail-safe",
      note: "engine could not answer · escalated, never allowed",
    };
  }
  return { stage: "threshold policy", note: "deterministic over the diff" };
}

export function OutcomePanel({
  decision,
  diff,
  stepUp,
  scenario,
}: {
  decision: PolicyDecision;
  diff: AuthorizationDiff | null;
  stepUp: StepUpRequest | null;
  scenario: ScenarioView;
}) {
  const origin = decidedBy(scenario);
  return (
    <Panel>
      <PanelHeader icon={<IconVerdict className="h-4 w-4" />} title="Outcome" />
      <PanelBody
        className={`border-l-2 ${outcomeRuleClass(decision.outcome)} flex flex-col gap-4`}
      >
        <div className="flex items-start justify-between gap-4">
          <OutcomeBadge outcome={decision.outcome} size="lg" />
          {diff ? (
            <div className="min-w-[104px] text-right">
              <div className="label-caps mb-1">Confidence</div>
              <div className="font-mono text-head font-medium text-ink">
                {formatConfidence(diff.confidence)}
              </div>
              <div className="mt-2">
                <Meter value={diff.confidence} />
              </div>
            </div>
          ) : (
            <div className="min-w-[132px] text-right">
              <div className="label-caps mb-1">Decided by</div>
              <div className="font-mono text-meta text-ink">{origin.stage}</div>
              <div className="mt-1 font-mono text-label text-ink-3">
                {origin.note}
              </div>
            </div>
          )}
        </div>

        <p className="text-body leading-[1.55] text-ink">
          {decision.reason}
        </p>

        <dl className="grid grid-cols-[92px_minmax(0,1fr)] gap-x-3 gap-y-2 border-t border-line-soft pt-3">
          <dt className="label-caps pt-px">Decision</dt>
          <dd className="font-mono text-meta text-ink">{decision.id}</dd>
          <dt className="label-caps pt-px">Decided</dt>
          <dd className="font-mono text-meta text-ink-2">
            {formatTimestamp(decision.decidedAt)}
          </dd>
          <dt className="label-caps pt-px">Latency</dt>
          <dd className="font-mono text-meta text-ink-2">
            {decision.latencyMs === 0 ? "<1 ms" : `${decision.latencyMs} ms`}
          </dd>
          <dt className="label-caps pt-px">Decided by</dt>
          <dd className="font-mono text-meta text-ink-2">{origin.stage}</dd>
          <dt className="label-caps pt-px">Diff</dt>
          <dd className="font-mono text-meta text-ink-2">
            {decision.authorizationDiffId ?? "none produced"}
          </dd>
        </dl>

        {scenario.razorpayOrder ? (
          <div className="border-t border-line-soft pt-3">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h3 className="label-caps">Razorpay order</h3>
              <span className="font-mono text-label tracking-[0.04em] text-ink-3">
                test mode
              </span>
            </div>
            <dl className="grid grid-cols-[92px_minmax(0,1fr)] gap-x-3 gap-y-2">
              <dt className="label-caps pt-px">Order</dt>
              <dd className="font-mono text-meta break-all text-ink">
                {scenario.razorpayOrder.razorpayOrderId}
              </dd>
              <dt className="label-caps pt-px">Status</dt>
              <dd className="font-mono text-meta text-ink-2">
                {scenario.razorpayOrder.status}
                {scenario.razorpayOrder.paymentStatus
                  ? ` · payment ${scenario.razorpayOrder.paymentStatus}`
                  : ""}
              </dd>
              <dt className="label-caps pt-px">Amount</dt>
              <dd className="font-mono text-meta text-ink-2">
                {formatMinor(scenario.razorpayOrder.amountMinor)}
              </dd>
              <dt className="label-caps pt-px">Receipt</dt>
              <dd className="font-mono text-meta text-ink-2">
                {scenario.razorpayOrder.receipt}
              </dd>
            </dl>
          </div>
        ) : null}

        {stepUp ? (
          <div className="flex items-center justify-between gap-3 border-t border-line-soft pt-3">
            <span className="font-mono text-meta text-ink-2">
              step-up {stepUp.id} · {stepUp.status}
            </span>
            <Link
              href="/inbox"
              className="text-meta text-accent hover:text-accent-strong hover:underline"
            >
              Open in inbox
            </Link>
          </div>
        ) : null}
      </PanelBody>
    </Panel>
  );
}
