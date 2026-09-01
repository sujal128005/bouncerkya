import type { Metadata } from "next";
import type { ReactNode } from "react";

// Self-hosted, so the UI renders identically offline and on a conference wifi
// that blocks font CDNs. Space Grotesk carries the identity; IBM Plex Mono
// carries every id, hash, amount and timestamp. Inter stays installed purely
// as the fallback in the stack.
import "@fontsource-variable/space-grotesk";
import "@fontsource-variable/inter";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "./globals.css";

import { SiteFooter } from "@/app/_components/site-footer";
import { TopBar } from "@/app/_components/top-bar";

export const metadata: Metadata = {
  title: "STEALTH · Know Your Agent",
  description:
    "Trust gateway for AI-driven checkout: verifies that what an agent is buying matches what its human authorized.",
  // Attribution in the document head as well as in the footer, so it survives
  // a screenshot, a scrape, and anyone who reads the page source.
  authors: [{ name: "Made Navya", url: "https://linkedin.com/in/navya-made-7236b633a/" }],
  creator: "Made Navya",
};

/*
 * Applied before the first paint, so a viewer who chose light never sees the
 * dark page flash first. It has to be inline and synchronous in <head>: any
 * React-side effect runs after the browser has already painted, and a deferred
 * or external script would too.
 *
 * Wrapped in try/catch because localStorage throws outright in some contexts
 * (private windows, blocked site data, thumbnail capture). Falling back to the
 * default theme is correct there; an exception in <head> is not.
 */
const THEME_SCRIPT = `try{var t=localStorage.getItem("stealth.theme");if(t==="light"||t==="dark"){document.documentElement.dataset.theme=t}}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning: the script above mutates <html> before React
    // sees it, which is the entire point and not a mismatch worth reporting.
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">
        <TopBar />
        <div className="flex-1">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}


