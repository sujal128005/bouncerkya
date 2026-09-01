import Link from "next/link";

/**
 * The footer.
 *
 * It carries the one sentence that explains the whole product, plus an honest
 * statement of what this deployment actually is. A judge landing on the console
 * cold should be able to look down and learn three things: what STEALTH does,
 * that the model recommends rather than decides, and that Razorpay is in test
 * mode with no real money involved.
 *
 * No link farm, no social icons, no newsletter. Every line is either the
 * product's thesis or a disclosure.
 */
export function SiteFooter() {
  return (
    <footer className="mt-10 border-t border-line bg-surface">
      <div className="mx-auto max-w-[1440px] px-6 py-8">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <div className="font-mono text-body font-semibold tracking-[0.16em] text-ink">
              STEALTH
            </div>
            <p className="mt-2 max-w-[52ch] text-body leading-[1.6] text-ink-2">
              A trust gateway between an AI shopping agent and checkout. It
              verifies the agent&rsquo;s signed mandate, diffs the cart against
              what the human actually authorized, and decides deterministically.
              The model only ever recommends.
            </p>
          </div>

          <div>
            <div className="label-caps">The pipeline</div>
            <ol className="mt-3 flex flex-col gap-1.5 font-mono text-label text-ink-2">
              <li>1 · mandate verified</li>
              <li>2 · evidence extracted</li>
              <li>3 · intent diffed</li>
              <li>4 · policy decides</li>
              <li>5 · human escalation</li>
              <li>6 · audit chained</li>
            </ol>
          </div>

          <div>
            <div className="label-caps">This deployment</div>
            <ul className="mt-3 flex flex-col gap-1.5 text-label text-ink-2">
              <li>Razorpay, test mode only</li>
              <li>No payment is ever captured</li>
              <li>SQLite, local, unauthenticated</li>
              <li>Seeded demo data</li>
            </ul>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
              {[
                { href: "/", label: "Overview" },
                { href: "/requests", label: "Requests" },
                { href: "/approvals", label: "Approvals" },
                { href: "/evidence", label: "Evidence" },
                { href: "/privacy", label: "Privacy" },
              ].map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="text-label text-accent underline underline-offset-2 hover:text-accent-strong"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        </div>

        {/*
          The byline sits opposite the disclosure, on the same rule, at the
          same weight as everything else down here. A hackathon judge should be
          able to find out who built this without it ever having competed with
          the product for attention higher up the page.
        */}
        <div className="mt-8 flex flex-col gap-3 border-t border-line-soft pt-4 sm:flex-row sm:items-baseline sm:justify-between sm:gap-8">
          <p className="max-w-[76ch] text-label leading-[1.5] text-ink-3">
            Built for the Razorpay AI Buildathon. Every metric in the README
            states what it proves and what it does not, including the ones that
            came back negative.
          </p>

          <a
            href="https://linkedin.com/in/navya-made-7236b633a/"
            target="_blank"
            rel="noreferrer noopener"
            className="group inline-flex shrink-0 items-baseline gap-1.5 text-label whitespace-nowrap text-ink-3 transition-colors hover:text-ink-2"
          >
            Made by
            <span className="bg-gradient-to-r from-accent-strong via-rail to-measure bg-clip-text font-medium text-transparent">
              Made Navya
            </span>
            <span
              aria-hidden
              className="text-ink-3 transition-transform group-hover:-translate-y-px group-hover:translate-x-px"
            >
              &#8599;
            </span>
            <span className="sr-only">(opens LinkedIn in a new tab)</span>
          </a>
        </div>
      </div>
    </footer>
  );
}



