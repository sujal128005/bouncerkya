import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTempDatabase } from "@/lib/test-support/temp-database";

/**
 * Persistence tests against a real SQLite database with the real migrations
 * applied. Mocking Prisma here would test the mock, not the transition.
 */

type Mod = {
  prisma: typeof import("@/lib/db").prisma;
  respondToStepUp: typeof import("@/lib/step-up").respondToStepUp;
  verifyAuditChain: typeof import("@/lib/audit").verifyAuditChain;
  appendAuditEvent: typeof import("@/lib/audit").appendAuditEvent;
};

let mod: Mod;
let cleanup: () => void;

beforeAll(async () => {
  ({ cleanup } = createTempDatabase());

  const [db, stepUp, audit] = await Promise.all([
    import("@/lib/db"),
    import("@/lib/step-up"),
    import("@/lib/audit"),
  ]);

  mod = {
    prisma: db.prisma,
    respondToStepUp: stepUp.respondToStepUp,
    verifyAuditChain: audit.verifyAuditChain,
    appendAuditEvent: audit.appendAuditEvent,
  };

  const { prisma } = mod;
  await prisma.principal.create({ data: { id: "prn_1", displayName: "Test" } });
  await prisma.agent.create({
    data: {
      id: "agt_1",
      operatorName: "Test Agent",
      platform: "test",
      publicKeyRef: "kms://test",
    },
  });
  await prisma.mandate.create({
    data: {
      id: "mnd_1",
      principalId: "prn_1",
      agentId: "agt_1",
      categoryScope: '["footwear/running-shoes"]',
      spendCapMinor: 500_000,
      currency: "INR",
      expiresAt: new Date("2026-12-31T00:00:00.000Z"),
      nonce: "nnc_1",
      signature: "ed25519:AAAA",
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
    },
  });
  await prisma.purchaseRequest.create({
    data: {
      id: "req_1",
      mandateId: "mnd_1",
      agentId: "agt_1",
      totalMinor: 449_900,
      sessionStructuredFields: "{}",
      sessionFreeText: null,
      injectionMarkerDetected: false,
      requestedAt: new Date("2026-08-25T09:00:00.000Z"),
    },
  });
  await prisma.policyDecision.create({
    data: {
      id: "dec_1",
      purchaseRequestId: "req_1",
      outcome: "STEP_UP",
      reason: "ambiguous",
      authorizationDiffId: null,
      decidedAt: new Date("2026-08-25T09:00:01.000Z"),
      latencyMs: 100,
    },
  });
  await prisma.stepUpRequest.create({
    data: {
      id: "stp_1",
      policyDecisionId: "dec_1",
      principalId: "prn_1",
      status: "pending",
      respondedAt: null,
    },
  });
});

afterAll(async () => {
  await mod.prisma.$disconnect();
  cleanup();
});

describe("step-up backend", () => {
  it("rejects an unknown step-up id", async () => {
    const result = await mod.respondToStepUp("stp_nope", "approve");
    expect(result).toMatchObject({ ok: false, error: "not_found" });
  });

  it("persists pending -> approved, and the row reflects it on re-read", async () => {
    const before = await mod.prisma.stepUpRequest.findUniqueOrThrow({
      where: { id: "stp_1" },
    });
    expect(before.status).toBe("pending");
    expect(before.respondedAt).toBeNull();

    const result = await mod.respondToStepUp("stp_1", "approve", {
      now: new Date("2026-08-25T12:00:00.000Z"),
    });
    expect(result).toMatchObject({ ok: true, status: "approved" });

    // Re-read from the database, not from the return value.
    const after = await mod.prisma.stepUpRequest.findUniqueOrThrow({
      where: { id: "stp_1" },
    });
    expect(after.status).toBe("approved");
    expect(after.respondedAt).toEqual(new Date("2026-08-25T12:00:00.000Z"));
  });

  it("writes the human's answer into the audit chain", async () => {
    const events = await mod.prisma.auditEvent.findMany({
      where: { eventType: "step_up_response" },
    });
    expect(events).toHaveLength(1);

    const payload = JSON.parse(events[0].payload) as Record<string, unknown>;
    expect(payload).toMatchObject({
      event: "step_up_response",
      stepUpRequestId: "stp_1",
      action: "approve",
      status: "approved",
      principalId: "prn_1",
    });

    expect((await mod.verifyAuditChain()).valid).toBe(true);
  });

  it("refuses a second answer instead of silently overwriting the first", async () => {
    const result = await mod.respondToStepUp("stp_1", "reject");
    expect(result).toMatchObject({ ok: false, error: "already_resolved" });

    const row = await mod.prisma.stepUpRequest.findUniqueOrThrow({
      where: { id: "stp_1" },
    });
    expect(row.status).toBe("approved");
  });

  it("lets exactly one of two simultaneous answers win, and records one audit event", async () => {
    // Return the existing step-up to pending. StepUpRequest.policyDecisionId
    // is unique, so a second row would need a second decision; resetting is
    // both simpler and closer to the real contested state.
    await mod.prisma.stepUpRequest.update({
      where: { id: "stp_1" },
      data: { status: "pending", respondedAt: null },
    });

    const before = await mod.prisma.auditEvent.count();

    // Fired together. Before the conditional update both callers could observe
    // "pending", both proceed, and the loser silently overwrote the winner's
    // answer while appending a second audit event for the same decision.
    const [first, second] = await Promise.all([
      mod.respondToStepUp("stp_1", "approve"),
      mod.respondToStepUp("stp_1", "reject"),
    ]);

    const winners = [first, second].filter((r) => r.ok);
    const losers = [first, second].filter((r) => !r.ok);

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0]).toMatchObject({ ok: false, error: "already_resolved" });

    // The stored answer is the winner's, and exactly one event was appended.
    const row = await mod.prisma.stepUpRequest.findUniqueOrThrow({
      where: { id: "stp_1" },
    });
    expect(row.status).toBe(winners[0]!.ok ? winners[0]!.status : "unreachable");

    const after = await mod.prisma.auditEvent.count();
    expect(after - before).toBe(1);

    // And the chain is still intact after a contested write.
    await expect(mod.verifyAuditChain()).resolves.toMatchObject({ valid: true });
  });

  it("chains appended events and detects tampering in the stored chain", async () => {
    await mod.appendAuditEvent("req_1", "dec_1", { event: "policy_decision", n: 1 });
    await mod.appendAuditEvent("req_1", "dec_1", { event: "policy_decision", n: 2 });

    expect((await mod.verifyAuditChain()).valid).toBe(true);

    const head = await mod.prisma.auditEvent.findFirstOrThrow({
      orderBy: { sequence: "desc" },
    });
    await mod.prisma.auditEvent.update({
      where: { id: head.id },
      data: { payload: JSON.stringify({ event: "policy_decision", n: 99 }) },
    });

    const verification = await mod.verifyAuditChain();
    expect(verification.valid).toBe(false);
    expect(verification.violations[0].kind).toBe("hash_mismatch");
  });

  it("assigns contiguous sequence numbers starting at 1", async () => {
    const events = await mod.prisma.auditEvent.findMany({
      orderBy: { sequence: "asc" },
      select: { sequence: true, previousEventHash: true },
    });
    expect(events.map((e) => e.sequence)).toEqual(
      events.map((_, index) => index + 1),
    );
    expect(events[0].previousEventHash).toBeNull();
  });
});
