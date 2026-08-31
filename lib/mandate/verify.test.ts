import { describe, expect, it } from "vitest";

import { Mandate } from "@/schemas";

import {
  exportPublicKey,
  generateAgentKeyPair,
  importPublicKey,
  resolvePublicKey,
  signMandate,
  tamperSignature,
  type AgentKeystore,
} from "./keys";
import {
  verifyMandate,
  type MandateVerificationContext,
} from "./verify";

const AGENT_ID = "agt_vega_01";
const KEY_REF = "kms://bouncer/agent-keys/vega-01";
const NOW = new Date("2026-08-25T10:00:00.000Z");

const keyPair = generateAgentKeyPair();
const otherKeyPair = generateAgentKeyPair();

const keystore: AgentKeystore = {
  [KEY_REF]: exportPublicKey(keyPair.publicKey),
};

function buildMandate(overrides: Partial<Mandate> = {}): Mandate {
  const unsigned = {
    id: "mnd_TEST01",
    principalId: "prn_TEST01",
    agentId: AGENT_ID,
    categoryScope: ["footwear/running-shoes"],
    spendCapMinor: 500_000,
    currency: "INR" as const,
    expiresAt: new Date("2026-09-30T18:29:59.000Z"),
    nonce: "nnc_test_0001",
    createdAt: new Date("2026-08-20T11:04:22.000Z"),
    ...overrides,
  };

  return Mandate.parse({
    ...unsigned,
    signature: overrides.signature ?? signMandate(unsigned, keyPair.privateKey),
  });
}

function buildContext(
  overrides: Partial<MandateVerificationContext> = {},
): MandateVerificationContext {
  return {
    now: NOW,
    resolvePublicKeyForAgent: (agentId) =>
      agentId === AGENT_ID ? resolvePublicKey(keystore, KEY_REF) : null,
    nonceConsumedBy: () => null,
    ...overrides,
  };
}

