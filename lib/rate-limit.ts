/**
 * Server-side protection for expensive endpoints.
 *
 * WHY THIS EXISTS
 *
 * `/api/agent/run` starts a live model conversation of up to 12 turns and, on
 * an ALLOW, creates a real Razorpay test-mode order. Before this file the only
 * thing stopping a second concurrent run was a `disabled` attribute on a
 * button — which is to say, nothing. The button is client state; `curl` does
 * not have it, and neither does a double-click that lands before React
 * re-renders. A judge clicking impatiently could have started six live agent
 * runs and created six orders.
 *
 * Two separate protections, because they answer two different questions:
 *
 *   singleFlight  "is one already running?"      -> 409, immediately
 *   rateLimit     "have too many run recently?"  -> 429, with a retry hint
 *
 * DELIBERATELY IN-MEMORY. Bouncer is a single-instance demo console; a Redis
 * dependency would be infrastructure added for its own sake. The honest
 * limitations are that the counters reset when the server restarts and would
 * not be shared across instances. Both are stated here rather than discovered
 * later, and neither weakens the guarantee this actually provides: no unbounded
 * spend from one browser in one session.
 *
 * This is a cost and abuse control, NOT the security boundary. Mandate
 * verification and the threshold policy are the security boundary and they run
 * regardless of what happens here.
 */

export type RateLimitVerdict =
  | { ok: true }
  | { ok: false; code: "in_flight"; detail: string }
  | { ok: false; code: "rate_limited"; detail: string; retryAfterMs: number };

export type RateLimitOptions = {
  /** Most starts permitted inside the window. */
  limit: number;
  windowMs: number;
  /** Injected in tests so the window is not wall-clock dependent. */
  now?: () => number;
};

/**
 * One at a time, N per window. `release()` must be called in a `finally` — a
 * leaked slot would wedge the endpoint until restart, which is a worse failure
 * than the one this prevents.
 */
export class ExpensiveEndpointGuard {
  private inFlight = false;
  private starts: number[] = [];
  private readonly now: () => number;

  constructor(private readonly options: RateLimitOptions) {
    this.now = options.now ?? Date.now;
  }

  /** Checks and, when permitted, reserves the slot. Not a pure predicate. */
  tryAcquire(): RateLimitVerdict {
    if (this.inFlight) {
      return {
        ok: false,
        code: "in_flight",
        detail:
          "A live agent run is already in progress. Wait for it to finish. Starting a second run would spend real model calls and could create a duplicate order.",
      };
    }

    const at = this.now();
    const windowStart = at - this.options.windowMs;
    this.starts = this.starts.filter((t) => t > windowStart);

    if (this.starts.length >= this.options.limit) {
      const oldest = this.starts[0]!;
      const retryAfterMs = Math.max(0, oldest + this.options.windowMs - at);
      return {
        ok: false,
        code: "rate_limited",
        detail: `Rate limit: ${this.options.limit} live agent runs per ${Math.round(
          this.options.windowMs / 60_000,
        )} minutes. Every run costs real model calls, so the limit is deliberate.`,
        retryAfterMs,
      };
    }

    this.starts.push(at);
    this.inFlight = true;
    return { ok: true };
  }

  release(): void {
    this.inFlight = false;
  }

  /** Test-only. */
  reset(): void {
    this.inFlight = false;
    this.starts = [];
  }
}

/**
 * Six runs per five minutes: comfortably more than a judge needs to see a
 * clean run, an adversarial run and a retry, and far below anything that could
 * run up a bill.
 *
 * Module scope deliberately — Next keeps route modules alive between requests
 * in a single instance, which is exactly the sharing this needs.
 */
export const agentRunGuard = new ExpensiveEndpointGuard({
  limit: 6,
  windowMs: 5 * 60_000,
});
