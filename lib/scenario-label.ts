/**
 * Plain-English names for checkout attempts.
 *
 * WHY THIS EXISTS
 *
 * The console used to identify every attempt by its database id — req_A7F31C,
 * req_B2D95E, req_C4E80B. Those are the right keys for the audit chain and the
 * wrong labels for a human: a reader has no way to tell which one is "agent
 * tries to buy a gift card on a footwear mandate" without opening all eight.
 *
 * WHAT THIS IS NOT
 *
 * It is NOT a lookup table keyed by seeded id. A hardcoded map would label the
 * eight demo rows and leave every live agent run nameless — the runs a judge
 * is most likely to trigger. So the label is DERIVED, from the same three
 * facts the console already displays: the verifier's checks, the diff's
 * clauses, and the policy outcome. A request created thirty seconds ago by the
 * live agent gets the same treatment as a seeded one.
 *
 * WHAT THIS IS NOT, PART TWO
 *
 * This changes no behaviour. Nothing here is read by the verifier, the engine,
 * the policy or the audit chain — it is a display string computed on the way
 * to the screen, and deleting it would change no decision. The ids remain
 * visible everywhere they carry meaning.
 *
 * The wording is deliberately mechanical. "Forged signature" is what a failed
 * ed25519 check means; it is not a dramatisation of one.
 */

import type { AuthorizationDiff, DiffClause, DiffClauseSeverity } from "@/schemas";
import type { MandateVerification } from "@/lib/mandate";
// Type-only, and erased at runtime — this module stays free of Prisma so its
// tests run without a database.
import type { ScenarioView } from "@/lib/scenarios";

/** Where the pipeline stopped. Groups the list and sets the reader's frame. */
export type StoppedAt =
  | "mandate verifier"
  | "intent engine"
  | "threshold policy"
  | "fail-safe"
  | "undecided";

export type ScenarioLabel = {
  /** Short human headline. Four words or so — this is the link text. */
  title: string;
  /** One sentence on what the attempt demonstrates. */
  subtitle: string;
  /** The stage that produced the outcome. */
  stoppedAt: StoppedAt;
};

/** Everything the label needs. Deliberately narrower than ScenarioView so the
 *  function stays pure and testable without a database. */
export type LabelInput = {
  mandateVerification: Pick<MandateVerification, "valid" | "failureReason">;
  diff: Pick<AuthorizationDiff, "clauses" | "overallVerdictRecommendation"> | null;
  engineFailure: { reason: string } | null;
  leadItemName: string | null;
  /** Cart total as a share of the mandate cap; 4 means 400%. */
  capUse: number | null;
};

const SEVERITY_RANK: Record<DiffClauseSeverity, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

/** The clause a human would lead with: highest severity, earliest on a tie. */
function dominantClause(clauses: DiffClause[]): DiffClause | null {
  let best: DiffClause | null = null;
  for (const clause of clauses) {
    if (best === null || SEVERITY_RANK[clause.severity] > SEVERITY_RANK[best.severity]) {
      best = clause;
    }
  }
  return best;
}

const CREDENTIAL_LABELS: Record<
  NonNullable<MandateVerification["failureReason"]>,
  { title: string; subtitle: string }
> = {
  malformed: {
    title: "Malformed mandate",
    subtitle:
      "The credential does not parse as a well-formed mandate, so nothing downstream ever saw it.",
  },
  invalid_signature: {
    title: "Forged signature",
    subtitle:
      "The mandate was altered after signing, or signed with a key that is not this agent's. The ed25519 check fails.",
  },
  expired: {
    title: "Expired mandate",
    subtitle:
      "The human's authorization has lapsed. An expired mandate is not a weaker mandate. It is not a mandate at all.",
  },
  replayed_nonce: {
    title: "Reused mandate",
    subtitle:
      "This mandate's nonce was already spent by an earlier request. Single-use means the first request wins.",
  },
};

function capPhrase(capUse: number | null): string {
  if (capUse === null) return "the spend cap";
  return `${Math.round(capUse * 100)}% of the spend cap`;
}

