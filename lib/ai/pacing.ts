import type { EngineResult } from "./engine";

/**
 * Rate-limit pacing for BATCH callers — seeding and the manual check — not for
 * the engine itself.
 *
 * The engine deliberately does not retry transport failures: inside a live
 * checkout, sitting on a 429 spends the shopper's patience for a request that
 * may never succeed. But seeding eight scenarios against a free tier is a
 * different problem, and free tiers hand you the answer in the error body
 * ("Please try again in 16.59s"), so the honest fix is to wait exactly that
 * long and try again — at the call site, where the batch semantics live.
 */

const RETRY_HINT = /try again in\s+(?:(\d+)\s*m)?\s*(\d+(?:\.\d+)?)\s*s/i;

export function isRateLimited(details: string): boolean {
  return /\b429\b|rate[\s_-]?limit/i.test(details);
}

/** Reads the provider's own "try again in Xs" hint. Null when absent. */
export function parseRetryAfterMs(details: string): number | null {
  const match = RETRY_HINT.exec(details);
  if (!match) return null;

  const minutes = match[1] ? Number(match[1]) : 0;
  const seconds = Number(match[2]);
  if (!Number.isFinite(seconds)) return null;

  return Math.ceil((minutes * 60 + seconds) * 1000);
}

export const DEFAULT_FALLBACK_WAIT_MS = 20_000;
export const DEFAULT_MAX_WAIT_MS = 90_000;
export const DEFAULT_MAX_WAITS = 3;

export type PacingOptions = {
  maxWaits?: number;
  maxWaitMs?: number;
  fallbackWaitMs?: number;
  onWait?: (waitMs: number, attempt: number) => void;
  sleep?: (ms: number) => Promise<void>;
};

const realSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs an engine call, waiting out rate limits. Any other failure is returned
 * immediately and unchanged — this only ever buys time, it never converts a
 * failure into a success.
 */
export async function withRateLimitPacing(
  run: () => Promise<EngineResult>,
  options: PacingOptions = {},
): Promise<EngineResult> {
  const maxWaits = options.maxWaits ?? DEFAULT_MAX_WAITS;
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const fallbackWaitMs = options.fallbackWaitMs ?? DEFAULT_FALLBACK_WAIT_MS;
  const sleep = options.sleep ?? realSleep;

  let waits = 0;

  for (;;) {
    const result = await run();

    if (result.success) return result;
    if (result.failureReason !== "api_error") return result;
    if (!isRateLimited(result.details)) return result;
    if (waits >= maxWaits) return result;

    waits += 1;
    const waitMs = Math.min(
      parseRetryAfterMs(result.details) ?? fallbackWaitMs,
      maxWaitMs,
    );
    options.onWait?.(waitMs, waits);
    await sleep(waitMs);
  }
}
