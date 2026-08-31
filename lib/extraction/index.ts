/**
 * Extraction layer — Prompt 3.
 *
 * Deterministic pre-processing that runs before the Intent-Cart Engine: a
 * closed category taxonomy, a pattern-based injection-marker scan, and the
 * ExtractedEvidence object the engine reasons over. No model, no network.
 */
export * from "./taxonomy";
export * from "./injection";
export * from "./evidence";
