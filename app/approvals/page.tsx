import { IconHuman } from "@/app/_components/icons";
import { SetupNotice } from "@/app/_components/setup-notice";
import { StepUpCard } from "@/app/approvals/_components/step-up-card";
import {
  capUtilisation,
  formatConfidence,
  formatMinor,
  formatTimestamp,
} from "@/lib/format";
import { listStepUps } from "@/lib/scenarios";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  let queue: Awaited<ReturnType<typeof listStepUps>>;
  try {
    queue = await listStepUps();
  } catch (error) {
    return (
      <SetupNotice
        title="The approvals queue could not be read"
        message={
          error instanceof Error
            ? `${error.message} This usually means the database schema or the generated Prisma client is out of step with the code. Run the command below, then reload this page.`
            : "The database schema or the generated Prisma client is out of step with the code. Run the command below, then reload this page."
        }
      />
    );
  }

  return (
    <main className="mx-auto flex max-w-[1000px] flex-col px-6 pt-8 pb-10">
      <div className="relative flex flex-wrap items-end justify-between gap-4 border-b border-line pb-4">
        <div>
          <h1 className="font-display flex items-center gap-2.5 text-page font-bold text-ink">
            <IconHuman className="h-6 w-6 text-violet" />
            Approvals
          </h1>
          <p className="mt-2 max-w-[70ch] text-body leading-[1.6] text-ink-2">
            Checkouts Bouncer would not decide on its own. Each one is here
            because the diff was inconclusive, or because the engine could not
            produce one at all, and an absent judgement escalates rather
            than allowing. Answering writes to the database and appends to the
            audit chain.
          </p>
        </div>
        <div
          aria-hidden
          className="absolute bottom-[-1px] left-0 h-[2px] w-24 bg-violet"
        />
        <div className="flex items-baseline gap-2">
          <span className="label-caps">Pending</span>
          <span className="font-mono text-body font-medium text-ink tabular-nums">
            {queue.filter((entry) => entry.stepUp.status === "pending").length}
          </span>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-4">
        {queue.length === 0 ? (
          <div className="rounded-panel border border-line bg-surface px-4 py-4">
            <h2 className="text-lead font-semibold text-ink">
              No requests awaiting approval
            </h2>
            <p className="mt-2 max-w-[68ch] text-body leading-[1.55] text-ink-2">
              Bouncer escalates a checkout only when it can neither allow nor
              decline on its own. Either the diff was inconclusive, or the engine
              could not produce one at all. No request currently meets that
              condition.
            </p>
            <p className="mt-2 max-w-[68ch] text-body leading-[1.55] text-ink-3">
              Escalations appear here the moment they are written to the
              database. To generate one, run a checkout from the console.
            </p>
          </div>
        ) : (
          queue.map(({ stepUp, scenario }) => {
            const item = scenario.purchaseRequest.items[0];
            const diff = scenario.diff;
            const decision = scenario.decision;
            if (!decision) return null;
            return (
              <StepUpCard
                key={stepUp.id}
                stepUpId={stepUp.id}
                status={stepUp.status}
                respondedAt={
                  stepUp.respondedAt ? formatTimestamp(stepUp.respondedAt) : null
                }
                decisionId={decision.id}
                requestId={scenario.purchaseRequest.id}
                principalName={scenario.principal.displayName}
                agentName={scenario.agent.operatorName}
                itemName={item.name}
                itemCategory={item.category}
                quantity={item.quantity}
                totalFormatted={formatMinor(scenario.purchaseRequest.totalMinor)}
                capFormatted={formatMinor(scenario.mandate.spendCapMinor)}
                capUse={capUtilisation(
                  scenario.purchaseRequest.totalMinor,
                  scenario.mandate.spendCapMinor,
                )}
                categoryScope={scenario.mandate.categoryScope}
                confidence={diff ? formatConfidence(diff.confidence) : "n/a"}
                confidenceValue={diff?.confidence ?? 0}
                reason={decision.reason}
                clauseSummary={
                  diff
                    ? diff.clauses.map((clause) => clause.explanation).join(" ")
                    : "No Authorization Diff exists for this request, so there is no clause-by-clause evidence to review. Bouncer escalates when the engine cannot produce one. A missing judgement is never treated as permission."
                }
                requestedAt={formatTimestamp(
                  scenario.purchaseRequest.requestedAt,
                )}
                decidedAt={formatTimestamp(decision.decidedAt)}
              />
            );
          })
        )}
      </div>
    </main>
  );
}
