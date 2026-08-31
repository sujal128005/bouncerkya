import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createTempDatabase } from "@/lib/test-support/temp-database";

import {
  computeWebhookSignature,
  parseWebhookEvent,
  verifyWebhookSignature,
} from "./webhook";
import { isTestModeKey } from "./client";

const SECRET = "whsec_test_secret";

/** Razorpay's documented payment.captured shape, trimmed to what we read. */
const CAPTURED = {
  entity: "event",
  event: "payment.captured",
  payload: {
    payment: {
      entity: {
        id: "pay_TEST123",
        order_id: "order_TEST123",
        amount: 449900,
        currency: "INR",
        status: "captured",
      },
    },
  },
};

describe("webhook signature verification", () => {
  it("accepts a signature computed over the exact raw body", () => {
    const raw = JSON.stringify(CAPTURED);
    expect(verifyWebhookSignature(raw, computeWebhookSignature(raw, SECRET), SECRET)).toBe(true);
  });

  it("rejects a body altered after signing, even by one character", () => {
    const raw = JSON.stringify(CAPTURED);
    const signature = computeWebhookSignature(raw, SECRET);
    const tampered = raw.replace('"amount":449900', '"amount":1');

    expect(verifyWebhookSignature(tampered, signature, SECRET)).toBe(false);
  });

  it("rejects a signature made with a different secret", () => {
    const raw = JSON.stringify(CAPTURED);
    expect(
      verifyWebhookSignature(raw, computeWebhookSignature(raw, "wrong"), SECRET),
    ).toBe(false);
  });

  it("rejects a missing, empty or malformed signature", () => {
    const raw = JSON.stringify(CAPTURED);
    expect(verifyWebhookSignature(raw, null, SECRET)).toBe(false);
    expect(verifyWebhookSignature(raw, undefined, SECRET)).toBe(false);
    expect(verifyWebhookSignature(raw, "", SECRET)).toBe(false);
    expect(verifyWebhookSignature(raw, "not-hex", SECRET)).toBe(false);
  });

  it("rejects everything when no secret is configured", () => {
    const raw = JSON.stringify(CAPTURED);
    expect(verifyWebhookSignature(raw, computeWebhookSignature(raw, SECRET), "")).toBe(false);
  });

  it("re-serialising the body breaks the signature — verify raw bytes", () => {
    const raw = JSON.stringify(CAPTURED, null, 2);
    const signature = computeWebhookSignature(raw, SECRET);
    expect(verifyWebhookSignature(JSON.stringify(CAPTURED), signature, SECRET)).toBe(false);
  });
});

describe("webhook payload parsing", () => {
  it("reads a payment.captured event", () => {
    expect(parseWebhookEvent(CAPTURED)).toEqual({
      kind: "payment.captured",
      razorpayOrderId: "order_TEST123",
      razorpayPaymentId: "pay_TEST123",
      amountMinor: 449900,
      errorDescription: null,
    });
  });

  it("reads a payment.failed event with its error description", () => {
    const failed = {
      event: "payment.failed",
      payload: {
        payment: {
          entity: {
            id: "pay_F",
            order_id: "order_F",
            amount: 1000,
            error_description: "Payment declined by bank",
          },
        },
      },
    };
    expect(parseWebhookEvent(failed)).toMatchObject({
      kind: "payment.failed",
      errorDescription: "Payment declined by bank",
    });
  });

  it("ignores events we do not act on", () => {
    expect(parseWebhookEvent({ event: "order.paid", payload: {} })).toBeNull();
    expect(parseWebhookEvent({ event: "subscription.charged" })).toBeNull();
  });

  it("returns null for malformed bodies rather than throwing", () => {
    for (const body of [null, undefined, 42, "x", {}, { event: "payment.captured" }]) {
      expect(parseWebhookEvent(body)).toBeNull();
    }
  });
});

describe("key mode guard", () => {
  it("recognises test keys and rejects anything else", () => {
    expect(isTestModeKey("rzp_test_abc123")).toBe(true);
    expect(isTestModeKey("rzp_live_abc123")).toBe(false);
    expect(isTestModeKey("abc123")).toBe(false);
  });
});

/* ------------------------------------------- order creation + idempotency */

type Mod = {
  prisma: typeof import("@/lib/db").prisma;
  createOrderForDecision: typeof import("./orders").createOrderForDecision;
  applyPaymentUpdate: typeof import("./orders").applyPaymentUpdate;
  verifyAuditChain: typeof import("@/lib/audit").verifyAuditChain;
};

let mod: Mod;
let cleanup: () => void;

