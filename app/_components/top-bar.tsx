"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { IconHuman, IconLedger, IconMandate, IconVerdict } from "./icons";
import { ThemeToggle } from "./theme-toggle";

/**
 * The header.
 *
 * Five destinations, each named for what it contains rather than for what it
 * is built from: Overview explains, Requests lists, Approvals is a queue you
 * act on, Evidence is the proof, Privacy is the limits. The previous nav
 * offered "Console" and "Inbox", two words that tell a first-time reader
 * nothing about which one
 * they want.
 *
 * The active tab is marked by an underline AND a weight change, never by
 * colour alone.
 */

const NAV = [
  { href: "/", label: "Overview", Icon: null, exact: true },
  { href: "/requests", label: "Requests", Icon: IconLedger, exact: false },
  { href: "/approvals", label: "Approvals", Icon: IconHuman, exact: false },
  { href: "/evidence", label: "Evidence", Icon: IconVerdict, exact: false },
  { href: "/privacy", label: "Privacy", Icon: IconMandate, exact: false },
] as const;

export function TopBar() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-20 h-14 border-b border-line bg-surface">
      {/*
        Measured at 390px before this was written: four nav items, the brand
        and two status chips overflowed the viewport by 282px, and the page
        scrolled sideways. The nav is the flexible element — it scrolls inside
        itself rather than pushing the document — and the chips, which are
        context rather than navigation, drop out first.
      */}
      <div className="mx-auto flex h-full max-w-[1440px] items-center gap-4 px-4 sm:gap-6 sm:px-6">
        <Link href="/" className="flex shrink-0 items-baseline gap-2">
          <span className="bg-gradient-to-r from-accent-strong via-rail to-measure bg-clip-text font-mono text-lead font-semibold tracking-[0.16em] text-transparent">
            STEALTH
          </span>
          <span className="hidden text-meta text-ink-2 lg:inline">
            Know Your Agent
          </span>
        </Link>

        <nav className="flex h-full min-w-0 flex-1 items-stretch gap-1 overflow-x-auto">
          {NAV.map((item) => {
            const active = item.exact
              ? pathname === item.href
              : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex shrink-0 items-center gap-2 border-b-2 px-3 text-body whitespace-nowrap transition-colors ${
                  active
                    ? "border-accent font-semibold text-ink"
                    : "border-transparent font-medium text-ink-2 hover:border-line-strong hover:text-ink"
                }`}
              >
                {item.Icon ? (
                  <item.Icon className="hidden h-4 w-4 sm:block" />
                ) : null}
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden font-mono text-label tracking-[0.04em] text-ink-3 xl:inline">
            local · sqlite
          </span>
          <span className="hidden items-center rounded-control border border-line bg-inset px-2 py-[1px] font-mono text-label tracking-[0.04em] whitespace-nowrap text-ink-2 md:inline-flex">
            razorpay test mode
          </span>
          {/* Stays at every width: on a phone the chips drop out but the
              theme switch is the one control here, so it keeps its place. */}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
