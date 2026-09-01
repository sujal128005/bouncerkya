/**
 * Server start-up checks.
 *
 * `register()` is called once when a Next server instance is created, and must
 * finish before the first request is handled. That is the only place in the
 * app where a configuration check can run exactly once, ahead of traffic.
 *
 * WHY THIS FILE EXISTS
 *
 * lib/config-check.ts was written to catch a variable that is present but
 * wrong: a live Razorpay key, an encryption key of the wrong length, a model
 * preset that does not exist, two variables sharing one line of .env. Its own
 * docstring said "called once at server start". It was never called anywhere.
 * The checker was complete, tested, and dead, so every one of those mistakes
 * surfaced later as a symptom somewhere else: an unknown preset aborted
 * `db:seed` halfway and the console reported an empty database.
 *
 * WHY BUILD ONLY WARNS
 *
 * A running server that is misconfigured will mislead someone, so it refuses
 * to start. A build has no users to mislead, and `next build` runs in
 * environments that legitimately have no runtime secrets. Failing the build
 * there would block a deploy over a variable that is supplied later.
 */

import { assertConfiguration, checkConfiguration, formatConfigProblems } from "./lib/config-check";

export function register(): void {
  // Also runs for the edge runtime, which has none of this configuration and
  // is not where any of it is used.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  if (process.env.NEXT_PHASE === "phase-production-build") {
    const fatal = checkConfiguration(process.env).filter(
      (problem) => problem.severity === "fatal",
    );
    if (fatal.length > 0) {
      console.warn(
        `[stealth] configuration is invalid, and this build is continuing anyway.\n` +
          `These must be fixed before the server will start:\n${formatConfigProblems(fatal)}`,
      );
    }
    return;
  }

  assertConfiguration();
}
