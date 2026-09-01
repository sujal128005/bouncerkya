import { z } from "zod";
import { Id, Timestamp } from "./primitives";

/** The only three things STEALTH may do with a checkout attempt. */
export const PolicyOutcome = z.enum(["ALLOW", "STEP_UP", "DECLINE"]);

export const PolicyDecision = z.object({
  id: Id,
  purchaseRequestId: Id,
  outcome: PolicyOutcome,
  reason: z.string().min(1),
  /**
   * Null when the request never reached the Intent-Cart Engine — a mandate
   * that fails verification is declined before any diff exists to reference.
   */
  authorizationDiffId: Id.nullable(),
  decidedAt: Timestamp,
  /** Wall-clock time from request received to decision emitted. */
  latencyMs: z.number().int().nonnegative(),
});

export const StepUpStatus = z.enum([
  "pending",
  "approved",
  "rejected",
  "expired",
]);

/** A STEP_UP decision escalated to the principal for a human answer. */
export const StepUpRequest = z.object({
  id: Id,
  policyDecisionId: Id,
  principalId: Id,
  status: StepUpStatus,
  respondedAt: Timestamp.nullable(),
});

/**
 * One link in the append-only audit chain. Hash chaining itself is the
 * Audit Log, reserved for Prompt 4 — this schema only fixes the shape.
 */
export const AuditEventType = z.enum([
  "policy_decision",
  "step_up_response",
  "razorpay_order",
  "razorpay_payment",
]);

export const AuditEvent = z.object({
  id: Id,
  /** Chain position, 1-based. A hash chain needs a total order. */
  sequence: z.number().int().positive(),
  purchaseRequestId: Id,
  policyDecisionId: Id,
  eventType: AuditEventType,
  /** Canonical JSON the hash is taken over; stored so the chain is verifiable. */
  payload: z.string().min(1),
  payloadHash: z.string().min(1),
  previousEventHash: z.string().min(1).nullable(),
  createdAt: Timestamp,
});

export type PolicyOutcome = z.infer<typeof PolicyOutcome>;
export type PolicyDecision = z.infer<typeof PolicyDecision>;
export type StepUpStatus = z.infer<typeof StepUpStatus>;
export type StepUpRequest = z.infer<typeof StepUpRequest>;
export type AuditEventType = z.infer<typeof AuditEventType>;
export type AuditEvent = z.infer<typeof AuditEvent>;
