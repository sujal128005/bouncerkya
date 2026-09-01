/**
 * Evaluation harness.
 *
 *   npm run eval              measure against a live model backend
 *   npm run eval -- --stub    plumbing check only; prints no metrics
 *
 * Every case is replayed through the REAL pipeline — the same
 * evaluatePurchaseRequest the console and the live agent use. No shortcuts,
 * no per-case special handling, no stubbed policy. The only thing this file
 * decides is what goes in and how the results are scored.
 *
 * It writes nothing to the database. The pipeline's evaluation stage is pure,
 * so the whole run is in memory and repeatable.
 */
import "../lib/load-env";

import { performance } from "node:perf_hooks";

import {
  computeAuthorizationDiff,
  createDiffClient,
  isEngineConfigured,
  describeEngine,
  withRateLimitPacing,
  type EngineResult,
} from "../lib/ai";
import { getListing } from "../lib/catalog";
import { detectInjectionMarkers } from "../lib/extraction";
import {
  exportPublicKey,
  generateAgentKeyPair,
  resolvePublicKey,
  signMandate,
  tamperSignature,
  type AgentKeystore,
} from "../lib/mandate";
import { evaluatePurchaseRequest } from "../lib/pipeline";
import { Mandate, PurchaseRequest, type PolicyOutcome } from "../schemas";

import { EVAL_CASES, type EvalCase } from "./dataset";

/* ------------------------------------------------ illustrative unit costs */

/**
 * ILLUSTRATIVE ASSUMPTIONS. Not Razorpay figures, not measured from anything.
 * They exist to show the shape of the trade-off between blocking too much and
 * blocking too little; swap them for real numbers before quoting any total.
 */
export const COST_PER_LOST_SALE_MINOR = 45_000; // INR 450 — margin on a declined legitimate order
export const COST_PER_MISSED_FRAUD_MINOR = 800_000; // INR 8,000 — chargeback + goods + handling

/* ----------------------------------------------------------------- runner */

const AGENT_ID = "agt_eval";
const KEY_REF = "kms://stealth/agent-keys/eval";
const PRINCIPAL_ID = "prn_eval";

type CaseResult = {
  testCase: EvalCase;
  outcome: PolicyOutcome;
  decidedBy: string;
  confidence: number | null;
  latencyMs: number;
  engineFailed: boolean;
};

function buildCase(
  testCase: EvalCase,
  keyPair: ReturnType<typeof generateAgentKeyPair>,
  now: Date,
): { mandate: Mandate; request: PurchaseRequest } {
  const expiresAt =
    testCase.credential === "expired"
      ? new Date(now.getTime() - 24 * 60 * 60 * 1000)
      : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const unsigned = {
    id: `mnd_${testCase.id}`,
    principalId: PRINCIPAL_ID,
    agentId: AGENT_ID,
    categoryScope: testCase.mandate.categoryScope,
    spendCapMinor: testCase.mandate.spendCapMinor,
    currency: "INR" as const,
    expiresAt,
    nonce: `nnc_${testCase.id}`,
    createdAt: new Date(now.getTime() - 60 * 60 * 1000),
  };

  const signature = signMandate(unsigned, keyPair.privateKey);
  const parsed = Mandate.parse({
    ...unsigned,
    signature:
      testCase.credential === "tampered" ? tamperSignature(signature) : signature,
  });

  // A mandate that does not satisfy the schema cannot be produced by
  // Mandate.parse, which is the point of the case: the verifier must reject
  // it rather than throw. The cast is deliberate and load-bearing.
  const mandate =
    testCase.credential === "malformed"
      ? ({
          ...parsed,
          spendCapMinor: -1,
          categoryScope: [],
          currency: "USD",
        } as unknown as Mandate)
      : parsed;

  const items = testCase.items.map((item) => {
    const listing = getListing(item.listingId);
    if (!listing) throw new Error(`case ${testCase.id}: no listing ${item.listingId}`);
    return {
      name: listing.name,
      category: listing.category,
      quantity: item.quantity,
      unitPriceMinor: listing.priceMinor,
      sourceListingId: listing.id,
    };
  });

  const request = PurchaseRequest.parse({
    id: `req_${testCase.id}`,
    mandateId: `mnd_${testCase.id}`,
    agentId: AGENT_ID,
    items,
    totalMinor: items.reduce(
      (total, item) => total + item.unitPriceMinor * item.quantity,
      0,
    ),
    sessionContext: {
      structuredFields: { checkoutSurface: "eval-harness", case: testCase.id },
      freeText: testCase.freeText,
      injectionMarkerDetected: detectInjectionMarkers(testCase.freeText ?? ""),
    },
    requestedAt: now,
  });

  return { mandate, request };
}

