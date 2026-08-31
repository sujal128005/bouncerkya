import { IconChain, IconMandate } from "@/app/_components/icons";
import { Panel, PanelBody, PanelHeader } from "@/app/_components/ui";
import {
  ABSENT,
  CONTROLS,
  WHAT_THIS_DEPLOYMENT_IS,
  type Control,
} from "@/lib/privacy/disclosures";

/**
 * The privacy page.
 *
 * It is built exactly like /evidence, and the symmetry is the point: every
 * control states what it does NOT protect against, in the same size type as
 * what it does. A page that lists only capabilities reads as a brochure, and a
 * reviewer who finds the first unstated limitation themselves will discount
 * everything above it.
 *
 * The most important paragraph is the first one, and it undercuts the rest on
 * purpose. This deployment holds invented people. Claiming to protect somebody
 * over a database of fictional names would be precisely the overclaim the
 * evidence page spends its whole length avoiding.
 */

export const metadata = {
  title: "Privacy · Bouncer",
  description:
    "The three privacy controls in Bouncer, each with what it protects against and what it does not.",
};

const TONES = [
  "border-t-accent",
  "border-t-cyan",
  "border-t-violet",
  "border-t-fuchsia",
] as const;

function ControlCard({ control, index }: { control: Control; index: number }) {
  return (
    <Panel className={`border-t-2 ${TONES[index % TONES.length]}`}>
      <PanelHeader
        title={control.title}
        meta={
          <code className="rounded-control border border-cyan-line bg-cyan-soft px-2 py-[2px] font-mono text-label text-cyan">
            {control.tests}
          </code>
        }
      />
      <PanelBody className="flex flex-col gap-4">
        <p className="max-w-[84ch] text-lead leading-[1.6] text-ink">
          {control.headline}
        </p>

        <div>
          <h3 className="label-caps">How it works</h3>
          <p className="mt-1.5 max-w-[88ch] text-body leading-[1.65] text-ink-2">
            {control.how}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-x-8 gap-y-4 border-t border-line-soft pt-4 md:grid-cols-2">
          <div>
            <h3 className="label-caps text-allow">What it protects against</h3>
            <p className="mt-1.5 text-body leading-[1.65] text-ink-2">
              {control.protects}
            </p>
          </div>
          <div>
            <h3 className="label-caps text-stepup">What it does NOT protect against</h3>
            <p className="mt-1.5 text-body leading-[1.65] text-ink-2">
              {control.doesNotProtect}
            </p>
          </div>
        </div>

        <div className="border-t border-line-soft pt-3">
          <h3 className="label-caps">Check it yourself</h3>
          <p className="mt-1.5 text-meta leading-[1.6] text-ink-2">
            {control.verify}
          </p>
        </div>
      </PanelBody>
    </Panel>
  );
}

export default function PrivacyPage() {
  return (
    <main className="mx-auto flex max-w-[1100px] flex-col px-6 pt-8 pb-10">
      <div className="relative border-b border-line pb-6">
        <h1 className="font-display flex items-center gap-2.5 text-page font-bold text-ink">
          <IconMandate className="h-6 w-6 text-violet" />
          Privacy
        </h1>
        <p className="mt-3 max-w-[80ch] text-body leading-[1.7] text-ink-2">
          {WHAT_THIS_DEPLOYMENT_IS}
        </p>
        <div
          aria-hidden
          className="absolute bottom-[-1px] left-0 h-[2px] w-24 bg-violet"
        />
      </div>

      {/* ------------------------------------------------------- the claim */}
      <section className="band-violet -mx-6 mt-6 rounded-panel px-6 py-6">
        <h2 className="font-display text-head font-bold text-ink">
          The exposure nobody writes about
        </h2>
        <p className="mt-2 max-w-[84ch] text-body leading-[1.7] text-ink-2">
          An agentic-commerce system has an unusual privacy problem: to decide
          whether a cart is legitimate, something has to read the cart. In this
          product that something is a large language model, and it runs at a
          third party. Every byte of that prompt leaves the machine, crosses the
          public internet, and lands in somebody else&rsquo;s logs, retention
          window and jurisdiction.
        </p>
        <p className="mt-3 max-w-[84ch] text-body leading-[1.7] text-ink-2">
          The usual answer is to hand the model the whole request object,
          because it is easier, and the shopper&rsquo;s name and account id go
          with it. Bouncer sends the basket and withholds the identity, and
          enforces that at runtime rather than trusting itself to remember.
        </p>
      </section>

      {/* ---------------------------------------------------- the controls */}
      <div className="mt-6 flex flex-col gap-4">
        {CONTROLS.map((control, index) => (
          <ControlCard key={control.id} control={control} index={index} />
        ))}
      </div>

      {/* -------------------------------------------------------- the gaps */}
      <section className="mt-10">
        <h2 className="font-display flex items-center gap-2 text-head font-bold text-ink">
          <IconChain className="h-5 w-5 text-fuchsia" />
          Designed, and not built
        </h2>
        <p className="mt-2 max-w-[84ch] text-body leading-[1.65] text-ink-2">
          A privacy section that lists only what exists invites a reader to
          assume the rest. These are the gaps, named by the author rather than
          found by the reviewer.
        </p>

        <div className="mt-4 overflow-hidden rounded-panel border border-line bg-surface">
          <ul>
            {ABSENT.map((gap) => (
              <li
                key={gap.what}
                className="flex flex-col gap-1.5 border-b border-line-soft px-4 py-3 last:border-b-0 sm:flex-row sm:items-start sm:gap-4"
              >
                <span className="inline-flex h-[22px] shrink-0 items-center rounded-control border border-stepup-line bg-stepup-soft px-2 font-mono text-label whitespace-nowrap text-stepup sm:order-2 sm:ml-auto">
                  not built
                </span>
                <div className="min-w-0 sm:order-1">
                  <div className="text-body font-medium text-ink">{gap.what}</div>
                  <p className="mt-1 max-w-[80ch] text-meta leading-[1.6] text-ink-2">
                    {gap.why}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ------------------------------------------------------ reproduce */}
      <section className="mt-10 border-t border-line pt-6">
        <h2 className="font-display text-head font-bold text-ink">
          Checking all of it
        </h2>
        <pre className="mt-4 overflow-x-auto rounded-panel border border-line bg-inset px-4 py-3 font-mono text-meta leading-[1.8] text-ink-2">
{`npm run privacy:audit        # tracked secrets, ignore rules, NEXT_PUBLIC_
npm run privacy:keygen       # a fresh AES-256 key for .env
npx vitest run lib/privacy   # 68 tests across the three controls

# the at-rest claim, checked against the file rather than the code
npm run db:reset             # with the dev server stopped
grep -c "Aarav Menon" prisma/dev.db     # 0
grep -c "bnc1." prisma/dev.db           # every sealed value`}
        </pre>
        <p className="mt-4 max-w-[84ch] text-meta leading-[1.6] text-ink-3">
          The encryption key is required. Bouncer refuses to start without it
          rather than falling back to plaintext, because a deployment that
          silently stored plaintext would still render, still decide correctly,
          and still describe itself as encrypted on this page.
        </p>
      </section>
    </main>
  );
}
