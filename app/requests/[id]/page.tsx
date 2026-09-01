import Link from "next/link";
import { notFound } from "next/navigation";

import { IconChain, IconHuman } from "@/app/_components/icons";
import { Chip, OutcomeBadge, Panel, PanelBody, PanelHeader } from "@/app/_components/ui";
import { SetupNotice } from "@/app/_components/setup-notice";
import { CartPanel } from "@/app/requests/_components/cart-panel";
import { DiffPanel } from "@/app/requests/_components/diff-panel";
import { MandatePanel } from "@/app/requests/_components/mandate-panel";
import { NoDiffPanel } from "@/app/requests/_components/no-diff-panel";
import { OutcomePanel } from "@/app/requests/_components/outcome-panel";
import { ShortCircuitPanel } from "@/app/requests/_components/short-circuit-panel";
import { StageSection, type StageState } from "@/app/requests/_components/stage-section";
import { verifyAuditChain } from "@/lib/audit";
import { formatMinor, formatTimestamp } from "@/lib/format";
import { labelForScenario } from "@/lib/scenario-label";
import { listScenarios, type ScenarioView } from "@/lib/scenarios";

/**
 * One checkout attempt, walked through the pipeline in order.
 *
 * The old console rendered the same panels in a two-column grid, which said
 * nothing about sequence: a reader could not tell that the mandate check runs
 * before the model, that a failure there means the model is never called, or
 * that the verdict is applied by code rather than by the model that produced
 * the diff. Those three facts are the entire argument of the product, and the
 * layout was hiding all of them.
 *
 * Numbered stages, top to bottom, with the stages that did not run still
 * present and explaining themselves.
 */

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

/** What the model was told to look at, before it was asked to judge. */
function evidenceSummary(scenario: ScenarioView): string {
  const { structuredFields, freeText, injectionMarkerDetected } =
    scenario.purchaseRequest.sessionContext;
  const fieldCount = Object.keys(structuredFields).length;
  // A listing with no free text is not an error — it is a listing with nothing
  // untrusted to quote, which is worth saying rather than crashing on.
  const chars = freeText?.length ?? 0;
  return (
    `${fieldCount} structured field${fieldCount === 1 ? "" : "s"} the merchant asserts, ` +
    `plus ${chars} character${chars === 1 ? "" : "s"} of untrusted listing text` +
    (injectionMarkerDetected
      ? ", which carries an injection marker, quoted as evidence and never executed."
      : ", quoted as evidence and never executed.")
  );
}

