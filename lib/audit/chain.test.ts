import { describe, expect, it } from "vitest";

import {
  canonicalise,
  hashPayload,
  reconcileRecords,
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

/*
 * A hash chain proves its own events were not edited. It proves nothing about
 * the rows those events describe, and the rows are where the money decision
 * actually lives. Before reconcileRecords existed, changing one PolicyDecision
 * from DECLINE to ALLOW in the database left verifyChain reporting "verified",
 * which is the one outcome an audit log exists to prevent.
 */
describe("reconciling the chain against the rows it describes", () => {
  const DECISION_EVENT = {
    event: "policy_decision",
    policyDecisionId: "dec_1",
    purchaseRequestId: "req_1",
    outcome: "DECLINE",
    reason: "Cart is outside the mandate.",
  };
  const STEP_UP_EVENT = {
    event: "step_up_response",
    stepUpRequestId: "stp_1",
    policyDecisionId: "dec_1",
    purchaseRequestId: "req_1",
    status: "approved",
  };

  const events = buildChain([DECISION_EVENT, STEP_UP_EVENT]);
  const DECISION = {
    id: "dec_1",
    purchaseRequestId: "req_1",
    outcome: "DECLINE",
    reason: "Cart is outside the mandate.",
  };
  const STEP_UP = { id: "stp_1", status: "approved" };

  it("is silent when the rows still agree with the record", () => {
    expect(reconcileRecords(events, [DECISION], [STEP_UP])).toEqual([]);
  });

  it("catches a DECLINE quietly turned into an ALLOW", () => {
    const drift = reconcileRecords(
      events,
      [{ ...DECISION, outcome: "ALLOW" }],
      [STEP_UP],
    );
    expect(drift).toHaveLength(1);
    expect(drift[0].kind).toBe("record_drift");
    expect(drift[0].detail).toContain("ALLOW");
    expect(drift[0].detail).toContain("DECLINE");
  });

  it("catches a rewritten justification even when the outcome is untouched", () => {
    const drift = reconcileRecords(
      events,
      [{ ...DECISION, reason: "Looks fine to me." }],
      [STEP_UP],
    );
    expect(drift.map((d) => d.kind)).toEqual(["record_drift"]);
  });

  it("catches a human's answer being flipped after the fact", () => {
    const drift = reconcileRecords(events, [DECISION], [
      { id: "stp_1", status: "rejected" },
    ]);
    expect(drift).toHaveLength(1);
    expect(drift[0].detail).toContain("StepUpRequest stp_1");
  });

  it("treats a deleted record as a violation, not as nothing to check", () => {
    const drift = reconcileRecords(events, [], [STEP_UP]);
    expect(drift).toHaveLength(1);
    expect(drift[0].detail).toContain("no longer exists");
  });

  it("reports an unparseable payload rather than skipping it", () => {
    const drift = reconcileRecords(
      [{ sequence: 1, payload: "{not json" }],
      [DECISION],
      [STEP_UP],
    );
    expect(drift[0].kind).toBe("unreadable_payload");
  });

  it("ignores event types it does not know how to reconcile", () => {
    const other = buildChain([{ event: "something_else", note: "x" }]);
    expect(reconcileRecords(other, [DECISION], [STEP_UP])).toEqual([]);
  });

  it("does not fabricate drift for a field the event never recorded", () => {
    const sparse = buildChain([
      { event: "policy_decision", policyDecisionId: "dec_1", outcome: "DECLINE" },
    ]);
    // No `reason` in the payload, so a differing reason in the row is not drift.
    expect(
      reconcileRecords(sparse, [{ ...DECISION, reason: "anything" }], []),
    ).toEqual([]);
  });
});
