/**
 * Manual integration check for the Intent-Cart Consistency Engine.
 *
 * This is the only thing in the repo that makes a real Anthropic API call, and
 * it is never run by the automated tests — those use a mocked client so they
 * stay deterministic and offline. Run this yourself, with your own key:
 *
 *   npm run engine:check              # all mandate-valid scenarios in the DB
 *   npm run engine:check req_H1F72E   # just one
 *
 * It reads scenarios out of the seeded database, runs each through the real
 * engine, and prints the diff it gets back. Nothing is written to the database
 * — use `npm run db:reset` for that.
 */
import "../lib/load-env";

import {
  computeAuthorizationDiff,
  createDiffClient,
  describeEngine,
  isEngineConfigured,
  withRateLimitPacing,
} from "../lib/ai";
import { extractEvidence } from "../lib/extraction";
import { listScenarios } from "../lib/scenarios";
import { prisma } from "../lib/db";

function money(minor: number): string {
  return `INR ${(minor / 100).toFixed(2)}`;
}

async function main(): Promise<void> {
  if (!isEngineConfigured()) {
    console.error(
      "No model backend configured. Set ANTHROPIC_API_KEY, or BOUNCER_ENGINE_PRESET +",
    );
    console.error("BOUNCER_ENGINE_API_KEY in .env (see .env.example), then re-run.");
    process.exitCode = 1;
    return;
  }

  const only = process.argv[2];
  const { client, config } = createDiffClient();
  const model = config.model;

  const scenarios = (await listScenarios()).filter(
    (scenario) =>
      scenario.mandateVerification.valid &&
      (only === undefined || scenario.key === only),
  );

  if (scenarios.length === 0) {
    console.error(
      only
        ? `No mandate-valid scenario named ${only}. Run "npm run db:reset" first.`
        : 'No mandate-valid scenarios found. Run "npm run db:reset" first.',
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Engine: ${describeEngine()}`);
  console.log(`Scenarios: ${scenarios.length}\n`);

  let failures = 0;

  for (const scenario of scenarios) {
    const evidence = extractEvidence({
      mandate: scenario.mandate,
      request: scenario.purchaseRequest,
    });

    console.log("─".repeat(78));
    console.log(`${scenario.key}  ${scenario.purchaseRequest.items[0].name}`);
    console.log(
      `  mandate scope : ${scenario.mandate.categoryScope.join(", ")}  cap ${money(scenario.mandate.spendCapMinor)}`,
    );
    console.log(
      `  cart          : ${evidence.cart.lines[0].category.raw}  ${money(evidence.cart.totalMinor)}  (${evidence.budget.utilisationPercent}% of cap)`,
    );
    console.log(
      `  marker scan   : ${evidence.injectionMarkerDetected ? `DETECTED [${evidence.injectionMarkerIds.join(", ")}]` : "clean"}`,
    );

    const result = await withRateLimitPacing(
      () => computeAuthorizationDiff(evidence, client, { model }),
      {
        onWait: (waitMs, attempt) =>
          console.log(
            `  rate limited  : waiting ${(waitMs / 1000).toFixed(1)}s before retry ${attempt}`,
          ),
      },
    );

    if (!result.success) {
      failures += 1;
      console.log(
        `  RESULT        : FAILED · ${result.failureReason} — ${result.details}`,
      );
      continue;
    }

    const { diff, meta } = result;
    console.log(
      `  RESULT        : ${diff.overallVerdictRecommendation}  confidence ${diff.confidence.toFixed(2)}  (${meta.latencyMs} ms, attempt ${meta.attempts}, ${meta.usage?.outputTokens ?? "?"} output tokens)`,
    );
    console.log(`  summary       : ${diff.summary}`);
    for (const clause of diff.clauses) {
      console.log(`    · ${clause.type} [${clause.severity}]`);
      console.log(`        mandate  : ${clause.mandateValue}`);
      console.log(`        attempted: ${clause.attemptedValue}`);
      console.log(`        why      : ${clause.explanation}`);
    }
    if (diff.clauses.some((clause) => clause.type === "expiry")) {
      console.log(
        "  NOTE: the model emitted an `expiry` clause. It should not — expiry is decided upstream.",
      );
    }
  }

  console.log("─".repeat(78));
  console.log(
    failures === 0
      ? "All scenarios returned a schema-valid diff."
      : `${failures} scenario(s) failed. That is a real result, not a crash.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
