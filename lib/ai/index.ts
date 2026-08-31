/**
 * Intent-Cart Consistency Engine — Prompt 3.
 *
 * Produces an Authorization Diff from extracted evidence. Evidence only: this
 * layer never decides ALLOW / STEP_UP / DECLINE.
 */
export * from "./contract";
export * from "./prompt";
export * from "./engine";
export * from "./anthropic";
export * from "./openai-compatible";
export * from "./provider";
export * from "./pacing";
