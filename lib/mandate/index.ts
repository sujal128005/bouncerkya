/**
 * Mandate Verifier — Prompt 2.
 *
 * Answers one question about a checkout attempt: is the mandate a legitimate,
 * still-valid, not-already-used credential? Cart contents, categories and
 * budget are deliberately out of scope here (Prompt 3).
 */
export * from "./canonical";
export * from "./keys";
export * from "./verify";
