import { randomUUID } from "node:crypto";

import { appendAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";

import { createRazorpayOrdersApi, type RazorpayOrdersApi } from "./client";

/**
 * Order creation for an ALLOW decision.
 *
 * This is the only place in Bouncer where a decision becomes a money-moving
 * side effect, and it runs at exactly one point in the pipeline: after the
 * Policy Engine has returned ALLOW. There is no path from a DECLINE, a STEP_UP,
 * or an engine failure to this function.
 */

export type OrderResult =
  | { ok: true; razorpayOrderId: string; status: string; idempotentHit: boolean }
  | { ok: false; error: "not_configured" | "not_allowed" | "api_error"; detail: string };

export type CreateOrderInput = {
  purchaseRequestId: string;
  policyDecisionId: string;
  outcome: string;
  amountMinor: number;
  currency?: string;
  notes?: Record<string, string>;
};

/**
 * Idempotency is enforced by the database, not by hoping a retry never
 * happens: RazorpayOrder.purchaseRequestId is UNIQUE, so a second ALLOW for
 * the same request finds the existing row and returns it. The pre-check is the
 * fast path; the unique constraint is the actual guarantee, and it also settles
 * the race where two calls pass the pre-check simultaneously.
 */
export async function createOrderForDecision(
  input: CreateOrderInput,
  api?: RazorpayOrdersApi,
  options: { now?: Date } = {},
): Promise<OrderResult> {
  if (input.outcome !== "ALLOW") {
    return {
      ok: false,
      error: "not_allowed",
      detail: `refusing to create an order for a ${input.outcome} decision`,
    };
  }

  const existing = await prisma.razorpayOrder.findUnique({
    where: { purchaseRequestId: input.purchaseRequestId },
  });
  if (existing) {
    return {
      ok: true,
      razorpayOrderId: existing.razorpayOrderId,
      status: existing.status,
      idempotentHit: true,
    };
  }

  let orders: RazorpayOrdersApi;
  try {
    orders = api ?? createRazorpayOrdersApi();
  } catch (error) {
    return {
      ok: false,
      error: "not_configured",
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  const currency = input.currency ?? "INR";
  const now = options.now ?? new Date();

  let created;
  try {
    created = await orders.create({
      // Razorpay amounts are in the smallest currency unit — the same integer
      // paise Bouncer has carried end to end, so there is no conversion here.
      amount: input.amountMinor,
      currency,
      receipt: input.purchaseRequestId,
      notes: {
        bouncer_purchase_request: input.purchaseRequestId,
        bouncer_policy_decision: input.policyDecisionId,
        ...input.notes,
      },
    });
  } catch (error) {
    return {
      ok: false,
      error: "api_error",
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  try {
    await prisma.razorpayOrder.create({
      data: {
        id: `rzo_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
        purchaseRequestId: input.purchaseRequestId,
        policyDecisionId: input.policyDecisionId,
        razorpayOrderId: created.id,
        receipt: created.receipt ?? input.purchaseRequestId,
        amountMinor: created.amount,
        currency: created.currency,
        status: created.status,
        createdAt: now,
      },
    });
  } catch {
    // Lost the race: another caller inserted first. Their order is the one
    // that counts; ours is an orphan in Razorpay's test ledger, which is
    // preferable to two orders both believing they are authoritative.
    const winner = await prisma.razorpayOrder.findUnique({
      where: { purchaseRequestId: input.purchaseRequestId },
    });
    if (winner) {
      return {
        ok: true,
        razorpayOrderId: winner.razorpayOrderId,
        status: winner.status,
        idempotentHit: true,
      };
    }
    throw new Error("order row could not be written and no winner was found");
  }

  await appendAuditEvent(
    input.purchaseRequestId,
    input.policyDecisionId,
    {
      event: "razorpay_order_created",
      purchaseRequestId: input.purchaseRequestId,
      policyDecisionId: input.policyDecisionId,
      razorpayOrderId: created.id,
      amountMinor: created.amount,
      currency: created.currency,
      status: created.status,
    },
    { eventType: "razorpay_order", now },
  );

  return {
    ok: true,
    razorpayOrderId: created.id,
    status: created.status,
    idempotentHit: false,
  };
}

/** Applies a verified webhook to the stored order. */
export async function applyPaymentUpdate(update: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  paymentStatus: "captured" | "failed";
  now?: Date;
}): Promise<{ ok: boolean; detail: string }> {
  const order = await prisma.razorpayOrder.findUnique({
    where: { razorpayOrderId: update.razorpayOrderId },
  });

  if (!order) {
    return { ok: false, detail: `unknown order ${update.razorpayOrderId}` };
  }

  const now = update.now ?? new Date();

  await prisma.razorpayOrder.update({
    where: { razorpayOrderId: update.razorpayOrderId },
    data: {
      razorpayPaymentId: update.razorpayPaymentId,
      paymentStatus: update.paymentStatus,
      paymentUpdatedAt: now,
      status: update.paymentStatus === "captured" ? "paid" : order.status,
    },
  });

  await appendAuditEvent(
    order.purchaseRequestId,
    order.policyDecisionId,
    {
      event: "razorpay_payment_update",
      razorpayOrderId: update.razorpayOrderId,
      razorpayPaymentId: update.razorpayPaymentId,
      paymentStatus: update.paymentStatus,
    },
    { eventType: "razorpay_payment", now },
  );

  return { ok: true, detail: `order ${update.razorpayOrderId} -> ${update.paymentStatus}` };
}
