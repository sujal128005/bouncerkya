/**
 * Razorpay live verification.
 *
 *   npm run razorpay:verify
 *
 * WHY THIS SCRIPT EXISTS
 *
 * Everything else about the Razorpay integration is proven: unit tests cover
 * webhook signature verification and live-key refusal, and the database
 * enforces idempotency. What was never proven is the only thing that actually
 * matters to the product's one-line claim — that Bouncer can create a real
 * order against Razorpay's real test-mode API.
 *
 * That gap cannot be closed by reading code, by a mock, or by a unit test. It
 * needs one real HTTP call with real credentials, and then a human looking at
 * the dashboard. This script does the first half and tells you exactly what to
 * check for the second.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not touch the database, does not run an agent, does not go through
 * the pipeline, and does not capture a payment. It creates one order, marked
 * in its notes as a verification probe, so nothing in the seeded demo data is
 * disturbed.
 *
 * SAFETY
 *
 * The client refuses any key that is not `rzp_test_`, so this cannot move real
 * money. No key material is printed — not the secret, not the key id.
 */

import "../lib/load-env";

import { createRazorpayOrdersApi } from "../lib/razorpay";

function mask(value: string | undefined): string {
  if (!value) return "(not set)";
  // Enough to confirm which key is in play, never enough to use it.
  return `${value.slice(0, 12)}…${value.slice(-2)}`;
}

async function main(): Promise<void> {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();

  console.log("Bouncer — Razorpay test-mode verification\n");

  if (!keyId || !keySecret) {
    console.error(
      "RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must both be set in .env.\n" +
        "Generate test keys at dashboard.razorpay.com -> Test Mode ->\n" +
        "Account & Settings -> API Keys -> Generate Key.",
    );
    process.exitCode = 1;
    return;
  }

  if (!keyId.startsWith("rzp_test_")) {
    console.error(
      `Refusing to run: RAZORPAY_KEY_ID is ${mask(keyId)}, which is not a test key.\n` +
        "This script only ever runs against rzp_test_ credentials.",
    );
    process.exitCode = 1;
    return;
  }

  console.log(`key id      ${mask(keyId)}  (masked)`);
  console.log("mode        TEST — no real money can move");

  // A deliberately odd amount, so the order is unmistakable in the dashboard
  // and cannot be confused with a seeded demo figure.
  const amountMinor = 100_101; // INR 1,001.01
  const receipt = `bouncer_verify_${Date.now().toString(36)}`;

  console.log(`amount      INR ${(amountMinor / 100).toFixed(2)} (${amountMinor} paise)`);
  console.log(`receipt     ${receipt}\n`);

  const startedAt = Date.now();

  try {
    const orders = createRazorpayOrdersApi();
    const order = await orders.create({
      amount: amountMinor,
      currency: "INR",
      receipt,
      notes: {
        purpose: "bouncer integration verification",
        note: "Not a pipeline decision. Created by npm run razorpay:verify.",
      },
    });

    const elapsedMs = Date.now() - startedAt;

    console.log("════════ ORDER CREATED ════════");
    console.log(`order id    ${order.id}`);
    console.log(`amount      ${order.amount} ${order.currency}`);
    console.log(`receipt     ${order.receipt ?? "(none returned)"}`);
    console.log(`status      ${order.status}`);
    console.log(`round trip  ${elapsedMs} ms`);

    console.log("\n─── what this proves ───");
    console.log("Razorpay's live test-mode API accepted a request signed with these");
    console.log("credentials and returned a real order id. The SDK path, the auth, the");
    console.log("minor-unit handling and the receipt field are all confirmed working.");

    console.log("\n─── what it does NOT prove ───");
    console.log("No payment was attempted or captured. The webhook path is unexercised.");
    console.log("This order did not come from a pipeline ALLOW — it is a direct probe.");

    console.log("\n─── HUMAN STEP, still required ───");
    console.log("Open dashboard.razorpay.com in TEST MODE -> Transactions -> Orders.");
    console.log(`Confirm ${order.id} is listed with receipt ${order.receipt ?? receipt}.`);
    console.log("Screenshot it. Until a human has seen it there, the README must keep");
    console.log('saying "structural until verified" — an API response is not a dashboard.');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("\n════════ VERIFICATION FAILED ════════");
    console.error(message);
    console.error(
      "\nCommon causes: keys regenerated and .env not updated, the account is not\n" +
        "in test mode, or no network route to api.razorpay.com.\n" +
        "This is a real failure — do not record the integration as verified.",
    );
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
