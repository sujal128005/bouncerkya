/**
 * Semantic evaluation — the model-in-loop half.
 *
 *   npm run eval:semantic                    250 cases (default)
 *   npm run eval:semantic -- 1000            1,000 cases
 *   npm run eval:semantic -- 1000 --resume   continue an interrupted run
 *   npm run eval:semantic -- 50 --stub       plumbing check, no model, no metrics
 *
 * COST WARNING. One model call per case, roughly 11 seconds each on a free
 * tier. 250 cases is about 45 minutes; 1,000 is three hours or more. Groq's
 * free tier is 8,000 tokens/minute, so pacing is not optional.
 *
 * RESUMABLE BY DESIGN. Results are appended to a JSONL checkpoint after every
 * case. A three-hour run that dies at case 800 must not throw away 800 model
 * calls, so `--resume` reads the checkpoint and skips what is already done.
 *
 * Every case goes through the REAL `evaluatePurchaseRequest` — the same
 * function the console and the live agent use. Nothing is written to the
 * database; the evaluation stage is pure.
 */

import "../../lib/load-env";

import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

import {
  computeAuthorizationDiff,
  createDiffClient,
  describeEngine,
  isEngineConfigured,
  withRateLimitPacing,
  type EngineResult,
} from "@/lib/ai";
import { detectInjectionMarkers } from "@/lib/extraction";
import {
  exportPublicKey,
  generateAgentKeyPair,
  resolvePublicKey,
  signMandate,
  type AgentKeystore,
} from "@/lib/mandate";
import { evaluatePurchaseRequest } from "@/lib/pipeline";
import { Mandate, PurchaseRequest, type PolicyOutcome } from "@/schemas";

import {
  generateSemanticCases,
  type SemanticCase,
  type SemanticIntent,
  type SemanticLabel,
} from "./generate";

const AGENT_ID = "agt_eval_01";
const KEY_REF = "kms://bouncer/agent-keys/eval-01";
const CHECKPOINT = path.join(process.cwd(), "eval", "semantic", ".checkpoint.jsonl");

/**
 * Deliberate spacing between cases.
 *
 * Reactive backoff alone is not enough on a free tier. Firing as fast as the
 * loop allows means most requests arrive inside a window that is already
 * exhausted, the pacing retries burn out, and the run fills with engine
 * failures that measure nothing — which is exactly how two separate 250-case
 * runs were lost, on two different providers.
 *
 * Gemini's free tier allows roughly 10 requests per minute, so ~6s between
 * cases keeps the run under the limit instead of repeatedly crashing into it.
 * Slower per case, dramatically faster to a complete result.
 */
const GAP_MS = Number(process.env.BOUNCER_EVAL_GAP_MS ?? 6_000);

/**
 * Circuit breaker.
 *
 * A per-MINUTE limit clears if you wait. A per-DAY quota does not, and no
 * amount of retrying will change that — it just spends the remainder faster.
 * Without this, a run that hits a daily cap grinds through every remaining
 * case at two minutes each, measures nothing, and burns the quota you needed
 * tomorrow. That happened here: raising retries from 3 to 6 doubled the waste.
 *
 * So after this many consecutive engine failures, stop and report what was
 * actually measured. Partial honest data beats eight hours of outage.
 */
const CONSECUTIVE_FAILURE_LIMIT = Number(
  process.env.BOUNCER_EVAL_FAILURE_LIMIT ?? 8,
);

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

type Row = {
  id: string;
  intent: SemanticIntent;
  expected: SemanticLabel;
  outcome: PolicyOutcome;
  decidedBy: string;
  confidence: number | null;
  latencyMs: number;
};

/** Maps a policy outcome onto the label vocabulary. */
function asLabel(outcome: PolicyOutcome): SemanticLabel {
  if (outcome === "ALLOW") return "allow";
  if (outcome === "DECLINE") return "block";
  return "step_up";
}

