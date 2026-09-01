import Link from "next/link";

import {
  IconAgent,
  IconHuman,
  IconLedger,
  IconMandate,
  IconVerdict,
} from "@/app/_components/icons";
import { PIPELINE, type Stage } from "@/lib/evidence";
import { verifyAuditChain } from "@/lib/audit";
import { listScenarios } from "@/lib/scenarios";

/**
 * The landing page.
 *
 * This route used to `redirect("/console")`, which meant the first thing any
 * visitor saw was eight hex ids and a dense evidence grid, with the sentence
 * explaining the product two thousand pixels below in the footer. A reader who
 * does not already know what STEALTH is could not find out.
 *
 * So this page answers three questions in order, and nothing else: what
 * problem is this, how does it work, and what has actually been measured. The
 * pipeline is the centrepiece because the pipeline IS the product — the whole
 * argument is that a deterministic gate wraps a model, rather than a model
 * being trusted to gate itself.
 *
 * The live counts are read from the database, so this page cannot claim a
 * decision the console does not also show. If the database is unreachable the
 * page still renders: an explanation that needs a working database to be
 * legible is not much of an explanation.
 */

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<Stage["kind"], string> = {
  deterministic: "deterministic",
  model: "model call",
  human: "human",
};

/**
 * The one visual distinction that matters on this page: which stages are code
 * and which is the model. Reversed emphasis on the model stage, so the eye
 * lands on the single place judgement enters the system.
 */
const KIND_STYLE: Record<Stage["kind"], string> = {
  deterministic: "border-measure-line bg-measure-soft text-measure",
  model: "border-accent bg-accent text-white",
  human: "border-stepup-line bg-stepup-soft text-stepup",
};

/*
 * The stage number takes the same hue as its kind, so the reader learns the
 * colour once and can then count deterministic stages without reading a word:
 * five measure, one indigo. The human stage is amber because it IS the step-up
 * stage -- that is the one place a functional colour legitimately appears
 * outside a verdict, and it appears there because it means the same thing.
 */
const KIND_RING: Record<Stage["kind"], string> = {
  deterministic: "border-measure-line bg-measure-soft text-measure",
  model: "border-accent bg-accent-soft text-accent-strong",
  human: "border-stepup-line bg-stepup-soft text-stepup",
};

/*
 * The number is drawn exactly as it is on the request detail page, because it
 * means the same thing in both places: this is step N of a fixed sequence. Two
 * different treatments for one concept is how a reader learns the two are
 * unrelated, which is the opposite of what this page is for.
 */
function StageRow({ stage }: { stage: Stage }) {
  return (
    <li className="flex gap-4 border-b border-line-soft py-4 last:border-b-0">
      <div className="flex shrink-0 justify-center">
        <span
          className={`flex h-8 w-8 items-center justify-center rounded-full border font-mono text-meta font-semibold tabular-nums ${KIND_RING[stage.kind]}`}
        >
          {stage.n}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 className="text-lead font-semibold text-ink">{stage.name}</h3>
          <span
            className={`inline-flex items-center rounded-control border px-2 py-[1px] font-mono text-label tracking-[0.04em] ${KIND_STYLE[stage.kind]}`}
          >
            {KIND_LABEL[stage.kind]}
          </span>
          <span className="font-mono text-label text-ink-3">{stage.cost}</span>
        </div>
        <p className="mt-1.5 max-w-[76ch] text-body leading-[1.6] text-ink-2">
          {stage.what}
        </p>
      </div>
    </li>
  );
}

/** Four counters, four decorative hues, none of them a verdict colour. */
const STAT_TONE = {
  indigo: { rule: "border-accent", value: "text-accent-strong" },
  measure: { rule: "border-measure-line", value: "text-measure" },
  rail: { rule: "border-rail-line", value: "text-rail" },
  evidence: { rule: "border-evidence-line", value: "text-evidence" },
} as const;

function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note?: string;
  tone: keyof typeof STAT_TONE;
}) {
  const t = STAT_TONE[tone];
  return (
    <div className={`border-l-2 pl-4 ${t.rule}`}>
      <div className="label-caps">{label}</div>
      <div
        className={`mt-1 font-mono text-page font-semibold tabular-nums ${t.value}`}
      >
        {value}
      </div>
      {note ? <div className="mt-0.5 text-label text-ink-3">{note}</div> : null}
    </div>
  );
}

