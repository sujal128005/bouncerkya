import { describe, expect, it } from "vitest";

import {
  canonicalise,
  hashPayload,
  verifyChain,
  type ChainEvent,
} from "./chain";

/** Builds a well-formed chain the way appendAuditEvent would. */
function buildChain(payloads: Record<string, unknown>[]): ChainEvent[] {
  const events: ChainEvent[] = [];
  let previousEventHash: string | null = null;

  payloads.forEach((payload, index) => {
    const canonical = canonicalise(payload);
    const payloadHash = hashPayload(canonical);
    events.push({
      sequence: index + 1,
      payload: canonical,
      payloadHash,
      previousEventHash,
    });
    previousEventHash = payloadHash;
  });

  return events;
}

const PAYLOADS = [
  { event: "policy_decision", purchaseRequestId: "req_A", outcome: "ALLOW" },
  { event: "policy_decision", purchaseRequestId: "req_B", outcome: "DECLINE" },
  { event: "policy_decision", purchaseRequestId: "req_C", outcome: "STEP_UP" },
];

describe("canonicalisation", () => {
  it("is independent of key order", () => {
    expect(canonicalise({ a: 1, b: 2 })).toBe(canonicalise({ b: 2, a: 1 }));
  });

  it("sorts keys at every depth", () => {
    expect(canonicalise({ x: { z: 1, y: 2 } })).toBe('{"x":{"y":2,"z":1}}');
  });

  it("preserves array order, which is meaningful", () => {
    expect(canonicalise({ c: [3, 1, 2] })).toBe('{"c":[3,1,2]}');
  });

  it("hashes differently when a value changes", () => {
    expect(hashPayload(canonicalise({ outcome: "ALLOW" }))).not.toBe(
      hashPayload(canonicalise({ outcome: "DECLINE" })),
    );
  });
});

describe("verifyChain", () => {
  it("accepts an untouched chain", () => {
    const result = verifyChain(buildChain(PAYLOADS));
    expect(result.valid).toBe(true);
    expect(result.eventsChecked).toBe(3);
    expect(result.violations).toEqual([]);
  });

  it("accepts an empty chain", () => {
    expect(verifyChain([]).valid).toBe(true);
  });

  it("requires the genesis event to have a null predecessor", () => {
    const chain = buildChain(PAYLOADS);
    chain[0].previousEventHash = "deadbeef";

    const result = verifyChain(chain);
    expect(result.valid).toBe(false);
    expect(result.violations[0].kind).toBe("genesis_not_null");
  });

  it("CATCHES A TAMPERED PAYLOAD — the whole point of the chain", () => {
    const chain = buildChain(PAYLOADS);

    // Someone edits history: the DECLINE quietly becomes an ALLOW.
    chain[1].payload = canonicalise({
      event: "policy_decision",
      purchaseRequestId: "req_B",
      outcome: "ALLOW",
    });

    const result = verifyChain(chain);
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      sequence: 2,
      kind: "hash_mismatch",
    });
  });

  it("catches a tampered payload even when its hash is recomputed to match", () => {
    const chain = buildChain(PAYLOADS);

    // A more careful forger: edit the payload AND fix its own hash.
    const forged = canonicalise({
      event: "policy_decision",
      purchaseRequestId: "req_B",
      outcome: "ALLOW",
    });
    chain[1].payload = forged;
    chain[1].payloadHash = hashPayload(forged);

    // Now event 2 hashes correctly, but event 3 still points at the old hash.
    const result = verifyChain(chain);
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      sequence: 3,
      kind: "broken_link",
    });
  });

  it("catches a deleted event", () => {
    const chain = buildChain(PAYLOADS);
    const withHole = [chain[0], chain[2]];

    const result = verifyChain(withHole);
    expect(result.valid).toBe(false);
    expect(result.violations.map((v) => v.kind)).toContain("sequence_gap");
    expect(result.violations.map((v) => v.kind)).toContain("broken_link");
  });

  it("catches a reordered chain", () => {
    const chain = buildChain(PAYLOADS);
    const swapped = [chain[0], { ...chain[2], sequence: 2 }, { ...chain[1], sequence: 3 }];

    expect(verifyChain(swapped).valid).toBe(false);
  });

  it("verifies regardless of the order events are handed to it", () => {
    const chain = buildChain(PAYLOADS);
    expect(verifyChain([chain[2], chain[0], chain[1]]).valid).toBe(true);
  });
});
