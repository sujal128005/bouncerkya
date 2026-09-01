import { IconLedger } from "@/app/_components/icons";
import { SetupNotice } from "@/app/_components/setup-notice";
import { RequestList } from "@/app/requests/_components/request-list";
import { RunAgent } from "@/app/requests/_components/run-agent";
import { verifyAuditChain } from "@/lib/audit";
import { listScenarios } from "@/lib/scenarios";
import type { PolicyOutcome } from "@/schemas";

/**
 * Every checkout attempt, as a list.
 *
 * This page and /requests/[id] are the two halves of what used to be one
 * /console page doing five jobs at once. Splitting them means a reader can
 * answer "what happened here?" before being asked to read a mandate, a cart,
 * a clause-by-clause diff and a verdict simultaneously.
 */

export const dynamic = "force-dynamic";

/* These three counts ARE verdicts, so they carry the functional colours.
 * Everything else on this page is decorative and must not. */
const OUTCOME_COUNT: Record<PolicyOutcome, string> = {
  ALLOW: "text-allow",
  STEP_UP: "text-stepup",
  DECLINE: "text-decline",
};

export default async function RequestsPage() {
  let scenarios: Awaited<ReturnType<typeof listScenarios>>;
  try {
    scenarios = await listScenarios();
  } catch (error) {
    return (
      <SetupNotice
        title="Seeded requests could not be read"
        message={
          error instanceof Error
            ? `${error.message} This usually means the database schema or the generated Prisma client is out of step with the code. Run the command below, then reload this page.`
            : "The database schema or the generated Prisma client is out of step with the code. Run the command below, then reload this page."
        }
      />
    );
  }

  if (scenarios.length === 0) {
    return (
      <SetupNotice
        title="No scenarios in the database"
        message="The schema is in place but nothing has been seeded yet."
      />
    );
  }

  const chain = await verifyAuditChain();
  const outcomes: PolicyOutcome[] = ["ALLOW", "STEP_UP", "DECLINE"];
  const counts = outcomes.map((outcome) => ({
    outcome,
    n: scenarios.filter((s) => s.decision?.outcome === outcome).length,
  }));
  const blockedPreModel = scenarios.filter(
    (s) => !s.mandateVerification.valid,
  ).length;

  return (
    <main className="mx-auto flex max-w-[1100px] flex-col px-6 pt-8 pb-10">
      <div className="relative flex flex-wrap items-end justify-between gap-6 border-b border-line pb-6">
        <div>
          <h1 className="font-display flex items-center gap-2.5 text-page font-bold text-ink">
            <IconLedger className="h-6 w-6 text-accent-strong" />
            Requests
          </h1>
          <p className="mt-2 max-w-[70ch] text-body leading-[1.6] text-ink-2">
            Every checkout an agent attempted, newest first. Open one to see the
            mandate it presented, the cart it built, and how the verdict was
            reached, stage by stage.
          </p>
        </div>

        <RunAgent />
        {/* A short coloured rule under the title, one per page, in that
            page's hue. Cheap way to make four pages feel like four places. */}
        <div
          aria-hidden
          className="absolute bottom-[-1px] left-0 h-[2px] w-24 bg-accent"
        />
      </div>

      <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-2 border-b border-line py-4">
        <div className="flex items-baseline gap-2">
          <dt className="label-caps">Total</dt>
          <dd className="font-mono text-lead font-medium text-ink tabular-nums">
            {scenarios.length}
          </dd>
        </div>
        {counts.map(({ outcome, n }) => (
          <div key={outcome} className="flex items-baseline gap-2">
            <dt className="label-caps">{outcome.toLowerCase().replace("_", " ")}</dt>
            <dd
              className={`font-mono text-lead font-semibold tabular-nums ${OUTCOME_COUNT[outcome]}`}
            >
              {n}
            </dd>
          </div>
        ))}
        <div className="flex items-baseline gap-2">
          <dt className="label-caps">Blocked pre-model</dt>
          <dd className="font-mono text-lead font-semibold text-measure tabular-nums">
            {blockedPreModel}
          </dd>
        </div>
        <span className="ml-auto font-mono text-label whitespace-nowrap text-ink-3">
          audit chain · {chain.eventsChecked} event
          {chain.eventsChecked === 1 ? "" : "s"} ·{" "}
          {chain.valid ? "verified" : `${chain.violations.length} violation(s)`}
        </span>
      </dl>

      <div className="mt-5">
        <RequestList scenarios={scenarios} />
      </div>

      <p className="mt-6 max-w-[82ch] border-t border-line pt-4 text-meta leading-[1.55] text-ink-3">
        Every outcome above is computed end to end: mandate verified, cart
        diffed, verdict applied by the deterministic threshold policy. An engine
        that cannot answer escalates to a human. It never allows.
      </p>
    </main>
  );
}
