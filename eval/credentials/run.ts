/**
 * Credential-path evaluation at scale.
 *
 *   npm run eval:credentials              100,000 cases
 *   npm run eval:credentials -- 250000    any count
 *   npm run eval:credentials -- 100000 7  count and seed
 *
 * WHAT THIS MEASURES, AND WHAT IT DOES NOT
 *
 * Measures: the Mandate Verifier's end-to-end decision on a credential —
 * malformed, signature, expiry, replay — plus its throughput. These are real
 * decisions: a bad credential is declined here and never reaches a model, so
 * for this population the verifier IS the whole pipeline.
 *
 * Does NOT measure: diff quality, policy thresholds, or anything the
 * Intent-Cart Engine does. Those need a model call per case and are measured by
 * `npm run eval` over a much smaller labelled set. The two numbers are reported
 * separately and must never be added together — a credential rejection and a
 * semantic judgement are not the same unit of work.
 *
 * The property under test is one-directional. A false ACCEPT means a forged,
 * expired or replayed credential was let through, which is a security failure.
 * A false REJECT is a correctness bug but fails closed. They are counted and
 * reported separately for that reason.
 */

import "../../lib/load-env";

import { verifyMandate } from "@/lib/mandate/verify";

import {
  buildKeystore,
  generateCredentialCases,
  type CredentialCase,
  type CredentialIntent,
} from "./generate";

type Tally = {
  total: number;
  correct: number;
  falseAccepts: number;
  falseRejects: number;
  reasons: Map<string, number>;
};

const emptyTally = (): Tally => ({
  total: 0,
  correct: 0,
  falseAccepts: 0,
  falseRejects: 0,
  reasons: new Map(),
});

