import { describe, expect, it, vi } from "vitest";

import type { EngineResult } from "./engine";
import {
  isRateLimited,
  parseRetryAfterMs,
  withRateLimitPacing,
} from "./pacing";

const GROQ_429 =
  '429 Too Many Requests — {"error":{"message":"Rate limit reached for model `openai/gpt-oss-120b` in organization `org_x` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Used 7013, Requested 3199. Please try again in 16.59s.","type":"tokens","code":"rate_limit_exceeded"}}';

const META: EngineResult["meta"] = {
  model: "m",
  attempts: 1,
  latencyMs: 10,
};

const ok: EngineResult = {
  success: true,
  diff: {
    overallVerdictRecommendation: "consistent",
    confidence: 0.9,
    summary: "fine",
    clauses: [],
  },
  meta: META,
};

const rateLimited: EngineResult = {
  success: false,
  failureReason: "api_error",
  details: GROQ_429,
  meta: META,
};

describe("rate-limit detection", () => {
  it("recognises a Groq 429 body", () => {
    expect(isRateLimited(GROQ_429)).toBe(true);
  });

  it("does not mistake other api errors for rate limits", () => {
    expect(isRateLimited('403 Forbidden — {"code":"permission-denied"}')).toBe(
      false,
    );
    expect(isRateLimited("500 Internal Server Error")).toBe(false);
  });

  it("reads the provider's own retry hint", () => {
    expect(parseRetryAfterMs(GROQ_429)).toBe(16_590);
    expect(parseRetryAfterMs("Please try again in 3.1125s")).toBe(3_113);
    expect(parseRetryAfterMs("Please try again in 1m30s")).toBe(90_000);
    expect(parseRetryAfterMs("no hint here")).toBeNull();
  });
});

describe("withRateLimitPacing", () => {
  it("waits the hinted interval and retries until it succeeds", async () => {
    const sleep = vi.fn(async () => {});
    const run = vi
      .fn<() => Promise<EngineResult>>()
      .mockResolvedValueOnce(rateLimited)
      .mockResolvedValueOnce(ok);

    const result = await withRateLimitPacing(run, { sleep });

    expect(result.success).toBe(true);
    expect(run).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(16_590);
  });

  it("gives up after the wait budget and returns the real failure", async () => {
    const sleep = vi.fn(async () => {});
    const run = vi
      .fn<() => Promise<EngineResult>>()
      .mockResolvedValue(rateLimited);

    const result = await withRateLimitPacing(run, { sleep, maxWaits: 2 });

    expect(result.success).toBe(false);
    expect(run).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("never waits on a non-rate-limit failure", async () => {
    const sleep = vi.fn(async () => {});
    const forbidden: EngineResult = {
      success: false,
      failureReason: "api_error",
      details: '403 Forbidden — {"code":"permission-denied"}',
      meta: META,
    };
    const run = vi.fn<() => Promise<EngineResult>>().mockResolvedValue(forbidden);

    const result = await withRateLimitPacing(run, { sleep });

    expect(result).toBe(forbidden);
    expect(run).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("never waits on malformed output — that is the engine's own retry", async () => {
    const sleep = vi.fn(async () => {});
    const malformed: EngineResult = {
      success: false,
      failureReason: "malformed_output",
      details: "confidence: expected number",
      meta: META,
    };
    const run = vi.fn<() => Promise<EngineResult>>().mockResolvedValue(malformed);

    await withRateLimitPacing(run, { sleep });

    expect(run).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("caps an absurd hint at maxWaitMs", async () => {
    const sleep = vi.fn(async () => {});
    const run = vi
      .fn<() => Promise<EngineResult>>()
      .mockResolvedValueOnce({
        ...rateLimited,
        details: "429 rate limit. Please try again in 600s",
      })
      .mockResolvedValueOnce(ok);

    await withRateLimitPacing(run, { sleep, maxWaitMs: 30_000 });

    expect(sleep).toHaveBeenCalledWith(30_000);
  });
});
