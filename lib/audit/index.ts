import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/db";
import type { AuditEventType } from "@/schemas";

import {
  canonicalise,
  hashPayload,
  reconcileRecords,
  verifyChain,
  type AuditPayload,
  type ChainVerification,
} from "./chain";

export * from "./chain";

/**
 * Audit log — Prompt 4.
 *
 * Append-only, hash-chained record of everything STEALTH decided and everything
 * a human did about it. The chain is what makes "every money action
 * explainable" checkable rather than merely asserted.
 */

export type AppendedAuditEvent = {
  id: string;
  sequence: number;
  payloadHash: string;
  previousEventHash: string | null;
};

/**
 * Appends one event. The read of the previous head and the write of the new
 * event happen in a single transaction: two concurrent appends must not both
 * claim the same predecessor, or the chain forks silently.
 */
export async function appendAuditEvent(
  purchaseRequestId: string,
  policyDecisionId: string,
  payload: AuditPayload,
  options: { eventType?: AuditEventType; now?: Date } = {},
): Promise<AppendedAuditEvent> {
  const canonical = canonicalise(payload);
  const payloadHash = hashPayload(canonical);
  const eventType = options.eventType ?? "policy_decision";
  const createdAt = options.now ?? new Date();

  return prisma.$transaction(async (tx) => {
    const head = await tx.auditEvent.findFirst({
      orderBy: { sequence: "desc" },
      select: { sequence: true, payloadHash: true },
    });

    const event = await tx.auditEvent.create({
      data: {
        id: `evt_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
        sequence: (head?.sequence ?? 0) + 1,
        purchaseRequestId,
        policyDecisionId,
        eventType,
        payload: canonical,
        payloadHash,
        // Genesis: the first event in the chain has no predecessor.
        previousEventHash: head?.payloadHash ?? null,
        createdAt,
      },
      select: {
        id: true,
        sequence: true,
        payloadHash: true,
        previousEventHash: true,
      },
    });

    return event;
  });
}

/**
 * Verifies the whole stored chain, in two independent parts.
 *
 *   1. The chain itself: no event edited, no link broken, no gap in sequence.
 *   2. The rows those events describe: the stored PolicyDecision and
 *      StepUpRequest still say what the audit event recorded.
 *
 * The second part exists because the first is not sufficient on its own. The
 * audit events live in their own table; editing a PolicyDecision from DECLINE
 * to ALLOW touches none of them, so a chain-only check reported "verified"
 * over a database whose decisions had been rewritten. Turning a block into an
 * approval after the fact is the exact thing this log is here to make
 * impossible, so it has to be part of what verification means.
 */
export async function verifyAuditChain(): Promise<ChainVerification> {
  const [events, decisions, stepUps] = await Promise.all([
    prisma.auditEvent.findMany({
      orderBy: { sequence: "asc" },
      select: {
        sequence: true,
        payload: true,
        payloadHash: true,
        previousEventHash: true,
      },
    }),
    prisma.policyDecision.findMany({
      select: {
        id: true,
        purchaseRequestId: true,
        outcome: true,
        reason: true,
      },
    }),
    prisma.stepUpRequest.findMany({ select: { id: true, status: true } }),
  ]);

  const chain = verifyChain(events);
  const drift = reconcileRecords(events, decisions, stepUps);

  return {
    valid: chain.valid && drift.length === 0,
    eventsChecked: chain.eventsChecked,
    violations: [...chain.violations, ...drift].sort(
      (a, b) => a.sequence - b.sequence,
    ),
  };
}