/** Stable 0..1 from a string, so the injected bug hits the same cases each run. */
function hash01(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

function main(): void {
  const flags = process.argv.slice(2).filter((a) => a.startsWith("--"));
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const count = Number(args[0] ?? 100_000) || 100_000;
  const seed = Number(args[1] ?? 20260829) || 20260829;

  /*
   * NEGATIVE CONTROL.
   *
   * "Zero false accepts" is worthless if the harness is incapable of reporting
   * one. A benchmark that cannot fail is not measuring anything — and this is
   * not hypothetical: an earlier version of this file reported 491,000
   * verifications/sec while every single verification was failing, because it
   * was timing the rejection path.
   *
   * --self-test injects a verifier bug: 1% of decisions are forced to "valid"
   * regardless of the credential. The run MUST then report roughly 1% of the
   * invalid population as false accepts. If it still reports zero, the scoring
   * is broken and every clean number this harness has ever printed is void.
   */
  const selfTest = flags.includes("--self-test");
  const BUG_RATE = 0.01;

  console.log(`STEALTH — credential path, ${count.toLocaleString()} cases, seed ${seed}`);
  console.log("No model is called on this path. Labels come from the generator's");
  console.log("intent, not from Bouncer's own rules.\n");

  const keystore = buildKeystore();

  const genStart = process.hrtime.bigint();
  const cases = generateCredentialCases(count, keystore, seed);
  const genMs = Number(process.hrtime.bigint() - genStart) / 1e6;
  console.log(`generated ${cases.length.toLocaleString()} cases in ${genMs.toFixed(0)} ms\n`);

  const now = new Date("2026-08-25T08:00:00.000Z");
  const byIntent = new Map<CredentialIntent, Tally>();
  const overall = emptyTally();
  const failures: Array<{ c: CredentialCase; got: string }> = [];

  const t0 = process.hrtime.bigint();

  for (const testCase of cases) {
    const real = verifyMandate(testCase.mandate, {
      now,
      resolvePublicKeyForAgent: (agentId: string) =>
        keystore.publicKeyForAgent.get(agentId) ?? null,
      nonceConsumedBy: () => testCase.nonceAlreadySpentBy,
      presentedByPurchaseRequestId: testCase.presentedByPurchaseRequestId,
    });

    // In self-test mode a deterministic slice of decisions is corrupted to
    // "valid" so the harness has something real to catch.
    const bugged = selfTest && hash01(testCase.id) < BUG_RATE;
    const verification = bugged ? { ...real, valid: true, failureReason: undefined } : real;

    const got = verification.valid ? "accept" : "reject";
    const ok = got === testCase.expected;

    let tally = byIntent.get(testCase.intent);
    if (!tally) {
      tally = emptyTally();
      byIntent.set(testCase.intent, tally);
    }

    tally.total += 1;
    overall.total += 1;
    if (ok) {
      tally.correct += 1;
      overall.correct += 1;
    } else if (got === "accept") {
      tally.falseAccepts += 1;
      overall.falseAccepts += 1;
      if (failures.length < 5) failures.push({ c: testCase, got });
    } else {
      tally.falseRejects += 1;
      overall.falseRejects += 1;
      if (failures.length < 5) failures.push({ c: testCase, got });
    }

    if (!verification.valid && verification.failureReason) {
      const key = verification.failureReason;
      tally.reasons.set(key, (tally.reasons.get(key) ?? 0) + 1);
    }
  }

  const ms = Number(process.hrtime.bigint() - t0) / 1e6;

  console.log("─── by intent ───");
  console.log(
    "intent".padEnd(24) +
      "cases".padStart(9) +
      "correct".padStart(10) +
      "false acc".padStart(11) +
      "false rej".padStart(11) +
      "  verifier said",
  );
  for (const [intent, tally] of byIntent) {
    const reasons = [...tally.reasons.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([reason, n]) => `${reason} x${n.toLocaleString()}`)
      .join(", ");
    console.log(
      intent.padEnd(24) +
        tally.total.toLocaleString().padStart(9) +
        tally.correct.toLocaleString().padStart(10) +
        tally.falseAccepts.toLocaleString().padStart(11) +
        tally.falseRejects.toLocaleString().padStart(11) +
        (reasons ? `  ${reasons}` : "  (accepted)"),
    );
  }

  const perCaseUs = (ms / overall.total) * 1000;
  console.log("\n════════ RESULTS ════════");
  console.log(`cases                 ${overall.total.toLocaleString()}`);
  console.log(
    `correct               ${overall.correct.toLocaleString()}  (${((overall.correct / overall.total) * 100).toFixed(4)}%)`,
  );
  console.log(`false ACCEPTS         ${overall.falseAccepts.toLocaleString()}   <- security failures`);
  console.log(`false REJECTS         ${overall.falseRejects.toLocaleString()}   <- fail-closed bugs`);
  console.log(`wall clock            ${ms.toFixed(0)} ms`);
  console.log(`throughput            ${Math.round(overall.total / (ms / 1000)).toLocaleString()} decisions/sec`);
  console.log(`per decision          ${perCaseUs.toFixed(1)} microseconds`);
  console.log(`model calls           0`);

  if (failures.length > 0) {
    console.log("\n─── first disagreements ───");
    for (const f of failures) {
      console.log(`  ${f.c.id}  intent=${f.c.intent}  expected=${f.c.expected}  got=${f.got}`);
    }
    console.log("\nA disagreement is a real finding: the generator built this case to be");
    console.log(`${failures[0]!.c.expected}, and the verifier disagreed. Investigate before quoting any number.`);
  }

  console.log(
    "\nSingle process, single core. This is the credential path only — the",
  );
  console.log("Intent-Cart Engine is measured separately by `npm run eval`.");

  if (selfTest) {
    const invalid = overall.total - (byIntent.get("valid")?.total ?? 0);
    const expected = invalid * BUG_RATE;
    const caught = overall.falseAccepts;
    const healthy = caught > expected * 0.5;
    console.log("\n─── negative control ───");
    console.log(`injected a ${(BUG_RATE * 100).toFixed(0)}% "always valid" bug into the verifier.`);
    console.log(`invalid credentials in the population: ${invalid.toLocaleString()}`);
    console.log(`false accepts the harness expected to see: ~${Math.round(expected).toLocaleString()}`);
    console.log(`false accepts the harness actually caught: ${caught.toLocaleString()}`);
    console.log(
      healthy
        ? "\nPASS — the harness detects a broken verifier, so a clean run means something."
        : "\nFAIL — the harness did NOT catch an injected bug. Every clean number it has printed is void.",
    );
    process.exitCode = healthy ? 0 : 1;
    return;
  }

  process.exitCode = overall.falseAccepts > 0 ? 1 : 0;
}

main();