describe("verifyMandate", () => {
  it("accepts a correctly signed, unexpired, unused mandate", () => {
    const result = verifyMandate(buildMandate(), buildContext());

    expect(result.valid).toBe(true);
    expect(result.failureReason).toBeUndefined();
    expect(result.checks.map((check) => check.status)).toEqual([
      "pass",
      "pass",
      "pass",
      "pass",
    ]);
  });

  it("rejects a mandate whose signature has been tampered with", () => {
    const genuine = buildMandate();
    const tampered = buildMandate({
      signature: tamperSignature(genuine.signature),
    });

    const result = verifyMandate(tampered, buildContext());

    expect(result.valid).toBe(false);
    expect(result.failureReason).toBe("invalid_signature");
  });

  it("rejects a mandate signed with a different agent's key", () => {
    const unsigned = {
      id: "mnd_TEST02",
      principalId: "prn_TEST01",
      agentId: AGENT_ID,
      categoryScope: ["footwear/running-shoes"],
      spendCapMinor: 500_000,
      currency: "INR" as const,
      expiresAt: new Date("2026-09-30T18:29:59.000Z"),
      nonce: "nnc_test_0002",
      createdAt: new Date("2026-08-20T11:04:22.000Z"),
    };
    const impostor = Mandate.parse({
      ...unsigned,
      signature: signMandate(unsigned, otherKeyPair.privateKey),
    });

    expect(verifyMandate(impostor, buildContext()).failureReason).toBe(
      "invalid_signature",
    );
  });

  it("fails closed when the agent has no key on file", () => {
    const result = verifyMandate(
      buildMandate(),
      buildContext({ resolvePublicKeyForAgent: () => null }),
    );

    expect(result.valid).toBe(false);
    expect(result.failureReason).toBe("invalid_signature");
  });

  it("rejects an expired mandate", () => {
    const result = verifyMandate(
      buildMandate({
        nonce: "nnc_test_0003",
        expiresAt: new Date("2026-07-31T18:29:59.000Z"),
      }),
      buildContext(),
    );

    expect(result.valid).toBe(false);
    expect(result.failureReason).toBe("expired");
  });

  it("treats a mandate expiring exactly now as expired", () => {
    const result = verifyMandate(
      buildMandate({ nonce: "nnc_test_0004", expiresAt: NOW }),
      buildContext(),
    );

    expect(result.failureReason).toBe("expired");
  });

  it("accepts first use of a nonce and rejects the second", () => {
    const mandate = buildMandate({ nonce: "nnc_test_single_use" });
    const consumed = new Map<string, string>();

    const context = (presentedBy: string): MandateVerificationContext =>
      buildContext({
        nonceConsumedBy: (nonce) => consumed.get(nonce) ?? null,
        presentedByPurchaseRequestId: presentedBy,
      });

    const first = verifyMandate(mandate, context("req_FIRST"));
    expect(first.valid).toBe(true);

    // The first successful verification spends the nonce.
    consumed.set(mandate.nonce, "req_FIRST");

    const replay = verifyMandate(mandate, context("req_SECOND"));
    expect(replay.valid).toBe(false);
    expect(replay.failureReason).toBe("replayed_nonce");

    // Re-reading the request that spent it is not a replay of itself.
    expect(verifyMandate(mandate, context("req_FIRST")).valid).toBe(true);
  });

  it("returns a typed failure for a malformed mandate instead of throwing", () => {
    for (const candidate of [
      null,
      undefined,
      42,
      "mandate",
      {},
      { ...buildMandate(), spendCapMinor: 4999.5 },
      { ...buildMandate(), currency: "USD" },
      { ...buildMandate(), categoryScope: [] },
    ]) {
      const result = verifyMandate(candidate, buildContext());
      expect(result.valid).toBe(false);
      expect(result.failureReason).toBe("malformed");
      expect(result.detail).toBeTruthy();
    }
  });

  it("applies checks fail-fast: signature wins over expiry", () => {
    const expired = buildMandate({
      nonce: "nnc_test_0005",
      expiresAt: new Date("2026-07-31T18:29:59.000Z"),
    });
    const bothWrong = buildMandate({
      nonce: "nnc_test_0005",
      expiresAt: new Date("2026-07-31T18:29:59.000Z"),
      signature: tamperSignature(expired.signature),
    });

    const result = verifyMandate(bothWrong, buildContext());

    expect(result.failureReason).toBe("invalid_signature");
    expect(result.checks).toEqual([
      expect.objectContaining({ check: "malformed", status: "pass" }),
      expect.objectContaining({ check: "signature", status: "fail" }),
      expect.objectContaining({ check: "expiry", status: "not_evaluated" }),
      expect.objectContaining({ check: "replay", status: "not_evaluated" }),
    ]);
  });

  it("does not look at cart, category or budget", () => {
    // A mandate is valid or not on its own terms. There is no cart here at all
    // — that comparison is the Intent-Cart Engine's job (Prompt 3).
    const cheap = buildMandate({ nonce: "nnc_a", spendCapMinor: 1 });
    const generous = buildMandate({ nonce: "nnc_b", spendCapMinor: 100_000_000 });

    expect(verifyMandate(cheap, buildContext()).valid).toBe(true);
    expect(verifyMandate(generous, buildContext()).valid).toBe(true);
  });
});

describe("keystore", () => {
  it("round-trips a public key through SPKI DER", () => {
    const encoded = exportPublicKey(keyPair.publicKey);
    const restored = importPublicKey(encoded);

    expect(exportPublicKey(restored)).toBe(encoded);
  });

  it("returns null for an unknown or corrupt key reference", () => {
    expect(resolvePublicKey(keystore, "kms://bouncer/agent-keys/nope")).toBeNull();
    expect(resolvePublicKey({ bad: "not-a-key" }, "bad")).toBeNull();
  });
});
