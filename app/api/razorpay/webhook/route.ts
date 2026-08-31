import { NextResponse } from "next/server";

import {
  SIGNATURE_HEADER,
  applyPaymentUpdate,
  parseWebhookEvent,
  verifyWebhookSignature,
} from "@/lib/razorpay";

/**
 * Razorpay webhook receiver.
 *
 * The raw body is read as text and verified byte-for-byte before anything
 * parses it. Re-serialising the JSON first would change the bytes and break
 * every signature — and, worse, would mean acting on unverified input.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "not_configured", detail: "RAZORPAY_WEBHOOK_SECRET is not set" },
      { status: 503 },
    );
  }

  const rawBody = await request.text();
  const signature = request.headers.get(SIGNATURE_HEADER);

  if (!verifyWebhookSignature(rawBody, signature, secret)) {
    return NextResponse.json(
      { error: "invalid_signature" },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const event = parseWebhookEvent(body);
  if (!event) {
    // Signature was valid but the event is one we do not act on. 200 so
    // Razorpay stops retrying.
    return NextResponse.json({ ok: true, handled: false });
  }

  // Razorpay retries on any non-2xx, so an unhandled throw here becomes a
  // retry storm against a database that is already unhappy. Fail with a 500
  // deliberately — a retry of a webhook we did not apply is correct and safe,
  // because applyPaymentUpdate is keyed on the Razorpay order id and applying
  // the same event twice converges on the same row.
  try {
    const result = await applyPaymentUpdate({
      razorpayOrderId: event.razorpayOrderId,
      razorpayPaymentId: event.razorpayPaymentId,
      paymentStatus: event.kind === "payment.captured" ? "captured" : "failed",
    });

    return NextResponse.json({ ok: result.ok, handled: true, detail: result.detail }, {
      status: result.ok ? 200 : 404,
    });
  } catch (error: unknown) {
    console.error("[razorpay.webhook] failed to apply payment update", {
      razorpayOrderId: event.razorpayOrderId,
      kind: event.kind,
      error,
    });
    return NextResponse.json(
      { error: "internal_error", detail: "Could not apply the payment update." },
      { status: 500 },
    );
  }
}
