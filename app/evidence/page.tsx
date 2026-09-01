import { IconVerdict } from "@/app/_components/icons";
import { Panel, PanelBody, PanelHeader } from "@/app/_components/ui";
import {
  ALL_RESULTS,
  RAZORPAY_VERIFICATION,
  type MeasuredResult,
  TEST_COUNT,
  type Verification,
} from "@/lib/evidence";

/**
 * What has actually been measured.
 *
 * All of this already existed — in README.md, where a judge with eleven
 * projects to look at will not find it. It is on a page now because the
 * strongest thing this project has is not a feature, it is a set of numbers
 * that were produced honestly, including the ones that came back negative.
 *
 * Two rules govern this page:
 *
 *   1. Every result states what it does NOT prove, in the same size type as
 *      what it does. A page that only lists wins reads as marketing, and a
 *      technical reader will discount all of it once they find the first
 *      unstated limitation.
 *
 *   2. Nothing here is computed at render time. These are transcriptions of
 *      recorded runs, with the command that reproduces each one. A live figure
 *      would be a different claim — "it does this now" rather than "this is
 *      what the run produced" — and the run is the honest artefact.
 */

export const metadata = {
  title: "Evidence · STEALTH",
  description:
    "The measured results behind STEALTH, each stating what it proves and what it does not.",
};

const STATUS_STYLE: Record<Verification["status"], string> = {
  verified: "border-allow-line bg-allow-soft text-allow",
  "verified-by-human": "border-allow-line bg-allow-soft text-allow",
  "not-verified": "border-stepup-line bg-stepup-soft text-stepup",
};

const STATUS_WORD: Record<Verification["status"], string> = {
  verified: "verified",
  "verified-by-human": "verified by a human",
  "not-verified": "not verified",
};

const CARD_TONES = [
  "border-t-accent",
  "border-t-measure",
  "border-t-rail",
  "border-t-evidence",
] as const;

function ResultCard({ result, index }: { result: MeasuredResult; index: number }) {
  return (
    <Panel className={`border-t-2 ${CARD_TONES[index % CARD_TONES.length]}`}>
      <PanelHeader
        title={result.title}
        meta={
          result.command ? (
            <code className="rounded-control border border-measure-line bg-measure-soft px-2 py-[2px] font-mono text-label text-measure">
              {result.command}
            </code>
          ) : null
        }
      />
      <PanelBody className="flex flex-col gap-4">
        <p className="max-w-[88ch] text-body leading-[1.65] text-ink-2">
          {result.summary}
        </p>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-y border-line-soft py-3 sm:grid-cols-3 lg:grid-cols-4">
          {result.figures.map((figure) => (
            <div key={figure.label}>
              <dt className="label-caps">{figure.label}</dt>
              <dd
                className={`mt-0.5 font-mono tabular-nums ${
                  figure.emphasis
                    ? "text-head font-semibold text-measure"
                    : "text-lead text-ink"
                }`}
              >
                {figure.value}
              </dd>
            </div>
          ))}
        </dl>

        <div className="grid grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-2">
          <div>
            <h3 className="label-caps text-allow">What this proves</h3>
            <p className="mt-1.5 text-body leading-[1.65] text-ink-2">
              {result.proves}
            </p>
          </div>
          <div>
            <h3 className="label-caps text-stepup">What it does not prove</h3>
            <p className="mt-1.5 text-body leading-[1.65] text-ink-2">
              {result.doesNotProve}
            </p>
          </div>
        </div>
      </PanelBody>
    </Panel>
  );
}

export default function EvidencePage() {
  const notVerified = RAZORPAY_VERIFICATION.filter(
    (row) => row.status === "not-verified",
  ).length;

  return (
    <main className="mx-auto flex max-w-[1100px] flex-col px-6 pt-8 pb-10">
      <div className="relative border-b border-line pb-6">
        <h1 className="font-display flex items-center gap-2.5 text-page font-bold text-ink">
          <IconVerdict className="h-6 w-6 text-measure" />
          Evidence
        </h1>
        <p className="mt-2 max-w-[76ch] text-body leading-[1.65] text-ink-2">
          Every figure below came from a run you can repeat, and every one says
          what it does not prove alongside what it does. Two of the results are
          negative and one documents a bug we shipped and caught. They are here
          at the same weight as the good numbers, because a page that only lists
          wins is not evidence.
        </p>
        <div
          aria-hidden
          className="absolute bottom-[-1px] left-0 h-[2px] w-24 bg-measure"
        />
      </div>

      {/* ---------------------------------------------------------- results */}
      <div className="mt-6 flex flex-col gap-4">
        {ALL_RESULTS.map((result, index) => (
          <ResultCard key={result.id} result={result} index={index} />
        ))}
      </div>

      {/* --------------------------------------------------------- razorpay */}
      <section className="mt-10">
        <h2 className="font-display text-head font-bold text-ink">
          Razorpay: exactly what is verified
        </h2>
        <p className="mt-2 max-w-[80ch] text-body leading-[1.65] text-ink-2">
          Four different things get called &ldquo;verified&rdquo; in write-ups
          like this one and they are not the same, so they are split out.{" "}
          {notVerified} of the {RAZORPAY_VERIFICATION.length} rows below are
          still unverified and say so.
        </p>

        <div className="mt-4 overflow-hidden rounded-panel border border-line bg-surface">
          <ul>
            {RAZORPAY_VERIFICATION.map((row) => (
              <li
                key={row.claim}
                className="flex flex-col gap-1.5 border-b border-line-soft px-4 py-3 last:border-b-0 sm:flex-row sm:items-start sm:gap-4"
              >
                <span
                  className={`inline-flex h-[22px] shrink-0 items-center rounded-control border px-2 font-mono text-label whitespace-nowrap sm:order-2 sm:ml-auto ${STATUS_STYLE[row.status]}`}
                >
                  {STATUS_WORD[row.status]}
                </span>
                <div className="min-w-0 sm:order-1">
                  <div className="text-body font-medium text-ink">{row.claim}</div>
                  <p className="mt-1 max-w-[80ch] text-meta leading-[1.6] text-ink-2">
                    {row.evidence}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ------------------------------------------------------------ tests */}
      <section className="mt-10 border-t border-line pt-6">
        <h2 className="font-display text-head font-bold text-ink">Reproducing all of it</h2>
        <p className="mt-2 max-w-[80ch] text-body leading-[1.65] text-ink-2">
          The suite covers the mandate verifier, the hash chain, the threshold
          policy, the Razorpay client and webhook, the rate-limit guard, the
          step-up race, and boot configuration. Model clients are mocked, so no
          test ever calls a live API, and none needs a key.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-panel border border-line bg-inset px-4 py-3 font-mono text-meta leading-[1.8] text-ink-2">
{`npm test                     # ${TEST_COUNT} unit and integration tests
npm run eval                 # 21 labelled cases, real pipeline
npm run eval:credentials     # 100,000 adversarial credentials
npm run eval:credentials -- 100000 --self-test   # the negative control
npm run eval:semantic        # boundary cases, model in the loop
npm run razorpay:verify      # one real order, test mode only`}
        </pre>
        <p className="mt-4 max-w-[80ch] text-meta leading-[1.6] text-ink-3">
          The credential and semantic numbers must never be summed. A credential
          rejection and a semantic judgement are not the same unit of work, and
          adding them would produce a throughput figure that describes nothing.
        </p>
      </section>
    </main>
  );
}
