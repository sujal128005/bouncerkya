import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/db";
import type { AuditEventType } from "@/schemas";

import {
  canonicalise,
  hashPayload,
  verifyChain,
  type AuditPayload,
  type ChainVerification,
} from "./chain";

export * from "./chain";

/**
 * Audit log — Prompt 4.
 *
 * Append-only, hash-chained record of everything Bouncer decided and everything
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

/** Verifies the whole stored chain. Pass events in to verify a set in memory. */
export async function verifyAuditChain(): Promise<ChainVerification> {
  const events = await prisma.auditEvent.findMany({
    orderBy: { sequence: "asc" },
    select: {
      sequence: true,
      payload: true,
      payloadHash: true,
      previousEventHash: true,
    },
  });

  return verifyChain(events);
}
