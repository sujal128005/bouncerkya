import type { AuthorizationDiff, DiffClauseSeverity, PolicyOutcome } from "@/schemas";

/**
 * The deterministic threshold policy.
 *
 * This is the only place in Bouncer that turns evidence into a verdict, and it
 * is deliberately dumb: no model, no network, no I/O, no clock. Given the same
 * AuthorizationDiff it returns the same outcome forever, which is what makes a
 * decision defensible after the fact.
 *
 * The constants below are hardcoded for the MVP but named as merchant-tunable
 * knobs, because that is what they become: a merchant with a low risk appetite
 * raises the confidence floor, one selling low-value goods might let medium
 * clauses through.
 */

/** Minimum model confidence before a "consistent" verdict may auto-allow. */
export const ALLOW_MIN_CONFIDENCE = 0.85;

/** Any clause at this severity blocks outright. */
export const DECLINE_SEVERITIES: readonly DiffClauseSeverity[] = ["high"];

/** A clean allow tolerates none of these. */
export const ALLOW_FORBIDDEN_SEVERITIES: readonly DiffClauseSeverity[] = [
  "high",
  "medium",
];

export type ThresholdRule =
  | "consistent_and_confident"
  | "high_severity_clause"
  | "residual_uncertainty";

export type ThresholdDecision = {
  outcome: PolicyOutcome;
  /** Which rule matched, for the audit record and the console. */
  rule: ThresholdRule;
  reason: string;
};

function severityCounts(diff: AuthorizationDiff): Record<DiffClauseSeverity, number> {
  const counts: Record<DiffClauseSeverity, number> = { low: 0, medium: 0, high: 0 };
  for (const clause of diff.clauses) counts[clause.severity] += 1;
  return counts;
}

/**
 * Rules are evaluated in order and the first match wins.
 *
 *   1. consistent + confident + nothing above low severity  -> ALLOW
 *   2. any high-severity clause                             -> DECLINE
 *   3. everything else                                      -> STEP_UP
 *
 * Rule 3 is the important one. It is not a fallback for cases we forgot; it is
 * the deliberate destination for genuine uncertainty. Anything this policy
 * cannot confidently allow or confidently block goes to a human.
 */
export function applyThresholdPolicy(diff: AuthorizationDiff): ThresholdDecision {
  const counts = severityCounts(diff);
  const forbidden = ALLOW_FORBIDDEN_SEVERITIES.reduce(
    (total, severity) => total + counts[severity],
    0,
  );
  const blocking = DECLINE_SEVERITIES.reduce(
    (total, severity) => total + counts[severity],
    0,
  );

  if (
    diff.overallVerdictRecommendation === "consistent" &&
    diff.confidence >= ALLOW_MIN_CONFIDENCE &&
    forbidden === 0
  ) {
    return {
      outcome: "ALLOW",
      rule: "consistent_and_confident",
      reason: `Diff is consistent at confidence ${diff.confidence.toFixed(2)} (floor ${ALLOW_MIN_CONFIDENCE.toFixed(2)}) with no clause above low severity.`,
    };
  }

  if (blocking > 0) {
    const types = diff.clauses
      .filter((clause) => DECLINE_SEVERITIES.includes(clause.severity))
      .map((clause) => clause.type);
    return {
      outcome: "DECLINE",
      rule: "high_severity_clause",
      reason: `${blocking} high-severity clause${blocking === 1 ? "" : "s"} (${types.join(", ")}). No reading of the mandate covers this cart.`,
    };
  }

  const why =
    diff.overallVerdictRecommendation === "consistent"
      ? `consistent but only ${diff.confidence.toFixed(2)} confident, below the ${ALLOW_MIN_CONFIDENCE.toFixed(2)} floor`
      : `drift detected at confidence ${diff.confidence.toFixed(2)} with ${counts.medium} medium and ${counts.low} low severity clause${counts.medium + counts.low === 1 ? "" : "s"}, none high`;

  return {
    outcome: "STEP_UP",
    rule: "residual_uncertainty",
    reason: `Escalated to the principal: ${why}. Not confident enough to allow, not severe enough to decline.`,
  };
}

/** The outcome for a request the Intent-Cart Engine could not evaluate. */
export const ENGINE_FAILURE_OUTCOME: PolicyOutcome = "STEP_UP";