export default async function RequestDetailPage({ params }: { params: Params }) {
  const { id } = await params;

  let scenarios: ScenarioView[];
  try {
    scenarios = await listScenarios();
  } catch (error) {
    return (
      <SetupNotice
        title="This request could not be read"
        message={
          error instanceof Error
            ? `${error.message} This usually means the database schema or the generated Prisma client is out of step with the code. Run the command below, then reload this page.`
            : "The database schema or the generated Prisma client is out of step with the code."
        }
      />
    );
  }

  const scenario = scenarios.find((candidate) => candidate.key === id);
  if (!scenario) notFound();

  const label = labelForScenario(scenario);
  const chain = await verifyAuditChain();
  const verified = scenario.mandateVerification.valid;
  const item = scenario.purchaseRequest.items[0];

  // Each stage's state, derived from what the pipeline actually recorded —
  // never assumed from the outcome.
  const mandateState: StageState = verified ? "ran" : "failed";
  const evidenceState: StageState = verified ? "ran" : "skipped";
  const diffState: StageState = !verified
    ? "skipped"
    : scenario.diff
      ? "ran"
      : "failed";
  const policyState: StageState = scenario.decision ? "ran" : "skipped";
  const stepUpState: StageState = scenario.stepUp ? "ran" : "skipped";

  return (
    <main className="mx-auto flex max-w-[1000px] flex-col px-6 pt-8 pb-10">
      {/* ---------------------------------------------------------- header */}
      <div className="border-b border-line pb-6">
        <Link
          href="/requests"
          className="font-mono text-label text-ink-3 transition-colors hover:text-accent"
        >
          &larr; All requests
        </Link>

        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-page font-bold text-ink">
              {label.title}
            </h1>
            <p className="mt-2 max-w-[76ch] text-body leading-[1.6] text-ink-2">
              {label.subtitle}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            {scenario.decision ? (
              <OutcomeBadge outcome={scenario.decision.outcome} size="lg" />
            ) : (
              <Chip tone="quiet">not evaluated</Chip>
            )}
            <span className="font-mono text-label text-ink-3">{scenario.key}</span>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 font-mono text-label text-ink-3">
          <span>{scenario.agent.operatorName}</span>
          <span>
            {item.name}
            {scenario.purchaseRequest.items.length > 1
              ? ` +${scenario.purchaseRequest.items.length - 1}`
              : ""}
          </span>
          <span>{formatMinor(scenario.purchaseRequest.totalMinor)}</span>
          <span>cap {formatMinor(scenario.mandate.spendCapMinor)}</span>
          <span>{formatTimestamp(scenario.purchaseRequest.requestedAt)}</span>
        </div>
      </div>

      {/* ---------------------------------------------------------- stages */}
      <div className="mt-8">
        <StageSection
          n={1}
          name="Verify the mandate"
          state={mandateState}
          outcome={
            verified
              ? "All four credential checks passed: the mandate parses, the ed25519 signature verifies against this agent's key, it has not expired, and its nonce has not been spent. The request continues."
              : `The credential failed on ${scenario.mandateVerification.failureReason}. Everything below stopped here. No model was called, and no money was ever in play.`
          }
        >
          <MandatePanel
            mandate={scenario.mandate}
            principal={scenario.principal}
            agent={scenario.agent}
            verification={scenario.mandateVerification}
            purchaseRequestId={scenario.key}
          />
        </StageSection>

        <StageSection
          n={2}
          name="Extract the evidence"
          state={evidenceState}
          outcome={
            verified
              ? evidenceSummary(scenario)
              : "Not reached. There is no point reading a cart presented with a credential that does not verify."
          }
        >
          {verified ? (
            <CartPanel
              request={scenario.purchaseRequest}
              mandate={scenario.mandate}
            />
          ) : null}
        </StageSection>

        <StageSection
          n={3}
          name="Diff intent against cart"
          state={diffState}
          outcome={
            !verified
              ? "Not reached. This is the only stage that costs a model call, and a bad credential never gets to spend one."
              : scenario.diff
                ? `The engine returned ${scenario.diff.clauses.length} clause${
                    scenario.diff.clauses.length === 1 ? "" : "s"
                  } at confidence ${scenario.diff.confidence.toFixed(2)}. This is a recommendation about where the cart departs from the mandate. It is not the decision.`
                : "The engine was called and did not return a usable diff. A missing judgement is not permission: the request escalates."
          }
        >
          {!verified ? (
            <ShortCircuitPanel
              verification={scenario.mandateVerification}
              latencyMs={scenario.decision?.latencyMs ?? 0}
            />
          ) : scenario.diff && scenario.diffId ? (
            <DiffPanel
              diff={scenario.diff}
              diffId={scenario.diffId}
              provenance={scenario.diffProvenance}
            />
          ) : (
            <NoDiffPanel failure={scenario.engineFailure} />
          )}
        </StageSection>

        <StageSection
          n={4}
          name="Apply the policy"
          state={policyState}
          outcome={
            scenario.decision
              ? `A deterministic threshold rule turned the evidence above into ${scenario.decision.outcome}, in ${
                  scenario.decision.latencyMs === 0
                    ? "under a millisecond"
                    : `${scenario.decision.latencyMs} ms`
                }. The same input always produces the same verdict here. The variance, where there is any, lives in stage 3.`
              : "No decision is recorded for this request."
          }
        >
          {scenario.decision ? (
            <OutcomePanel
              decision={scenario.decision}
              diff={scenario.diff}
              stepUp={scenario.stepUp}
              scenario={scenario}
            />
          ) : null}
        </StageSection>

        <StageSection
          n={5}
          name="Escalate to the human"
          state={stepUpState}
          outcome={
            scenario.stepUp
              ? `The policy would not decide this alone, so it went to ${scenario.principal.displayName} and is currently ${scenario.stepUp.status}.`
              : "Not needed. The policy reached a verdict on its own, so nobody was interrupted."
          }
        >
          {scenario.stepUp ? (
            <Panel>
              <PanelHeader
                icon={<IconHuman className="h-4 w-4" />}
                title="Step-up"
                meta={<Chip>{scenario.stepUp.status}</Chip>}
              />
              <PanelBody>
                <p className="text-body leading-[1.6] text-ink-2">
                  {scenario.stepUp.status === "pending"
                    ? "Waiting on a human answer. Nothing proceeds to payment until one is given."
                    : "Answered. The response is written to the database and appended to the audit chain."}
                </p>
                <Link
                  href="/approvals"
                  className="mt-3 inline-block text-body text-accent underline underline-offset-2 hover:text-accent-strong"
                >
                  Open the approvals queue
                </Link>
              </PanelBody>
            </Panel>
          ) : null}
        </StageSection>

        {/* The last stage draws no rail below it. */}
        <section className="grid grid-cols-[32px_minmax(0,1fr)] gap-x-4">
          <div className="flex flex-col items-center">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-rail-line bg-rail-soft font-mono text-meta font-semibold text-rail tabular-nums">
              6
            </span>
          </div>
          <div>
            <div className="flex flex-wrap items-baseline gap-x-3">
              <h2 className="font-display text-head font-bold text-ink">
                Append to the audit chain
              </h2>
              <span className="flex items-center gap-1.5 font-mono text-label text-rail">
                <span aria-hidden className="font-semibold">
                  ✓
                </span>
                ran
              </span>
            </div>
            <p className="mt-1.5 max-w-[84ch] text-body leading-[1.6] text-ink-2">
              Every step above is written to a SHA-256 hash chain over canonical
              JSON. Editing a past event breaks every hash after it. Editing the
              decision row instead touches no event at all, so verification also
              compares each stored row against what its event recorded. Both
              checks are recomputed on read rather than stored.
            </p>
            <div className="mt-4">
              <Panel>
                <PanelHeader
                  icon={<IconChain className="h-4 w-4" />}
                  title="Audit chain"
                  meta={
                    <Chip tone={chain.valid ? "neutral" : "quiet"}>
                      {chain.valid ? "verified" : `${chain.violations.length} violation(s)`}
                    </Chip>
                  }
                />
                <PanelBody>
                  <p className="text-body leading-[1.6] text-ink-2">
                    {chain.eventsChecked} event
                    {chain.eventsChecked === 1 ? "" : "s"} across every request in
                    this database,{" "}
                    {chain.valid
                      ? "each one hashing to the value its successor records, and each stored decision still saying what its event recorded."
                      : `with ${chain.violations.length} violation(s): ${chain.violations
                          .map((violation) => violation.kind)
                          .join(", ")}.`}
                  </p>
                </PanelBody>
              </Panel>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