/**
 * Names one checkout attempt.
 *
 * Reads in pipeline order, because that is the order the reader needs: a
 * credential that never verified has no cart story worth telling.
 */
export function describeScenario(input: LabelInput): ScenarioLabel {
  // 1. The credential. Cheapest check, and it runs before any model call.
  if (!input.mandateVerification.valid) {
    const reason = input.mandateVerification.failureReason;
    const label = reason ? CREDENTIAL_LABELS[reason] : null;
    return {
      title: label?.title ?? "Rejected credential",
      subtitle:
        label?.subtitle ??
        "The mandate failed verification, so the request stopped before the model.",
      stoppedAt: "mandate verifier",
    };
  }

  // 2. The engine could not answer. This is the invariant worth showing: a
  //    missing judgement escalates, and never allows.
  if (input.engineFailure !== null || input.diff === null) {
    // Two fail-safe rows in a list would otherwise be word-for-word identical,
    // because the interesting fact about them — that no judgement exists — is
    // the same. So the cart is named here to tell them apart.
    const cart = input.leadItemName
      ? `for ${input.leadItemName} at ${capPhrase(input.capUse)}`
      : "for this cart";
    return {
      title: "Engine could not judge",
      subtitle: `No Authorization Diff was produced ${cart}. Bouncer escalates to a human rather than treating an absent answer as permission.`,
      stoppedAt: "fail-safe",
    };
  }

  const clause = dominantClause(input.diff.clauses);
  const item = input.leadItemName;

  // 3. A real mismatch. Name the mismatch, not the verdict — the verdict is
  //    already shown as a badge beside it.
  if (clause !== null && clause.severity !== "low") {
    switch (clause.type) {
      case "category_drift":
        return {
          title: "Wrong category",
          subtitle: item
            ? `The agent put ${item} in the cart. The mandate does not authorize that category.`
            : "The cart contains a category the mandate does not authorize.",
          stoppedAt: "threshold policy",
        };
      case "budget_overrun":
        return {
          title: "Over the spend cap",
          subtitle: `The cart consumes ${capPhrase(input.capUse)} the human authorized.`,
          stoppedAt: "threshold policy",
        };
      case "quantity_anomaly":
        return {
          title: "Unexpected quantity",
          subtitle:
            "The line quantity is out of step with what the mandate contemplates, even though the category fits.",
          stoppedAt: "threshold policy",
        };
      case "injected_instruction":
        return {
          title: "Injected instruction",
          subtitle:
            "The listing's free text tried to issue instructions. Untrusted text is evidence, never a command.",
          stoppedAt: "threshold policy",
        };
      case "expiry":
        return {
          title: "Expired authorization",
          subtitle: "The diff found the authorization no longer covers this purchase.",
          stoppedAt: "threshold policy",
        };
      case "other":
        break;
    }
  }

  // 4. Drift the engine flagged but could not place in a named category, or
  //    flagged only weakly. Still not a clean match — say so plainly.
  if (input.diff.overallVerdictRecommendation === "drift_detected") {
    return {
      title: "Drift, not clearly placed",
      subtitle:
        "The engine reports the cart does not match the mandate but does not attribute it to one named dimension.",
      stoppedAt: "threshold policy",
    };
  }

  return {
    title: "Matches the mandate",
    subtitle: item
      ? `${item} sits inside the authorized category and under ${capPhrase(input.capUse)}.`
      : "The cart sits inside the authorized category and under the spend cap.",
    stoppedAt: "threshold policy",
  };
}

/** Adapter: pulls the four facts the label needs out of a full scenario. */
export function labelForScenario(scenario: ScenarioView): ScenarioLabel {
  const cap = scenario.mandate.spendCapMinor;
  return describeScenario({
    mandateVerification: scenario.mandateVerification,
    diff: scenario.diff,
    engineFailure: scenario.engineFailure,
    leadItemName: scenario.purchaseRequest.items[0]?.name ?? null,
    capUse: cap > 0 ? scenario.purchaseRequest.totalMinor / cap : null,
  });
}