/** A fixed reply used only to prove the harness runs. Never a measurement. */
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

async function main(): Promise<void> {
  const stub = process.argv.includes("--stub");

  if (!stub && !isEngineConfigured()) {
    console.error(
      "No model backend configured, so there is nothing to measure.\n" +
        "Set ANTHROPIC_API_KEY, or STEALTH_ENGINE_PRESET + STEALTH_ENGINE_API_KEY, then re-run.\n" +
        "Use --stub to check the harness plumbing without a model (produces no metrics).",
    );
    process.exitCode = 1;
    return;
  }

  const keyPair = generateAgentKeyPair();
  const keystore: AgentKeystore = { [KEY_REF]: exportPublicKey(keyPair.publicKey) };
  const now = new Date();

  const engine = stub ? null : createDiffClient();
  const runEngine = stub
    ? async () => STUB_DIFF
    : (evidence: Parameters<typeof computeAuthorizationDiff>[0]) =>
        withRateLimitPacing(() =>
          computeAuthorizationDiff(evidence, engine!.client, {
            model: engine!.config.model,
          }),
        );

  console.log(
    stub
      ? "MODE: --stub. The engine is NOT called. Metrics are suppressed."
      : `Engine: ${describeEngine()}`,
  );
  console.log(`Cases: ${EVAL_CASES.length}\n`);

  const results: CaseResult[] = [];

  for (const testCase of EVAL_CASES) {
    const { mandate, request } = buildCase(testCase, keyPair, now);

    // The replay case is the only one with prior state: its nonce is already
    // spent by an earlier request.
    const consumed =
      testCase.credential === "replayed"
        ? new Map([[`nnc_${testCase.id}`, "req_earlier"]])
        : new Map<string, string>();

    const startedAt = performance.now();
    const evaluation = await evaluatePurchaseRequest(request, mandate, {
      now,
      resolvePublicKeyForAgent: (agentId) =>
        agentId === AGENT_ID ? resolvePublicKey(keystore, KEY_REF) : null,
      nonceConsumedBy: (nonce) => consumed.get(nonce) ?? null,
      runEngine,
    });
    const latencyMs = Math.round(performance.now() - startedAt);

    const engineFailed = Boolean(
      evaluation.engineResult && !evaluation.engineResult.success,
    );

    results.push({
      testCase,
      outcome: evaluation.outcome,
      decidedBy: evaluation.decidedBy,
      confidence: evaluation.diff?.confidence ?? null,
      latencyMs,
      engineFailed,
    });

    // OK = matched the label. -- = deferred to a human (neither right nor
    // wrong). XX = got it wrong in the direction that costs something.
    const mark =
      testCase.expected === "step_up"
        ? evaluation.outcome === "STEP_UP"
          ? "OK "
          : "-- "
        : evaluation.outcome === "STEP_UP"
          ? "-- "
          : (testCase.expected === "block") === (evaluation.outcome === "DECLINE")
            ? "OK "
            : "XX ";

    console.log(
      `${mark} ${testCase.id.padEnd(28)} expect ${testCase.expected.padEnd(8)} got ${evaluation.outcome.padEnd(8)} ` +
        `by ${evaluation.decidedBy.padEnd(19)} ${evaluation.diff ? `conf ${evaluation.diff.confidence.toFixed(2)}` : "        "} ${latencyMs} ms`,
    );
  }

  if (stub) {
    console.log(
      "\nStub run complete: the harness wired up and every case reached a decision.\n" +
        "No metrics are printed, because nothing was measured.",
    );
    return;
  }

  report(results);
}

