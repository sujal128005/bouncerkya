import { describe, expect, it } from "vitest";

import {
  MIN_HIDDEN,
  REVEALABLE_FIELDS,
  isRevealableField,
  redactMiddle,
} from "./redact";

/**
 * The invariant these tests exist for: `redactMiddle` must never return its
 * input. A redaction helper that silently declines to redact is worse than no
 * helper at all, because the call site reads as safe and the value ships in
 * full. That is not hypothetical here; it happened to a 12-character merchant
 * account id and was caught by diffing the served HTML against the database.
 */

const SAMPLES = [
  "acc_QK19xTdP",
  "nnc_a1f4c9d2e7b30465",
  "kms://stealth/agent-keys/vega-01",
  "ed25519:15d9k/gZIzECPZVm4XkehyPj4n1ISjjf+Xv5M9qQdO/C87IjocHwj7bvYsHpkzu4SiyWR0TfVCX8HMbnHUuBw==",
];

describe("redactMiddle", () => {
  it.each(SAMPLES)("hides part of %s", (value) => {
    const out = redactMiddle(value, { keepStart: 10, keepEnd: 4 });
    expect(out).not.toBe(value);
    expect(out).toContain("…");
  });

  it.each(SAMPLES)("never contains the whole of %s", (value) => {
    expect(redactMiddle(value, { keepStart: 10, keepEnd: 4 })).not.toContain(value);
  });

  it("hides at least the minimum even when the keeps ask for too much", () => {
    // The exact shape of the bug: keeps that would leave almost nothing hidden.
    const value = "acc_QK19xTdP"; // 12 characters
    const out = redactMiddle(value, { keepStart: 6, keepEnd: 3 });
    expect(out).not.toBe(value);
    const shown = out.replace(/…\d+…/, "");
    expect(value.length - shown.length).toBeGreaterThanOrEqual(MIN_HIDDEN);
  });

  it("keeps the prefix in preference to the suffix when it must choose", () => {
    // A prefix like "acc_" or "ed25519:" is what makes a value recognisable.
    expect(redactMiddle("acc_QK19xTdP", { keepStart: 4, keepEnd: 0 })).toMatch(
      /^acc_…8…$/,
    );
  });

  it("reports how many characters were hidden, not a fixed ellipsis", () => {
    // So a reader can tell two redacted values of different lengths apart.
    const short = redactMiddle("nnc_a1f4c9d2e7b30465", { keepStart: 8, keepEnd: 4 });
    const long = redactMiddle(SAMPLES[3], { keepStart: 8, keepEnd: 4 });
    expect(short).not.toBe(long);
    expect(short).toMatch(/…\d+…/);
    expect(long).toMatch(/…\d+…/);
  });

  it("leaves a value too short to be worth redacting alone", () => {
    expect(redactMiddle("abc")).toBe("abc");
    expect(redactMiddle("1234567")).toBe("1234567");
  });

  it("never returns something longer than it hides", () => {
    for (const value of SAMPLES) {
      const out = redactMiddle(value);
      expect(out.length).toBeLessThan(value.length + 8);
    }
  });
});

describe("the reveal allow-list", () => {
  it("accepts exactly the four named fields", () => {
    expect([...REVEALABLE_FIELDS].sort()).toEqual([
      "keyRef",
      "merchantId",
      "nonce",
      "signature",
    ]);
  });

  it.each(["displayName", "signature ", "", "__proto__", "id"])(
    "rejects %p",
    (candidate) => {
      expect(isRevealableField(candidate)).toBe(false);
    },
  );

  it("rejects non-strings", () => {
    for (const candidate of [null, undefined, 1, {}, ["signature"]]) {
      expect(isRevealableField(candidate)).toBe(false);
    }
  });
});
