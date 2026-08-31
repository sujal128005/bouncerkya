import { describe, expect, it } from "vitest";

import { ExpensiveEndpointGuard } from "./rate-limit";

/**
 * These tests exist because the protection they cover replaced a `disabled`
 * attribute on a button. A judge with curl, or a double-click landing before
 * React re-renders, could previously start unbounded concurrent live agent
 * runs — each one a dozen model calls and possibly a Razorpay order.
 */
describe("ExpensiveEndpointGuard", () => {
  const guardAt = (clock: { t: number }) =>
    new ExpensiveEndpointGuard({ limit: 3, windowMs: 60_000, now: () => clock.t });

  it("admits the first caller", () => {
    const guard = guardAt({ t: 0 });
    expect(guard.tryAcquire()).toEqual({ ok: true });
  });

  it("refuses a second caller while one is in flight", () => {
    const guard = guardAt({ t: 0 });
    guard.tryAcquire();

    const second = guard.tryAcquire();
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("unreachable");
    expect(second.code).toBe("in_flight");
  });

  it("admits the next caller once the first releases", () => {
    const guard = guardAt({ t: 0 });
    guard.tryAcquire();
    guard.release();
    expect(guard.tryAcquire()).toEqual({ ok: true });
  });

  it("does not consume a slot when it refuses", () => {
    const clock = { t: 0 };
    const guard = guardAt(clock);

    guard.tryAcquire();
    guard.tryAcquire(); // refused: in flight
    guard.tryAcquire(); // refused: in flight
    guard.release();

    // Only ONE start was recorded, so two remain in the window of three.
    expect(guard.tryAcquire()).toEqual({ ok: true });
    guard.release();
    expect(guard.tryAcquire()).toEqual({ ok: true });
    guard.release();

    const fourth = guard.tryAcquire();
    expect(fourth.ok).toBe(false);
  });

  it("rate limits after the configured number of starts", () => {
    const clock = { t: 0 };
    const guard = guardAt(clock);

    for (let i = 0; i < 3; i += 1) {
      expect(guard.tryAcquire().ok).toBe(true);
      guard.release();
      clock.t += 1000;
    }

    const fourth = guard.tryAcquire();
    expect(fourth.ok).toBe(false);
    if (fourth.ok) throw new Error("unreachable");
    expect(fourth.code).toBe("rate_limited");
  });

  it("reports how long to wait, and the window really does expire", () => {
    const clock = { t: 0 };
    const guard = guardAt(clock);

    for (let i = 0; i < 3; i += 1) {
      guard.tryAcquire();
      guard.release();
    }

    const refused = guard.tryAcquire();
    if (refused.ok || refused.code !== "rate_limited") {
      throw new Error("expected a rate-limited verdict");
    }
    expect(refused.retryAfterMs).toBe(60_000);

    // One millisecond before the window closes: still refused.
    clock.t += 59_999;
    expect(guard.tryAcquire().ok).toBe(false);

    // Past it: admitted again.
    clock.t += 2;
    expect(guard.tryAcquire()).toEqual({ ok: true });
  });

  it("survives ten impatient clicks without leaking the slot", () => {
    const clock = { t: 0 };
    const guard = guardAt(clock);

    const verdicts = Array.from({ length: 10 }, () => guard.tryAcquire());
    expect(verdicts.filter((v) => v.ok)).toHaveLength(1);
    expect(verdicts.filter((v) => !v.ok && v.code === "in_flight")).toHaveLength(9);

    guard.release();
    expect(guard.tryAcquire()).toEqual({ ok: true });
  });
});
