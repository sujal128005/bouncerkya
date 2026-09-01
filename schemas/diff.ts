import { z } from "zod";
import { Confidence } from "./primitives";

/** The kinds of mismatch STEALTH can report between mandate and cart. */
export const DiffClauseType = z.enum([
  "category_drift",
  "budget_overrun",
  "quantity_anomaly",
  "injected_instruction",
  "expiry",
  "other",
]);

export const DiffClauseSeverity = z.enum(["low", "medium", "high"]);

/**
 * One clause of the Authorization Diff: a single, quotable statement of
 * "the mandate said X, the agent attempted Y, and here is why that matters".
 * Values are rendered as strings so a clause is always human-readable in the
 * console and in the audit record.
 */
export const DiffClause = z.object({
  type: DiffClauseType,
  severity: DiffClauseSeverity,
  /*
   * These two are rendered one directly above the other, on a single axis, in
   * the same face and size — the console's whole comparison rests on them
   * being diffable at a glance. So they must describe the SAME dimension and
   * stay short. Left unconstrained, a live model writes a sentence about the
   * whole mandate on one line and a sentence about the whole cart on the
   * other: both accurate, neither comparable. The descriptions below reach the
   * model through `z.toJSONSchema` in the tool contract, so every backend gets
   * them without a second copy to keep in sync.
   */
  mandateValue: z
    .string()
    .describe(
      "The authorized value for THIS clause's dimension only, as a short phrase — e.g. 'footwear/running-shoes' or 'cap INR 5,000.00'. Not a summary of the whole mandate. Must be directly comparable to attemptedValue. Under 60 characters.",
    ),
  attemptedValue: z
    .string()
    .describe(
      "The attempted value for THE SAME dimension, in the same shape and units — e.g. 'gift-cards/prepaid' or 'INR 20,000.00 (10 x 2,000.00)'. Not a summary of the whole cart. Under 60 characters. Reasoning belongs in explanation, not here.",
    ),
  explanation: z.string().min(1),
});

export const OverallVerdictRecommendation = z.enum([
  "consistent",
  "drift_detected",
]);

/**
 * The Authorization Diff is a RECOMMENDATION, not a decision. The Policy
 * Engine (Prompt 4) decides; this object only describes the mismatch.
 */
export const AuthorizationDiff = z.object({
  overallVerdictRecommendation: OverallVerdictRecommendation,
  confidence: Confidence,
  clauses: z.array(DiffClause),
  summary: z.string().min(1),
});

export type DiffClauseType = z.infer<typeof DiffClauseType>;
export type DiffClauseSeverity = z.infer<typeof DiffClauseSeverity>;
export type DiffClause = z.infer<typeof DiffClause>;
export type OverallVerdictRecommendation = z.infer<
  typeof OverallVerdictRecommendation
>;
export type AuthorizationDiff = z.infer<typeof AuthorizationDiff>;