type LiveCounts = {
  requests: number;
  blockedBeforeModel: number;
  escalated: number;
  auditEvents: number;
  auditValid: boolean;
};

async function readLiveCounts(): Promise<LiveCounts | null> {
  try {
    const [scenarios, chain] = await Promise.all([
      listScenarios(),
      verifyAuditChain(),
    ]);
    return {
      requests: scenarios.length,
      blockedBeforeModel: scenarios.filter((s) => !s.mandateVerification.valid).length,
      escalated: scenarios.filter((s) => s.decision?.outcome === "STEP_UP").length,
      auditEvents: chain.eventsChecked,
      auditValid: chain.valid,
    };
  } catch {
    // A landing page that 500s because SQLite moved is worse than one that
    // renders without its counters. The console reports the real error.
    return null;
  }
}

export default async function OverviewPage() {
  const counts = await readLiveCounts();

  return (
    <main className="pb-4">
      {/*
        The one large gradient in the product. It is confined to the hero so
        the panels below can keep doing their work with flat surfaces and 1px
        borders: a gradient behind everything would flatten the hierarchy the
        borders are carrying.
      */}
      <section className="hero-band relative">
        <div className="mx-auto max-w-[1440px] px-6 pt-14 pb-12">
          <p className="label-caps text-accent-strong">Know Your Agent</p>
          <h1 className="font-display mt-3 max-w-[22ch] text-hero font-bold text-ink">
            An agent is about to spend{" "}
            <span className="bg-gradient-to-r from-accent-strong via-rail to-measure bg-clip-text text-transparent">
              your money
            </span>
            .
          </h1>
          <p className="mt-5 max-w-[66ch] text-head leading-[1.55] text-ink-2">
            STEALTH sits between an AI shopping agent and Razorpay checkout. It
            verifies the mandate the human signed, diffs the cart against what
            that mandate actually authorized, and allows, blocks, or asks, all
            before anything reaches payment.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/requests"
              className="inline-flex h-11 items-center gap-2 rounded-control border border-accent bg-accent px-5 font-medium text-white shadow-[0_0_24px_-6px_var(--color-accent)] transition-colors hover:border-accent-strong hover:bg-accent-strong"
            >
              <IconLedger className="h-4 w-4" />
              See the decisions
            </Link>
            <Link
              href="/evidence"
              className="inline-flex h-11 items-center gap-2 rounded-control border border-line-strong bg-surface px-5 font-medium text-ink transition-colors hover:border-measure hover:text-measure"
            >
              <IconVerdict className="h-4 w-4 text-measure" />
              What has been measured
            </Link>
            <span className="font-mono text-label text-ink-3">
              no login · seeded demo data · Razorpay test mode
            </span>
          </div>

          {/* One line of authorship, below the calls to action rather than
              beside them, so it never competes with what the page is for. */}
          <a
            href="https://linkedin.com/in/navya-made-7236b633a/"
            target="_blank"
            rel="noreferrer noopener"
            className="group mt-6 inline-flex items-baseline gap-1.5 text-meta text-ink-3 transition-colors hover:text-ink-2"
          >
            Built by
            <span className="bg-gradient-to-r from-accent-strong via-rail to-measure bg-clip-text font-medium text-transparent">
              Made Navya
            </span>
            <span
              aria-hidden
              className="transition-transform group-hover:-translate-y-px group-hover:translate-x-px"
            >
              &#8599;
            </span>
            <span className="sr-only">(opens LinkedIn in a new tab)</span>
          </a>
        </div>
        <div aria-hidden className="accent-rule absolute inset-x-0 bottom-0 h-px" />
      </section>

      <div className="mx-auto max-w-[1440px] px-6">
      {/* --------------------------------------------------------- problem */}
      <section className="grid grid-cols-1 gap-8 border-b border-line py-9 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <h2 className="font-display flex items-center gap-2 text-head font-bold text-ink">
            <IconAgent className="h-5 w-5 text-evidence" />
            The problem
          </h2>
          <p className="mt-3 max-w-[62ch] text-body leading-[1.7] text-ink-2">
            A shopping agent reads product pages written by strangers. Those
            pages can lie, and they can carry instructions aimed at the model
            rather than the shopper. Give that agent a payment method and its
            worst day becomes your chargeback. The usual answer is to make the
            agent harder to fool. But resistance is a property of one model on one
            day, and it is not something you can put in a contract.
          </p>
        </div>
        <div>
          <h2 className="font-display flex items-center gap-2 text-head font-bold text-ink">
            <IconVerdict className="h-5 w-5 text-measure" />
            The position taken here
          </h2>
          <p className="mt-3 max-w-[62ch] text-body leading-[1.7] text-ink-2">
            Do not trust the agent. Check it. The human signs a mandate that
            says what may be bought and up to how much. Every checkout is
            measured against that signed document by code, not by persuasion. A
            model is used for exactly one step, judging where a cart departs
            from an intent, and it never gets the final word. When it fails, the
            request escalates to a human. It never falls through to allow.
          </p>
        </div>
      </section>

      {/* -------------------------------------------------------- pipeline */}
      <section className="band-rail -mx-6 border-b border-line px-6 py-9">
        <h2 className="font-display text-head font-bold text-ink">
          What happens to one checkout
        </h2>
        <p className="mt-2 max-w-[72ch] text-body leading-[1.6] text-ink-2">
          Six stages, in order. Five are deterministic code. One is a model
          call, marked below, and even that one only produces a recommendation.
        </p>

        <ol className="panel-lift mt-5 rounded-panel border border-line bg-surface px-5">
          {PIPELINE.map((stage) => (
            <StageRow key={stage.key} stage={stage} />
          ))}
        </ol>
      </section>

      {/* ----------------------------------------------------------- state */}
      {counts ? (
        <section className="band-measure -mx-6 border-b border-line px-6 py-9">
          <h2 className="font-display text-head font-bold text-ink">
            In this deployment
          </h2>
          <p className="mt-2 max-w-[72ch] text-body leading-[1.6] text-ink-2">
            Read live from the database as you loaded this page. Every one of
            these was decided end to end by the pipeline above.
          </p>
          <div className="mt-5 grid grid-cols-2 gap-y-6 lg:grid-cols-4">
            <Stat
              tone="indigo"
              label="Checkouts decided"
              value={String(counts.requests)}
              note="seeded, plus any live run"
            />
            <Stat
              tone="measure"
              label="Blocked pre-model"
              value={String(counts.blockedBeforeModel)}
              note="bad credential, no model cost"
            />
            <Stat
              tone="rail"
              label="Sent to a human"
              value={String(counts.escalated)}
              note="policy would not decide alone"
            />
            <Stat
              tone="evidence"
              label="Audit chain"
              value={String(counts.auditEvents)}
              note={counts.auditValid ? "events · chain verified" : "events · CHAIN BROKEN"}
            />
          </div>
        </section>
      ) : null}

      {/* -------------------------------------------------------- pointers */}
      <section className="grid grid-cols-1 gap-4 py-9 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            href: "/requests",
            Icon: IconLedger,
            tone: "border-t-accent text-accent-strong hover:border-accent",
            title: "Requests",
            body: "Every checkout an agent attempted, named in plain English, with the evidence and the verdict for each one.",
          },
          {
            href: "/approvals",
            Icon: IconHuman,
            tone: "border-t-rail text-rail hover:border-rail-line",
            title: "Approvals",
            body: "The queue of attempts STEALTH would not decide alone. Approve or reject one and watch it land in the audit chain.",
          },
          {
            href: "/evidence",
            Icon: IconVerdict,
            tone: "border-t-measure text-measure hover:border-measure-line",
            title: "Evidence",
            body: "100,000-case credential benchmark, the semantic evaluation, the Razorpay verification, and what each one does not prove.",
          },
          {
            href: "/privacy",
            Icon: IconMandate,
            tone: "border-t-evidence text-evidence hover:border-evidence-line",
            title: "Privacy",
            body: "The cart reaches the model. The shopper does not. Three controls, each with the limit it does not cover.",
          },
        ].map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className={`group flex flex-col rounded-panel border border-t-2 border-line bg-surface px-4 py-4 transition-colors ${card.tone}`}
          >
            <span className="flex items-center gap-2">
              <card.Icon className="h-4 w-4" />
              <span className="font-display text-lead font-bold text-ink">{card.title}</span>
              <span
                aria-hidden
                className="ml-auto font-mono text-meta transition-transform group-hover:translate-x-0.5"
              >
                &rarr;
              </span>
            </span>
            <span className="mt-2 text-body leading-[1.6] text-ink-2">{card.body}</span>
          </Link>
        ))}
      </section>
      </div>
    </main>
  );
}



