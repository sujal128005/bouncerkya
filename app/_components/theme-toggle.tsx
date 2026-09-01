"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Light/dark switch.
 *
 * The theme is applied by an inline script in the document head, BEFORE React
 * hydrates, so a viewer who chose light never sees the dark page flash first.
 * This component reflects and changes that state; it does not own it. The
 * source of truth is the `data-theme` attribute on <html>.
 *
 * WHY useSyncExternalStore AND NOT useState + useEffect
 *
 * The obvious version reads the attribute in an effect and calls setState.
 * That works, and `react-hooks/set-state-in-effect` rejects it, correctly: it
 * renders once with a value known to be wrong, then immediately renders again.
 * useSyncExternalStore is the API React provides for this exact shape — a
 * mutable source outside React, with a separate snapshot for the server, where
 * the server genuinely cannot know which theme this particular viewer picked.
 */

const STORAGE_KEY = "stealth.theme";
type Theme = "dark" | "light";

/** Subscribers, so a toggle in one place would update any other instance. */
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

/**
 * The server has no idea which theme this viewer chose, and dark is the
 * default, so that is what it renders. The head script has already corrected
 * the actual page colours by the time this matters; only the icon flips.
 */
function getServerSnapshot(): Theme {
  return "dark";
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = useCallback(() => {
    const next: Theme = getSnapshot() === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private windows and blocked site data throw here. The theme still
      // applies to this page; it just will not be remembered, which is a far
      // better outcome than an unhandled error in the header.
    }
    for (const listener of listeners) listener();
  }, []);

  const label = `Switch to ${theme === "light" ? "dark" : "light"} theme`;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-control border border-line text-ink-3 transition-colors hover:border-line-strong hover:text-ink"
    >
      {theme === "light" ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}

/* Drawn to the same spec as the rest of the icon set: 1.5px strokes, 24px box,
 * round caps, currentColor. Borrowing an icon from another family is one of
 * the fastest ways to make an interface look assembled rather than designed. */

function SunIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="h-4 w-4"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="h-4 w-4"
    >
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
    </svg>
  );
}
