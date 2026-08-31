"use client";

import { useState } from "react";

import type { RevealableField } from "@/lib/privacy/redact";

/**
 * A redacted value with a deliberate way to see the whole of it.
 *
 * The important detail is what this component is NOT given: the full value.
 * It receives only the truncated string the server chose to send, so the
 * complete signature or account id is not in the props, not in the React
 * payload, and not in view-source. Fetching it is a separate, explicit
 * request, which is what makes "revealed" a thing that happened rather than a
 * thing that was always true and merely styled out of sight.
 */
export function Reveal({
  requestId,
  field,
  redacted,
  label,
}: {
  requestId: string;
  field: RevealableField;
  /** The truncated form. The only form this component ever starts with. */
  redacted: string;
  /** Announced to screen readers, since "reveal" alone says nothing useful. */
  label: string;
}) {
  const [value, setValue] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "failed">("idle");

  async function reveal() {
    setState("loading");
    try {
      const response = await fetch("/api/reveal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId, field }),
      });
      const body = (await response.json()) as { value?: string; detail?: string };
      if (!response.ok || typeof body.value !== "string") {
        setState("failed");
        return;
      }
      setValue(body.value);
      setState("idle");
    } catch {
      setState("failed");
    }
  }

  if (value !== null) {
    return (
      <span className="font-mono text-meta break-all text-ink">
        {value}
        <span className="ml-2 font-mono text-label text-ink-3">revealed</span>
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-baseline gap-2">
      <span className="font-mono text-meta break-all text-ink">{redacted}</span>
      <button
        type="button"
        onClick={() => void reveal()}
        disabled={state === "loading"}
        className="rounded-control border border-line px-1.5 py-[1px] font-mono text-label text-ink-3 transition-colors hover:border-cyan hover:text-cyan disabled:opacity-50"
      >
        {state === "loading" ? "…" : state === "failed" ? "retry" : "reveal"}
        <span className="sr-only"> the full {label}</span>
      </button>
    </span>
  );
}
