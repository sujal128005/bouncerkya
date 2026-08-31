/**
 * Policy Engine — Prompt 4.
 *
 * Turns an AuthorizationDiff into ALLOW / STEP_UP / DECLINE under deterministic
 * rules. The composition of verifier -> engine -> policy lives in lib/pipeline;
 * this module is only the rule.
 */
export * from "./thresholds";
