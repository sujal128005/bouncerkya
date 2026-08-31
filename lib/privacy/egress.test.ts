import { describe, expect, it } from "vitest";

import { extractEvidence } from "@/lib/extraction";
import { buildUserMessage, SYSTEM_PROMPT } from "@/lib/ai/prompt";
import { Mandate, PurchaseRequest } from "@/schemas";

import {
  assertNoEgress,
  EgressViolation,
  identityValues,
  type IdentityValue,
} from "./egress";

/**
 * The model-boundary tests.
 *
 * The claim on /privacy is that no identity value reaches the model provider.
 * A claim like that is worth exactly as much as the test that would fail if it
 * stopped being true, so this file builds a checkout out of deliberately
 * distinctive sentinel values and asserts that not one of them survives into
 * the outbound prompt.
 *
 * Sentinels are chosen to be unmistakable. If a test here fails, the failure
 * message names the field, and a search for the sentinel in the prompt shows
 * exactly where it got in.
 */

const SENTINELS = {
  principalName: "ZZPRINCIPALNAMEZZ",
  principalId: "prn_ZZPRINCIPALZZ",
  agentId: "agt_ZZAGENTZZ",
  mandateId: "mnd_ZZMANDATEZZ",
  requestId: "req_ZZREQUESTZZ",
  nonce: "nnc_ZZNONCEZZ0123456789",
  signature: "ed25519:ZZSIGNATUREZZ0123456789abcdefghijklmnop==",
  merchantId: "acc_ZZMERCHANTZZ",
  checkoutSurface: "srf_ZZSURFACEZZ",
};

function hostileMandate(): Mandate {
  return Mandate.parse({
    id: SENTINELS.mandateId,
    principalId: SENTINELS.principalId,
    agentId: SENTINELS.agentId,
    categoryScope: ["footwear/running-shoes"],
    spendCapMinor: 500_000,
    currency: "INR",
    expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    nonce: SENTINELS.nonce,
    signature: SENTINELS.signature,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  });
}

function hostileRequest(): PurchaseRequest {
  return PurchaseRequest.parse({
    id: SENTINELS.requestId,
    mandateId: SENTINELS.mandateId,
    agentId: SENTINELS.agentId,
    items: [
      {
        name: "Strider Flow 3 Running Shoes",
        category: "footwear/running-shoes",
        quantity: 1,
        unitPriceMinor: 449_900,
        sourceListingId: "lst_88431",
      },
    ],
    totalMinor: 449_900,
    sessionContext: {
      structuredFields: {
        merchantId: SENTINELS.merchantId,
        checkoutSurface: SENTINELS.checkoutSurface,
        listingCategory: "footwear/running-shoes",
        listingPriceMinor: 449_900,
      },
      freeText: "Breathable knit upper, 9 mm drop. Free returns within 14 days.",
      injectionMarkerDetected: false,
    },
    requestedAt: new Date("2026-08-25T06:41:12.000Z"),
  });
}

function allSentinels(): IdentityValue[] {
  return identityValues({
    purchaseRequestId: SENTINELS.requestId,
    mandateId: SENTINELS.mandateId,
    principalId: SENTINELS.principalId,
    principalDisplayName: SENTINELS.principalName,
    agentId: SENTINELS.agentId,
    nonce: SENTINELS.nonce,
    signature: SENTINELS.signature,
    sessionStructuredFields: {
      merchantId: SENTINELS.merchantId,
      checkoutSurface: SENTINELS.checkoutSurface,
    },
  });
}