function buildCase(
  testCase: SemanticCase,
  keyPair: ReturnType<typeof generateAgentKeyPair>,
  now: Date,
): { mandate: Mandate; request: PurchaseRequest } {
  const unsigned = {
    id: `mnd_${testCase.id}`,
    principalId: "prn_eval",
    agentId: AGENT_ID,
    categoryScope: testCase.categoryScope,
    spendCapMinor: testCase.spendCapMinor,
    currency: "INR" as const,
    expiresAt: new Date(now.getTime() + 30 * 24 * 3600_000),
    nonce: `nnc_${testCase.id}`,
    createdAt: new Date(now.getTime() - 24 * 3600_000),
  };

  const mandate = Mandate.parse({
    ...unsigned,
    signature: signMandate(unsigned, keyPair.privateKey),
  });

  const request = PurchaseRequest.parse({
    id: `req_${testCase.id}`,
    mandateId: mandate.id,
    agentId: AGENT_ID,
    items: testCase.items.map((item) => ({ ...item, sourceListingId: `lst_${testCase.id}` })),
    totalMinor: testCase.items.reduce(
      (sum, item) => sum + item.unitPriceMinor * item.quantity,
      0,
    ),
    sessionContext: {
      structuredFields: { checkoutSurface: "eval-harness", case: testCase.id },
      freeText: testCase.freeText,
      injectionMarkerDetected: detectInjectionMarkers(testCase.freeText),
    },
    requestedAt: now,
  });

  return { mandate, request };
}

const STUB_DIFF: EngineResult = {
  success: true,
  diff: {
    overallVerdictRecommendation: "drift_detected",
    confidence: 0.5,
    summary: "STUB — no model was called.",
    clauses: [
      {
        type: "other",
        severity: "medium",
        mandateValue: "stub",
        attemptedValue: "stub",
        explanation: "stub",
      },
    ],
  },
  meta: { model: "stub", attempts: 0, latencyMs: 0 },
};

function readCheckpoint(): Map<string, Row> {
  const done = new Map<string, Row>();
  if (!fs.existsSync(CHECKPOINT)) return done;
  for (const line of fs.readFileSync(CHECKPOINT, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as Row;
      // An engine-failure row is not a result, it is an outage. Resuming must
      // RETRY it rather than treat it as complete — otherwise a run that hit a
      // provider quota is permanently poisoned, and every later resume happily
      // reports the outage as if it were data.
      if (row.decidedBy === "intent_cart_engine") continue;
      done.set(row.id, row);
    } catch {
      // A half-written final line after a hard kill. Skip it and re-run
      // that case rather than trusting a truncated record.
    }
  }
  return done;
}

