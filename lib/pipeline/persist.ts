import { appendAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";

import { auditPayloadFor, type PipelineEvaluation } from "./evaluate";

/**
 * Writes the result of one pipeline run.
 *
 * Every path — declined credential, engine failure, threshold verdict — writes
 * exactly one PolicyDecision and exactly one AuditEvent. A STEP_UP also opens a
 * StepUpRequest. A valid mandate spends its nonce here, which is what makes the
 * replay check in the next request meaningful.
 */

export type PersistedEvaluation = {
  policyDecisionId: string;
  authorizationDiffId: string | null;
  stepUpRequestId: string | null;
  auditSequence: number;
};

function suffix(purchaseRequestId: string): string {
  return purchaseRequestId.startsWith("req_")
    ? purchaseRequestId.slice(4)
    : purchaseRequestId;
}

export async function recordEvaluation(
  evaluation: PipelineEvaluation,
  options: {
    principalId: string;
    /** Provenance for a diff that came from a real model call. */
    diffSource?: "live" | "fixture";
    decidedAt?: Date;
  },
): Promise<PersistedEvaluation> {
  const key = suffix(evaluation.purchaseRequestId);
  const decidedAt = options.decidedAt ?? new Date();
  const policyDecisionId = `dec_${key}`;
  const authorizationDiffId = evaluation.diff ? `dif_${key}` : null;

  await prisma.$transaction(async (tx) => {
    if (evaluation.diff && authorizationDiffId) {
      await tx.authorizationDiff.create({
        data: {
          id: authorizationDiffId,
          purchaseRequestId: evaluation.purchaseRequestId,
          overallVerdictRecommendation:
            evaluation.diff.overallVerdictRecommendation,
          confidence: evaluation.diff.confidence,
          summary: evaluation.diff.summary,
          source: options.diffSource ?? "live",
          // A placeholder diff records no model, no latency and no timestamp —
          // there was no model call to attribute them to.
          model:
            options.diffSource === "fixture"
              ? null
              : (evaluation.engineResult?.meta.model ?? null),
          engineLatencyMs:
            options.diffSource === "fixture"
              ? null
              : (evaluation.engineResult?.meta.latencyMs ?? null),
          computedAt: options.diffSource === "fixture" ? null : decidedAt,
          clauses: {
            create: evaluation.diff.clauses.map((clause, position) => ({
              id: `cls_${key}_${position}`,
              type: clause.type,
              severity: clause.severity,
              mandateValue: clause.mandateValue,
              attemptedValue: clause.attemptedValue,
              explanation: clause.explanation,
              position,
            })),
          },
        },
      });
    }

    if (!evaluation.engineResult?.success && evaluation.engineResult) {
      await tx.purchaseRequest.update({
        where: { id: evaluation.purchaseRequestId },
        data: {
          engineFailureReason: evaluation.engineResult.failureReason,
          engineFailureDetails: evaluation.engineResult.details,
        },
      });
    }

    await tx.policyDecision.create({
      data: {
        id: policyDecisionId,
        purchaseRequestId: evaluation.purchaseRequestId,
        outcome: evaluation.outcome,
        reason: evaluation.reason,
        authorizationDiffId,
        decidedAt,
        latencyMs: evaluation.latencyMs,
      },
    });

    // A mandate that verified has now been used. Spend its nonce, so the next
    // request presenting it is a replay.
    if (evaluation.verification.valid) {
      const mandate = await tx.mandate.findUnique({
        where: { id: evaluation.mandateId },
        select: { nonce: true },
      });
      if (mandate) {
        await tx.consumedNonce.upsert({
          where: { nonce: mandate.nonce },
          update: {},
          create: {
            nonce: mandate.nonce,
            mandateId: evaluation.mandateId,
            purchaseRequestId: evaluation.purchaseRequestId,
            consumedAt: decidedAt,
          },
        });
      }
    }

    if (evaluation.outcome === "STEP_UP") {
      await tx.stepUpRequest.create({
        data: {
          id: `stp_${key}`,
          policyDecisionId,
          principalId: options.principalId,
          status: "pending",
          respondedAt: null,
        },
      });
    }
  });

  const event = await appendAuditEvent(
    evaluation.purchaseRequestId,
    policyDecisionId,
    auditPayloadFor(evaluation, policyDecisionId),
    { eventType: "policy_decision", now: decidedAt },
  );

  return {
    policyDecisionId,
    authorizationDiffId,
    stepUpRequestId: evaluation.outcome === "STEP_UP" ? `stp_${key}` : null,
    auditSequence: event.sequence,
  };
}