describe("assertNoEgress", () => {
  it("passes a payload that contains none of the denied values", () => {
    expect(() =>
      assertNoEgress("cart total INR 4,499.00", allSentinels()),
    ).not.toThrow();
  });

  it("throws for every identity field, one at a time", () => {
    for (const entry of allSentinels()) {
      expect(() =>
        assertNoEgress(`a prompt containing ${entry.value} somewhere`, [entry]),
      ).toThrow(EgressViolation);
    }
  });

  it("names the field in the error and never the value", () => {
    let caught: unknown;
    try {
      assertNoEgress(`leaked ${SENTINELS.signature}`, allSentinels());
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EgressViolation);
    const message = (caught as EgressViolation).message;
    expect(message).toContain("mandate.signature");
    // An exception that prints the secret it caught has moved the leak from
    // the network into the log file.
    expect(message).not.toContain(SENTINELS.signature);
    expect(message).not.toContain("ZZSIGNATURE");
  });

  it("ignores values too short to match without coincidence", () => {
    // A two-character id would match inside an ordinary product name and turn
    // the guard into a source of false refusals.
    expect(() =>
      assertNoEgress("Cast Iron Skillet Set", [{ field: "shortId", value: "ir" }]),
    ).not.toThrow();
  });

  it("denies every string in the structured session block, not a hand-listed subset", () => {
    const values = identityValues({
      sessionStructuredFields: { somethingAddedLater: "acc_FUTUREFIELD_00" },
    });
    expect(values.map((v) => v.field)).toContain(
      "sessionContext.somethingAddedLater",
    );
  });

  it("does not deny non-string values in the structured block", () => {
    const values = identityValues({
      sessionStructuredFields: { listingPriceMinor: 449900 },
    });
    expect(values).toHaveLength(0);
  });
});

describe("the outbound prompt", () => {
  const evidence = extractEvidence({
    mandate: hostileMandate(),
    request: hostileRequest(),
  });
  const prompt = buildUserMessage(evidence);

  it("contains no identity value from the checkout", () => {
    expect(() => assertNoEgress(prompt, allSentinels())).not.toThrow();
  });

  it.each(Object.entries(SENTINELS))(
    "does not contain the %s sentinel",
    (_name, value) => {
      expect(prompt).not.toContain(value);
    },
  );

  it("still contains what the judgement actually needs", () => {
    // The complement of the claim. A prompt that leaked nothing because it
    // contained nothing would pass every test above and be useless.
    expect(prompt).toContain("footwear/running-shoes");
    expect(prompt).toContain("Strider Flow 3 Running Shoes");
    // The prompt formats money without a thousands separator; the console's
    // ₹4,499.00 grouping is a display concern and does not reach the model.
    expect(prompt).toContain("INR 5000.00");
    expect(prompt).toContain("INR 4499.00");
    expect(prompt).toContain("Free returns within 14 days");
  });

  it("keeps identity out of the system prompt too", () => {
    expect(() => assertNoEgress(SYSTEM_PROMPT, allSentinels())).not.toThrow();
  });

  it("refuses to build a prompt that carries the request id", () => {
    // The realistic regression: someone interpolates an id "for traceability".
    // Simulated here by a cart line that carries it, which is the only way to
    // get the value into the template from outside.
    const request = hostileRequest();
    const poisoned = PurchaseRequest.parse({
      ...request,
      items: [{ ...request.items[0], name: `Shoes ${SENTINELS.requestId}` }],
    });
    const poisonedEvidence = extractEvidence({
      mandate: hostileMandate(),
      request: poisoned,
    });
    expect(() => buildUserMessage(poisonedEvidence)).toThrow(EgressViolation);
  });

  it("fails safe rather than silently sending", () => {
    // The composition that makes this control worth having: the guard throws
    // before the HTTP call, the engine reports a failure, and the locked
    // invariant turns an engine failure into STEP_UP. A privacy regression
    // degrades into a human approval, never into a leak and never into a
    // purchase.
    const request = hostileRequest();
    const poisoned = PurchaseRequest.parse({
      ...request,
      items: [{ ...request.items[0], name: `Shoes ${SENTINELS.mandateId}` }],
    });
    let threw = false;
    try {
      buildUserMessage(
        extractEvidence({ mandate: hostileMandate(), request: poisoned }),
      );
    } catch (error) {
      threw = error instanceof EgressViolation;
    }
    expect(threw).toBe(true);
  });
});
