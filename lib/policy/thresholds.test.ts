import { describe, expect, it } from "vitest";

import type { AuthorizationDiff, DiffClause, DiffClauseSeverity } from "@/schemas";

import {
  ALLOW_MIN_CONFIDENCE,
  applyThresholdPolicy,
} from "./thresholds";

function clause(severity: DiffClauseSeverity, type: DiffClause["type"] = "category_drift"): DiffClause {
  return {
    type,
    severity,
    mandateValue: "m",
    attemptedValue: "a",
    explanation: "why",
  };
}

function diff(
  overrides: Partial<AuthorizationDiff> = {},
): AuthorizationDiff {
  return {
    overallVerdictRecommendation: "consistent",
    confidence: 0.97,
    summary: "s",
    clauses: [],
    ...overrides,
  };
}

describe("threshold policy — rule 1, ALLOW", () => {
  it("allows a consistent, confident diff with no clauses", () => {
    const result = applyThresholdPolicy(diff());
    expect(result.outcome).toBe("ALLOW");
    expect(result.rule).toBe("consistent_and_confident");
  });

  it("allows a consistent diff whose only clauses are low severity", () => {
    expect(
      applyThresholdPolicy(diff({ clauses: [clause("low"), clause("low")] }))
        .outcome,
    ).toBe("ALLOW");
  });

  it("allows at exactly the confidence floor — the boundary is inclusive", () => {
    expect(
      applyThresholdPolicy(diff({ confidence: ALLOW_MIN_CONFIDENCE })).outcome,
    ).toBe("ALLOW");
  });

  it("does not allow one increment below the floor", () => {
    expect(
      applyThresholdPolicy(diff({ confidence: ALLOW_MIN_CONFIDENCE - 0.01 }))
        .outcome,
    ).toBe("STEP_UP");
  });

  it("does not allow a consistent diff carrying a single medium clause", () => {
    const result = applyThresholdPolicy(diff({ clauses: [clause("medium")] }));
    expect(result.outcome).toBe("STEP_UP");
    expect(result.rule).toBe("residual_uncertainty");
  });

  it("never allows a drift_detected diff, however confident", () => {
    expect(
      applyThresholdPolicy(
        diff({ overallVerdictRecommendation: "drift_detected", confidence: 1 }),
      ).outcome,
    ).toBe("STEP_UP");
  });
});

describe("threshold policy — rule 2, DECLINE", () => {
  it("declines on a single high-severity clause", () => {
    const result = applyThresholdPolicy(
      diff({
        overallVerdictRecommendation: "drift_detected",
        confidence: 0.9,
        clauses: [clause("high")],
      }),
    );
    expect(result.outcome).toBe("DECLINE");
    expect(result.rule).toBe("high_severity_clause");
    expect(result.reason).toContain("category_drift");
  });

  it("declines on a high clause even when the verdict says consistent", () => {
    // Rule 1 rejects it for the forbidden severity, then rule 2 catches it.
    expect(
      applyThresholdPolicy(diff({ confidence: 0.99, clauses: [clause("high")] }))
        .outcome,
    ).toBe("DECLINE");
  });

  it("declines on a high clause even at very low confidence", () => {
    expect(
      applyThresholdPolicy(
        diff({
          overallVerdictRecommendation: "drift_detected",
          confidence: 0.1,
          clauses: [clause("high")],
        }),
      ).outcome,
    ).toBe("DECLINE");
  });

  it("counts every high clause in the reason", () => {
    const result = applyThresholdPolicy(
      diff({
        overallVerdictRecommendation: "drift_detected",
        clauses: [clause("high"), clause("high", "budget_overrun"), clause("low")],
      }),
    );
    expect(result.reason).toContain("2 high-severity clauses");
  });
});

describe("threshold policy — rule 3, STEP_UP", () => {
  it("escalates drift with only medium severity", () => {
    const result = applyThresholdPolicy(
      diff({
        overallVerdictRecommendation: "drift_detected",
        confidence: 0.73,
        clauses: [clause("medium")],
      }),
    );
    expect(result.outcome).toBe("STEP_UP");
    expect(result.rule).toBe("residual_uncertainty");
  });

  it("escalates drift with only low severity", () => {
    expect(
      applyThresholdPolicy(
        diff({
          overallVerdictRecommendation: "drift_detected",
          confidence: 0.95,
          clauses: [clause("low")],
        }),
      ).outcome,
    ).toBe("STEP_UP");
  });

  it("escalates a low-confidence consistent diff", () => {
    const result = applyThresholdPolicy(diff({ confidence: 0.4 }));
    expect(result.outcome).toBe("STEP_UP");
    expect(result.reason).toContain("below the 0.85 floor");
  });

  it("is total: every diff shape lands on exactly one outcome", () => {
    const verdicts = ["consistent", "drift_detected"] as const;
    const confidences = [0, 0.5, 0.84, 0.85, 0.86, 1];
    const clauseSets: DiffClause[][] = [
      [],
      [clause("low")],
      [clause("medium")],
      [clause("high")],
      [clause("low"), clause("medium"), clause("high")],
    ];

    for (const overallVerdictRecommendation of verdicts) {
      for (const confidence of confidences) {
        for (const clauses of clauseSets) {
          const result = applyThresholdPolicy(
            diff({ overallVerdictRecommendation, confidence, clauses }),
          );
          expect(["ALLOW", "STEP_UP", "DECLINE"]).toContain(result.outcome);

          // The safety property: nothing with a high clause is ever allowed.
          if (clauses.some((c) => c.severity === "high")) {
            expect(result.outcome).not.toBe("ALLOW");
          }
        }
      }
    }
  });
});
