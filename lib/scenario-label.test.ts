import { describe, expect, it } from "vitest";

import { describeScenario, type LabelInput } from "./scenario-label";

/**
 * These labels are the first thing a reader sees, and a wrong one is worse
 * than a hex id: an id that means nothing cannot mislead, and a confident
 * sentence can. So the ordering is pinned — credential before cart, always —
 * and every failure reason is asserted to produce its own wording.
 */

const clean: LabelInput = {
  mandateVerification: { valid: true },
  diff: { clauses: [], overallVerdictRecommendation: "consistent" },
  engineFailure: null,
  leadItemName: "Strider Flow 3 Running Shoes",
  capUse: 0.9,
};

describe("describeScenario", () => {
  it("names a clean match and mentions the item", () => {
    const label = describeScenario(clean);
    expect(label.title).toBe("Matches the mandate");
    expect(label.subtitle).toContain("Strider Flow 3 Running Shoes");
    expect(label.stoppedAt).toBe("threshold policy");
  });

  it.each([
    ["malformed", "Malformed mandate"],
    ["invalid_signature", "Forged signature"],
    ["expired", "Expired mandate"],
    ["replayed_nonce", "Reused mandate"],
  ] as const)("names the %s credential failure", (reason, title) => {
    const label = describeScenario({
      ...clean,
      mandateVerification: { valid: false, failureReason: reason },
    });
    expect(label.title).toBe(title);
    expect(label.stoppedAt).toBe("mandate verifier");
  });

  it("reports the credential failure even when a diff also exists", () => {
    // Ordering matters: a request whose signature does not verify never
    // reached the engine, so a stale diff must not rename it.
    const label = describeScenario({
      ...clean,
      mandateVerification: { valid: false, failureReason: "expired" },
      diff: {
        clauses: [
          {
            type: "budget_overrun",
            severity: "high",
            mandateValue: "cap INR 5,000.00",
            attemptedValue: "INR 20,000.00",
            explanation: "four times the cap",
          },
        ],
        overallVerdictRecommendation: "drift_detected",
      },
    });
    expect(label.title).toBe("Expired mandate");
  });

  it("falls back to a neutral title for an unrecognised failure reason", () => {
    const label = describeScenario({
      ...clean,
      mandateVerification: { valid: false },
    });
    expect(label.title).toBe("Rejected credential");
    expect(label.stoppedAt).toBe("mandate verifier");
  });

  it("names an engine failure as a fail-safe, never as an allow", () => {
    const label = describeScenario({
      ...clean,
      diff: null,
      engineFailure: { reason: "engine_unavailable" },
    });
    expect(label.title).toBe("Engine could not judge");
    expect(label.stoppedAt).toBe("fail-safe");
    // The locked invariant, restated in the copy: an absent judgement
    // escalates. The label must not describe it as anything permissive.
    expect(label.subtitle).toContain("escalates");
    expect(label.subtitle).not.toMatch(/allow/i);
  });

  it("treats a missing diff as a fail-safe even with no recorded failure", () => {
    const label = describeScenario({ ...clean, diff: null });
    expect(label.stoppedAt).toBe("fail-safe");
  });

  it("distinguishes two fail-safe rows by their carts", () => {
    // Both carry the same title and the same reason. If the subtitle were also
    // identical the list would show two rows a reader cannot tell apart.
    const first = describeScenario({
      ...clean,
      diff: null,
      leadItemName: "Aurient Studio Wireless Earbuds",
      capUse: 0.96,
    });
    const second = describeScenario({
      ...clean,
      diff: null,
      leadItemName: "Aurient Studio Wireless Earbuds",
      capUse: 2,
    });
    expect(first.title).toBe(second.title);
    expect(first.subtitle).not.toBe(second.subtitle);
    expect(first.subtitle).toContain("96%");
    expect(second.subtitle).toContain("200%");
  });

  it("leads with the highest-severity clause, not the first", () => {
    const label = describeScenario({
      ...clean,
      diff: {
        overallVerdictRecommendation: "drift_detected",
        clauses: [
          {
            type: "quantity_anomaly",
            severity: "medium",
            mandateValue: "1",
            attemptedValue: "3",
            explanation: "three units",
          },
          {
            type: "category_drift",
            severity: "high",
            mandateValue: "footwear/running-shoes",
            attemptedValue: "gift-cards/prepaid",
            explanation: "outside scope",
          },
        ],
      },
      leadItemName: "Universal Prepaid Gift Card",
    });
    expect(label.title).toBe("Wrong category");
    expect(label.subtitle).toContain("Universal Prepaid Gift Card");
  });

  it("renders the cap share as a percentage a human reads", () => {
    const label = describeScenario({
      ...clean,
      capUse: 4,
      diff: {
        overallVerdictRecommendation: "drift_detected",
        clauses: [
          {
            type: "budget_overrun",
            severity: "high",
            mandateValue: "cap INR 5,000.00",
            attemptedValue: "INR 20,000.00",
            explanation: "four times the cap",
          },
        ],
      },
    });
    expect(label.title).toBe("Over the spend cap");
    expect(label.subtitle).toContain("400%");
  });

  it("ignores a low-severity clause rather than crying drift", () => {
    // The seeded ALLOW carries one low clause. Naming it "Wrong category"
    // would contradict the ALLOW badge sitting next to it.
    const label = describeScenario({
      ...clean,
      diff: {
        overallVerdictRecommendation: "consistent",
        clauses: [
          {
            type: "other",
            severity: "low",
            mandateValue: "footwear/running-shoes",
            attemptedValue: "footwear/running-shoes",
            explanation: "consistent",
          },
        ],
      },
    });
    expect(label.title).toBe("Matches the mandate");
  });

  it("does not claim a clean match when the engine reported drift it could not place", () => {
    const label = describeScenario({
      ...clean,
      diff: {
        overallVerdictRecommendation: "drift_detected",
        clauses: [
          {
            type: "other",
            severity: "high",
            mandateValue: "footwear/running-shoes",
            attemptedValue: "something odd",
            explanation: "unplaced",
          },
        ],
      },
    });
    expect(label.title).toBe("Drift, not clearly placed");
  });

  it("never renders an empty title or subtitle", () => {
    const inputs: LabelInput[] = [
      clean,
      { ...clean, leadItemName: null, capUse: null },
      { ...clean, diff: null },
      { ...clean, mandateVerification: { valid: false, failureReason: "expired" } },
    ];
    for (const input of inputs) {
      const label = describeScenario(input);
      expect(label.title.length).toBeGreaterThan(0);
      expect(label.subtitle.length).toBeGreaterThan(0);
    }
  });
});
