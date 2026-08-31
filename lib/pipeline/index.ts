/**
 * Pipeline — Prompt 4.
 *
 * Composes Mandate Verifier -> Extraction -> Intent-Cart Engine -> threshold
 * policy into one evaluation, and records the result.
 *
 * It lives here rather than in lib/policy because the threshold policy is a
 * pure rule over a diff, while this is the orchestration and the persistence
 * around it. Keeping them apart means the rule can be exhaustively tested
 * without a database or a model, and the orchestration can be tested without
 * either as well.
 */
export * from "./evaluate";
export * from "./persist";
