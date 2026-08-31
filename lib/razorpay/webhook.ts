import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Razorpay webhook signature verification.
 *
 * Razorpay signs the raw request body with the webhook secret using
 * HMAC-SHA256 and sends the hex digest in `x-razorpay-signature`. The body
 * must be verified byte-for-byte as received: re-serialising parsed JSON
 * changes the bytes and every signature would fail.
 */

export const SIGNATURE_HEADER = "x-razorpay-signature";

export function computeWebhookSignature(
  rawBody: string,
  secret: string,
): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

/** Constant-time comparison. A fast string compare leaks the signature. */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string | null | undefined,
  secret: string,
): boolean {
  if (!signature || !secret) return false;

  const expected = Buffer.from(computeWebhookSignature(rawBody, secret), "utf8");
  const received = Buffer.from(signature, "utf8");

  if (expected.length !== received.length) return false;

  try {
    return timingSafeEqual(expected, received);
  } catch {
    return false;
  }
}

export type WebhookEventKind = "payment.captured" | "payment.failed";

export type ParsedWebhookEvent = {
  kind: WebhookEventKind;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  amountMinor: number;
  errorDescription: string | null;
};

const HANDLED: WebhookEventKind[] = ["payment.captured", "payment.failed"];

/**
 * Extracts the fields we act on from Razorpay's documented payload shape.
 * Returns null for events we do not handle, and for anything malformed —
 * a webhook body is untrusted input even after the signature checks out.
 */
export function parseWebhookEvent(body: unknown): ParsedWebhookEvent | null {
  if (body === null || typeof body !== "object") return null;

  const event = (body as { event?: unknown }).event;
  if (typeof event !== "string") return null;
  if (!HANDLED.includes(event as WebhookEventKind)) return null;

  const payment = (
    body as {
      payload?: { payment?: { entity?: Record<string, unknown> } };
    }
  ).payload?.payment?.entity;

  if (!payment) return null;

  const razorpayOrderId = payment.order_id;
  const razorpayPaymentId = payment.id;
  const amount = payment.amount;

  if (typeof razorpayOrderId !== "string" || typeof razorpayPaymentId !== "string") {
    return null;
  }

  return {
    kind: event as WebhookEventKind,
    razorpayOrderId,
    razorpayPaymentId,
    amountMinor: typeof amount === "number" ? amount : 0,
    errorDescription:
      typeof payment.error_description === "string"
        ? payment.error_description
        : null,
  };
}