function report(results: CaseResult[]): void {
  const scored = results.filter((r) => r.testCase.expected !== "step_up");
  const ambiguous = results.filter((r) => r.testCase.expected === "step_up");

  // STEP_UP is neither an allow nor a block. It is reported as its own rate
  // rather than folded into right/wrong — a request handed to a human has not
  // been got wrong, it has been deferred.
  const truePositives = scored.filter(
    (r) => r.testCase.expected === "block" && r.outcome === "DECLINE",
  ).length;
  const falsePositives = scored.filter(
    (r) => r.testCase.expected === "allow" && r.outcome === "DECLINE",
  ).length;
  const falseNegatives = scored.filter(
    (r) => r.testCase.expected === "block" && r.outcome === "ALLOW",
  ).length;
  const trueNegatives = scored.filter(
    (r) => r.testCase.expected === "allow" && r.outcome === "ALLOW",
  ).length;
  const deferred = scored.filter((r) => r.outcome === "STEP_UP");

  const shouldBlock = scored.filter((r) => r.testCase.expected === "block").length;
  const shouldAllow = scored.filter((r) => r.testCase.expected === "allow").length;

  const precision =
    truePositives + falsePositives === 0
      ? null
      : truePositives / (truePositives + falsePositives);
  const recall = shouldBlock === 0 ? null : truePositives / shouldBlock;
  const fpr = shouldAllow === 0 ? null : falsePositives / shouldAllow;
  const fnr = shouldBlock === 0 ? null : falseNegatives / shouldBlock;

  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const mean = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p95 = latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))];

  const costMinor =
    falsePositives * COST_PER_LOST_SALE_MINOR +
    falseNegatives * COST_PER_MISSED_FRAUD_MINOR;

  const pct = (value: number | null) =>
    value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
  const inr = (minor: number) => `INR ${(minor / 100).toLocaleString("en-IN")}`;

  console.log("\n════════ RESULTS ════════");
  console.log(`cases                 ${results.length} (${scored.length} scored, ${ambiguous.length} ambiguous)`);
  console.log(`true blocks           ${truePositives}/${shouldBlock}`);
  console.log(`true allows           ${trueNegatives}/${shouldAllow}`);
  console.log(`false declines        ${falsePositives}   (should-allow, blocked)`);
  console.log(`false allows          ${falseNegatives}   (should-block, allowed)`);
  console.log(`deferred to a human   ${deferred.length}   (of the scored cases)`);
  console.log("");
  console.log(`precision             ${pct(precision)}`);
  console.log(`recall                ${pct(recall)}`);
  console.log(`false-positive rate   ${pct(fpr)}`);
  console.log(`false-negative rate   ${pct(fnr)}`);
  console.log(`step-up rate          ${pct(results.filter((r) => r.outcome === "STEP_UP").length / results.length)}  (all cases)`);
  console.log(`decline rate          ${pct(results.filter((r) => r.outcome === "DECLINE").length / results.length)}  (all cases)`);
  console.log("");
  console.log(`latency mean / p50 / p95   ${mean} / ${p50} / ${p95} ms`);
  const credential = results.filter((r) => r.decidedBy === "mandate_verifier");
  if (credential.length > 0) {
    const credMean = Math.round(
      credential.reduce((a, r) => a + r.latencyMs, 0) / credential.length,
    );
    console.log(`  of which credential-only   ${credMean} ms mean (no model call)`);
  }
  console.log("");
  console.log("ambiguous cases (excluded from precision/recall):");
  for (const r of ambiguous) {
    console.log(`  ${r.testCase.id.padEnd(28)} -> ${r.outcome}${r.outcome === "STEP_UP" ? "  (as intended)" : "  (resolved without a human)"}`);
  }
  console.log("");
  console.log("illustrative cost — NOT Razorpay figures, assumptions only:");
  console.log(`  cost per lost sale     ${inr(COST_PER_LOST_SALE_MINOR)}`);
  console.log(`  cost per missed fraud  ${inr(COST_PER_MISSED_FRAUD_MINOR)}`);
  console.log(`  total                  ${inr(costMinor)}  = ${falsePositives} x lost sale + ${falseNegatives} x missed fraud`);

  const engineFailures = results.filter((r) => r.engineFailed);
  if (engineFailures.length > 0) {
    console.log(
      `\n${engineFailures.length} case(s) had an engine failure and fell through to STEP_UP: ${engineFailures.map((r) => r.testCase.id).join(", ")}`,
    );
  }
  console.log(
    "\nLLM output varies between runs. Run this more than once before quoting a number.",
  );
}

void main();