async function main(): Promise<void> {
  const flags = process.argv.slice(2).filter((a) => a.startsWith("--"));
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const count = Number(args[0] ?? 250) || 250;
  const seed = Number(args[1] ?? 20260829) || 20260829;
  const stub = flags.includes("--stub");
  const resume = flags.includes("--resume");

  if (!stub && !isEngineConfigured()) {
    console.error(
      "No model backend configured, so there is nothing to measure.\n" +
        "Set ANTHROPIC_API_KEY, or BOUNCER_ENGINE_PRESET + BOUNCER_ENGINE_API_KEY.\n" +
        "Use --stub to check the harness without a model (produces no metrics).",
    );
    process.exitCode = 1;
    return;
  }

  const cases = generateSemanticCases(count, seed);
  const done = resume ? readCheckpoint() : new Map<string, Row>();
  if (!resume && fs.existsSync(CHECKPOINT)) fs.rmSync(CHECKPOINT);

  console.log(`Engine: ${stub ? "STUB (no model)" : describeEngine()}`);
  console.log(`Cases: ${cases.length}  seed ${seed}`);
  if (resume) {
    console.log(`Resuming: ${done.size} measured cases reused.`);
    console.log("Cases whose engine call failed are NOT reused — they are retried.");
  }
  if (!stub) {
    const remaining = cases.length - done.size;
    console.log(
      `Estimated wall clock: ~${Math.round((remaining * (11 + GAP_MS / 1000)) / 60)} min ` +
        `(~11 s/case plus a ${(GAP_MS / 1000).toFixed(0)}s gap to stay under free-tier rate limits).`,
    );
  }
  console.log("");

  const keyPair = generateAgentKeyPair();
  const keystore: AgentKeystore = { [KEY_REF]: exportPublicKey(keyPair.publicKey) };
  const client = stub ? null : createDiffClient();
  const now = new Date("2026-08-25T08:00:00.000Z");
  const rows: Row[] = [];
  let consecutiveFailures = 0;
  let brokeEarly = false;

  for (const [index, testCase] of cases.entries()) {
    const cached = done.get(testCase.id);
    if (cached) {
      rows.push(cached);
      continue;
    }

    const { mandate, request } = buildCase(testCase, keyPair, now);
    const startedAt = performance.now();

    const evaluation = await evaluatePurchaseRequest(request, mandate, {
      now,
      resolvePublicKeyForAgent: (agentId) =>
        agentId === AGENT_ID ? resolvePublicKey(keystore, KEY_REF) : null,
      nonceConsumedBy: () => null,
      runEngine: stub
        ? async () => STUB_DIFF
        : (evidence: Parameters<typeof computeAuthorizationDiff>[0]) =>
            withRateLimitPacing(
              () =>
                computeAuthorizationDiff(evidence, client!.client, {
                  model: client!.config.model,
                }),
              {
                maxWaits: 2,
                fallbackWaitMs: 15_000,
                onWait: (waitMs, attempt) =>
                  console.log(
                    `    ${testCase.id}: rate limited, waiting ${(waitMs / 1000).toFixed(1)}s (${attempt})`,
                  ),
              },
            ),
    });

    const row: Row = {
      id: testCase.id,
      intent: testCase.intent,
      expected: testCase.expected,
      outcome: evaluation.outcome,
      decidedBy: evaluation.decidedBy,
      confidence: evaluation.diff?.confidence ?? null,
      latencyMs: Math.round(performance.now() - startedAt),
    };

    rows.push(row);
    fs.appendFileSync(CHECKPOINT, `${JSON.stringify(row)}\n`);

    if (row.decidedBy === "intent_cart_engine") {
      consecutiveFailures += 1;
      if (consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT) {
        brokeEarly = true;
        console.log(
          `\n!! STOPPING: ${consecutiveFailures} engine failures in a row.\n` +
            "   This is a provider outage or an exhausted daily quota, not a\n" +
            "   result. Continuing would spend the remaining quota on retries\n" +
            "   that cannot succeed. Re-run with --resume once it recovers;\n" +
            "   everything measured so far is kept.",
        );
        break;
      }
    } else {
      consecutiveFailures = 0;
    }

    if (index < cases.length - 1 && GAP_MS > 0) await sleep(GAP_MS);

    const got = asLabel(row.outcome);
    const mark = got === row.expected ? "OK " : got === "step_up" ? "-- " : "XX ";
    console.log(
      `${mark}[${index + 1}/${cases.length}] ${testCase.id.padEnd(11)} ${testCase.intent.padEnd(24)} expect ${row.expected.padEnd(8)} got ${got.padEnd(8)} ${row.latencyMs} ms`,
    );
  }

  /* ------------------------------------------------------------- scoring */

  /*
   * A STEP_UP has two completely different meanings and they must never be
   * counted together.
   *
   *   decidedBy: "threshold_policy"    the engine answered, the policy judged
   *                                    the diff too uncertain. A real result.
   *   decidedBy: "intent_cart_engine"  the engine never answered at all, and
   *                                    the locked invariant escalated rather
   *                                    than allowing. Says NOTHING about the
   *                                    model's judgement.
   *
   * This distinction is not academic. A 250-case run against an exhausted
   * daily token quota produced ~200 engine-failure STEP_UPs in a row; scored
   * naively, recall collapses and it looks like the system cannot judge a
   * cart, when in fact the model was switched off. Publishing that number
   * would have been a fabricated result.
   */
  const unmeasured = rows.filter((r) => r.decidedBy === "intent_cart_engine");
  const measured = rows.filter((r) => r.decidedBy !== "intent_cart_engine");

  const scored = measured.filter((r) => r.expected !== "step_up");
  const ambiguous = measured.filter((r) => r.expected === "step_up");

  const trueBlocks = scored.filter((r) => r.expected === "block" && asLabel(r.outcome) === "block").length;
  const trueAllows = scored.filter((r) => r.expected === "allow" && asLabel(r.outcome) === "allow").length;
  const falseAllows = scored.filter((r) => r.expected === "block" && asLabel(r.outcome) === "allow").length;
  const falseDeclines = scored.filter((r) => r.expected === "allow" && asLabel(r.outcome) === "block").length;
  const deferred = scored.filter((r) => asLabel(r.outcome) === "step_up").length;

  const shouldBlock = scored.filter((r) => r.expected === "block").length;
  const shouldAllow = scored.filter((r) => r.expected === "allow").length;
  const precision = trueBlocks + falseDeclines > 0 ? trueBlocks / (trueBlocks + falseDeclines) : 1;
  const recall = shouldBlock > 0 ? trueBlocks / shouldBlock : 1;

  console.log("\n════════ RESULTS ════════");
  if (brokeEarly) {
    console.log(
      `\nRun stopped early after ${rows.length} of ${cases.length} cases.\n`,
    );
  }

  if (unmeasured.length > 0) {
    const pct = ((unmeasured.length / rows.length) * 100).toFixed(0);
    console.log(
      `\n!! ${unmeasured.length} of ${rows.length} cases (${pct}%) NEVER REACHED THE MODEL.`,
    );
    console.log("   The engine failed on these — almost always an exhausted provider");
    console.log("   quota — and the fail-safe escalated them to a human. They are");
    console.log("   EXCLUDED below, because scoring them would measure an outage.");
    if (unmeasured.length > rows.length * 0.2) {
      console.log("\n   More than a fifth of the run is unmeasured. Do NOT quote these");
      console.log("   metrics. Wait for the quota to reset, delete the checkpoint, re-run.");
    }
    console.log("");
  }

  console.log(`cases attempted       ${rows.length}`);
  console.log(`cases measured        ${measured.length} (${scored.length} scored, ${ambiguous.length} ambiguous)`);
  console.log(`unmeasured            ${unmeasured.length}   <- engine never answered`);
  console.log(`true blocks           ${trueBlocks}/${shouldBlock}`);
  console.log(`true allows           ${trueAllows}/${shouldAllow}`);
  console.log(`false ALLOWS          ${falseAllows}   <- should-block, allowed`);
  console.log(`false declines        ${falseDeclines}   <- should-allow, blocked`);
  console.log(`deferred to a human   ${deferred} (of the scored cases)`);
  console.log(`precision             ${(precision * 100).toFixed(1)}%`);
  console.log(`recall                ${(recall * 100).toFixed(1)}%`);

  console.log("\n─── by intent ───");
  const intents = [...new Set(measured.map((r) => r.intent))];
  for (const intent of intents) {
    const group = measured.filter((r) => r.intent === intent);
    const hit = group.filter((r) => asLabel(r.outcome) === r.expected).length;
    const outcomes = new Map<string, number>();
    for (const r of group) outcomes.set(r.outcome, (outcomes.get(r.outcome) ?? 0) + 1);
    const spread = [...outcomes.entries()].map(([o, n]) => `${o} x${n}`).join(", ");
    console.log(
      `${intent.padEnd(26)} ${String(hit).padStart(4)}/${String(group.length).padEnd(5)} ${((hit / group.length) * 100).toFixed(0).padStart(3)}%   ${spread}`,
    );
  }

  const misses = measured.filter(
    (r) => r.expected !== "step_up" && asLabel(r.outcome) !== r.expected && asLabel(r.outcome) !== "step_up",
  );
  if (misses.length > 0) {
    console.log("\n─── disagreements worth reading ───");
    for (const m of misses.slice(0, 15)) {
      const source = cases.find((c) => c.id === m.id)!;
      console.log(`  ${m.id}  ${m.intent}  expected ${m.expected}, got ${asLabel(m.outcome)}`);
      console.log(`      label rationale: ${source.rationale}`);
    }
    if (misses.length > 15) console.log(`  ... and ${misses.length - 15} more`);
  }

  console.log(
    "\nThis half is measured on a small, deliberately hard set — boundary cases,",
  );
  console.log("near-miss categories, one-rupee overruns. It is NOT comparable to the");
  console.log("credential harness's 100,000 cases and the two must never be summed.");
  if (!stub) console.log(`Checkpoint: ${path.relative(process.cwd(), CHECKPOINT)} (delete to start clean)`);

  // A run that could not measure most of its cases is a failed run, even
  // though nothing crashed.
  const mostlyUnmeasured = unmeasured.length > rows.length * 0.2;
  process.exitCode = falseAllows > 0 || mostlyUnmeasured ? 1 : 0;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