beforeAll(async () => {
  ({ cleanup } = createTempDatabase());

  const [db, orders, audit] = await Promise.all([
    import("@/lib/db"),
    import("./orders"),
    import("@/lib/audit"),
  ]);
  mod = {
    prisma: db.prisma,
    createOrderForDecision: orders.createOrderForDecision,
    applyPaymentUpdate: orders.applyPaymentUpdate,
    verifyAuditChain: audit.verifyAuditChain,
  };

  const { prisma } = mod;
  await prisma.principal.create({ data: { id: "prn_1", displayName: "T" } });
  await prisma.agent.create({
    data: { id: "agt_1", operatorName: "T", platform: "t", publicKeyRef: "kms://t" },
  });
  await prisma.mandate.create({
    data: {
      id: "mnd_1", principalId: "prn_1", agentId: "agt_1",
      categoryScope: '["footwear/running-shoes"]', spendCapMinor: 500_000,
      currency: "INR", expiresAt: new Date("2027-01-01"), nonce: "nnc_1",
      signature: "ed25519:AA", createdAt: new Date("2026-08-01"),
    },
  });
  await prisma.purchaseRequest.create({
    data: {
      id: "req_1", mandateId: "mnd_1", agentId: "agt_1", totalMinor: 449_900,
      sessionStructuredFields: "{}", sessionFreeText: null,
      injectionMarkerDetected: false, requestedAt: new Date("2026-08-25"),
    },
  });
  await prisma.policyDecision.create({
    data: {
      id: "dec_1", purchaseRequestId: "req_1", outcome: "ALLOW",
      reason: "clean", authorizationDiffId: null,
      decidedAt: new Date("2026-08-25"), latencyMs: 10,
    },
  });
});

afterAll(async () => {
  await mod.prisma.$disconnect();
  cleanup();
});

function fakeApi() {
  const create = vi.fn(async (params: { amount: number; receipt: string }) => ({
    id: `order_${params.receipt}`,
    amount: params.amount,
    currency: "INR",
    receipt: params.receipt,
    status: "created",
  }));
  return { create };
}

const INPUT = {
  purchaseRequestId: "req_1",
  policyDecisionId: "dec_1",
  outcome: "ALLOW",
  amountMinor: 449_900,
};

describe("order creation", () => {
  it("refuses to create an order for anything but ALLOW", async () => {
    const api = fakeApi();
    for (const outcome of ["DECLINE", "STEP_UP"]) {
      const result = await mod.createOrderForDecision({ ...INPUT, outcome }, api);
      expect(result).toMatchObject({ ok: false, error: "not_allowed" });
    }
    expect(api.create).not.toHaveBeenCalled();
  });

  it("creates an order for an ALLOW, in paise, with the request id as receipt", async () => {
    const api = fakeApi();
    const result = await mod.createOrderForDecision(INPUT, api);

    expect(result).toMatchObject({ ok: true, idempotentHit: false, status: "created" });
    expect(api.create).toHaveBeenCalledTimes(1);
    expect(api.create.mock.calls[0][0]).toMatchObject({
      amount: 449_900,
      currency: "INR",
      receipt: "req_1",
    });
  });

  it("IS IDEMPOTENT — a retried ALLOW does not create a second order", async () => {
    const api = fakeApi();
    const again = await mod.createOrderForDecision(INPUT, api);

    expect(again).toMatchObject({ ok: true, idempotentHit: true });
    expect(api.create).not.toHaveBeenCalled();

    const rows = await mod.prisma.razorpayOrder.findMany({
      where: { purchaseRequestId: "req_1" },
    });
    expect(rows).toHaveLength(1);
  });

  it("reports an API failure instead of pretending an order exists", async () => {
    await mod.prisma.razorpayOrder.deleteMany({ where: { purchaseRequestId: "req_1" } });
    const api = {
      create: vi.fn(async () => {
        throw new Error("502 Bad Gateway");
      }),
    };

    const result = await mod.createOrderForDecision(INPUT, api);
    expect(result).toMatchObject({ ok: false, error: "api_error" });
    expect(await mod.prisma.razorpayOrder.count()).toBe(0);
  });

  it("records order creation in the append-only audit chain", async () => {
    await mod.createOrderForDecision(INPUT, fakeApi());
    const events = await mod.prisma.auditEvent.findMany({
      where: { eventType: "razorpay_order" },
      orderBy: { sequence: "asc" },
    });

    // Two: one for the order created earlier in this file, one for the order
    // just created. The first order's ROW was deleted to test the API-failure
    // path, but its audit event survives — that is what append-only means.
    expect(events).toHaveLength(2);
    expect(await mod.prisma.razorpayOrder.count()).toBe(1);
    expect((await mod.verifyAuditChain()).valid).toBe(true);
  });

  it("applies a captured payment and keeps the chain valid", async () => {
    const result = await mod.applyPaymentUpdate({
      razorpayOrderId: "order_req_1",
      razorpayPaymentId: "pay_X",
      paymentStatus: "captured",
    });
    expect(result.ok).toBe(true);

    const row = await mod.prisma.razorpayOrder.findUniqueOrThrow({
      where: { razorpayOrderId: "order_req_1" },
    });
    expect(row.paymentStatus).toBe("captured");
    expect(row.status).toBe("paid");
    expect((await mod.verifyAuditChain()).valid).toBe(true);
  });

  it("ignores a payment update for an unknown order", async () => {
    const result = await mod.applyPaymentUpdate({
      razorpayOrderId: "order_nope",
      razorpayPaymentId: "pay_Y",
      paymentStatus: "captured",
    });
    expect(result.ok).toBe(false);
  });
});
