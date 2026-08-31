import type { KeyObject } from "node:crypto";

import type { EngineResult } from "@/lib/ai";
import { extractEvidence, type ExtractedEvidence } from "@/lib/extraction";
import { verifyMandate, type MandateVerification } from "@/lib/mandate";
import { applyThresholdPolicy, type ThresholdRule } from "@/lib/policy";
import type {
  AuthorizationDiff,
  Mandate,
  PolicyOutcome,
  PurchaseRequest,
} from "@/schemas";

/**
 * The orchestrator: the one place the four stages compose into a verdict.
 *
 * It is pure — no database writes, no clock of its own, no client of its own.
 * Persistence lives next door in persist.ts. That split is deliberate: this is
 * the function whose behaviour has to be provable, and a function that also
 * writes rows is a function you can only test with a database.
 *
 * Stage order is a safety property, not a style choice:
 *
 *   1. Mandate Verifier   — a bad credential is declined here, and the
 *                           Intent-Cart Engine is never called. Cheap, certain,
 *                           and it means a forged mandate cannot spend a model
 *                           call, let alone reach a payment.
 *   2. Extraction         — deterministic evidence.
 *   3. Intent-Cart Engine — semantic judgement, and the only fallible stage.
 *   4. Threshold policy   — deterministic verdict over the evidence.
 *
 * THE LOCKED INVARIANT: an engine that cannot answer produces STEP_UP, never
 * ALLOW. Not a timeout, not a malformed response, not a 500, not a missing API
 * key. There is no code path in which the absence of a judgement becomes
 * permission to spend someone's money.
 */

export type PipelineStage =
  | "mandate_verifier"
  | "intent_cart_engine"
  | "threshold_policy";

export type PipelineEvaluation = {
  purchaseRequestId: string;
  mandateId: string;
  outcome: PolicyOutcome;
  reason: string;
  /** Which stage produced the outcome. */
  decidedBy: PipelineStage;
  /** Set only when the threshold policy decided. */
  rule: ThresholdRule | null;
  verification: MandateVerification;
  evidence: ExtractedEvidence | null;
  engineResult: EngineResult | null;
  diff: AuthorizationDiff | null;
  /** True when STEP_UP came from the engine failing, not from the diff. */
  failedSafe: boolean;
  latencyMs: number;
};

export type PipelineDeps = {
  /** Evaluation time, injected so expiry and timestamps are deterministic. */
  now: Date;
  resolvePublicKeyForAgent: (agentId: string) => KeyObject | null;
  nonceConsumedBy: (nonce: string) => string | null;
  /** Runs the Intent-Cart Engine. Never called for an invalid mandate. */
  runEngine: (evidence: ExtractedEvidence) => Promise<EngineResult>;
  /** Monotonic clock for latency. Injected for deterministic tests. */
  clock?: () => number;
};

export async function evaluatePurchaseRequest(
  purchaseRequest: PurchaseRequest,
  mandate: Mandate,
  deps: PipelineDeps,
): Promise<PipelineEvaluation> {
  const clock = deps.clock ?? (() => Date.now());
  const startedAt = clock();

  const base = {
    purchaseRequestId: purchaseRequest.id,
    mandateId: mandate.id,
  };

  // ---- Stage 1: Mandate Verifier -----------------------------------------
  const verification = verifyMandate(mandate, {
    now: deps.now,
    resolvePublicKeyForAgent: deps.resolvePublicKeyForAgent,
    nonceConsumedBy: deps.nonceConsumedBy,
    presentedByPurchaseRequestId: purchaseRequest.id,
  });

  if (!verification.valid) {
    return {
      ...base,
      outcome: "DECLINE",
      reason: `Mandate Verifier failed: ${verification.failureReason}. ${verification.detail}`,
      decidedBy: "mandate_verifier",
      rule: null,
      verification,
      evidence: null,
      engineResult: null,
      diff: null,
      failedSafe: false,
      latencyMs: Math.round(clock() - startedAt),
    };
  }

  // ---- Stage 2 + 3: Extraction and the Intent-Cart Engine -----------------
  const evidence = extractEvidence({ mandate, request: purchaseRequest });
  const engineResult = await deps.runEngine(evidence);

  if (!engineResult.success) {
    // The locked invariant. No judgement means no permission.
    return {
      ...base,
      outcome: "STEP_UP",
      reason: `Intent-Cart Engine could not evaluate this cart (${engineResult.failureReason}): ${engineResult.details.replace(/\.\s*$/, "")}. Escalated to the principal. An engine failure never becomes an allow.`,
      decidedBy: "intent_cart_engine",
      rule: null,
      verification,
      evidence,
      engineResult,
      diff: null,
      failedSafe: true,
      latencyMs: Math.round(clock() - startedAt),
    };
  }

  // ---- Stage 4: Threshold policy -----------------------------------------
  const decision = applyThresholdPolicy(engineResult.diff);

  return {
    ...base,
    outcome: decision.outcome,
    reason: decision.reason,
    decidedBy: "threshold_policy",
    rule: decision.rule,
    verification,
    evidence,
    engineResult,
    diff: engineResult.diff,
    failedSafe: false,
    latencyMs: Math.round(clock() - startedAt),
  };
}

/** The canonical audit payload for a pipeline decision. */
export function auditPayloadFor(
  evaluation: PipelineEvaluation,
  policyDecisionId: string,
): Record<string, unknown> {
  return {
    event: "policy_decision",
    policyDecisionId,
    purchaseRequestId: evaluation.purchaseRequestId,
    mandateId: evaluation.mandateId,
    outcome: evaluation.outcome,
    decidedBy: evaluation.decidedBy,
    rule: evaluation.rule,
    reason: evaluation.reason,
    failedSafe: evaluation.failedSafe,
    latencyMs: evaluation.latencyMs,
    mandateVerification: {
      valid: evaluation.verification.valid,
      failureReason: evaluation.verification.failureReason ?? null,
    },
    engine: evaluation.engineResult
      ? {
          success: evaluation.engineResult.success,
          model: evaluation.engineResult.meta.model,
          attempts: evaluation.engineResult.meta.attempts,
          failureReason: evaluation.engineResult.success
            ? null
            : evaluation.engineResult.failureReason,
        }
      : null,
    diff: evaluation.diff
      ? {
          overallVerdictRecommendation:
            evaluation.diff.overallVerdictRecommendation,
          confidence: evaluation.diff.confidence,
          clauses: evaluation.diff.clauses.map((clause) => ({
            type: clause.type,
            severity: clause.severity,
          })),
        }
      : null,
    cart: evaluation.evidence
      ? {
          totalMinor: evaluation.evidence.cart.totalMinor,
          capMinor: evaluation.evidence.budget.capMinor,
          injectionMarkerDetected: evaluation.evidence.injectionMarkerDetected,
        }
      : null,
  };
}
