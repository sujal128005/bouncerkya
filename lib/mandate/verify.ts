import crypto, { type KeyObject } from "node:crypto";

import { Mandate } from "@/schemas";

import { canonicalMandatePayload } from "./canonical";
import { decodeSignature } from "./keys";

/**
 * The Mandate Verifier answers exactly one question: is this a legitimate,
 * still-valid, not-already-used mandate credential?
 *
 * It does NOT look at cart contents, categories or budget. Those are semantic
 * questions about whether a purchase matches an intent, and they belong to the
 * Intent-Cart Engine (Prompt 3) — which reasons about category drift and
 * budget overrun together, with a model. Everything decidable deterministically
 * about the credential itself is decided here, for free, before any model is
 * reached. That is the point of the layering: a bad credential never costs an
 * LLM call.
 */

export type MandateFailureReason =
  | "malformed"
  | "invalid_signature"
  | "expired"
  | "replayed_nonce";

export type MandateCheckName = "malformed" | "signature" | "expiry" | "replay";

export type MandateCheckStatus = "pass" | "fail" | "not_evaluated";

export type MandateCheckResult = {
  check: MandateCheckName;
  status: MandateCheckStatus;
  detail: string;
};

export type MandateVerification = {
  valid: boolean;
  failureReason?: MandateFailureReason;
  /** Human-readable detail for the failing check. */
  detail?: string;
  /**
   * Every check in evaluation order, including the ones skipped after a
   * failure. Fail-fast is a property worth being able to see in the console.
   */
  checks: MandateCheckResult[];
};

/**
 * Everything the verifier needs from the outside world, passed in rather than
 * fetched, so `verifyMandate` stays pure, synchronous and trivially testable.
 */
export type MandateVerificationContext = {
  /** Evaluation time. Injected so expiry is testable and deterministic. */
  now: Date;
  /**
   * The agent's public key, or null if the agent or its key reference is
   * unknown. Resolving by agentId is also what binds a mandate to its agent:
   * a mandate signed with some other agent's key will not verify.
   */
  resolvePublicKeyForAgent: (agentId: string) => KeyObject | null;
  /**
   * The id of the purchase request that already consumed this nonce, or null
   * if it is still unused. Single-use mandates: first request wins.
   */
  nonceConsumedBy: (nonce: string) => string | null;
  /**
   * The request presenting this mandate right now, so the request that
   * consumed the nonce does not read as a replay of itself.
   */
  presentedByPurchaseRequestId?: string;
};

const CHECK_ORDER: MandateCheckName[] = [
  "malformed",
  "signature",
  "expiry",
  "replay",
];

function buildChecks(
  passed: Partial<Record<MandateCheckName, string>>,
  failed?: { check: MandateCheckName; detail: string },
): MandateCheckResult[] {
  const results: MandateCheckResult[] = [];
  let reached = true;

  for (const check of CHECK_ORDER) {
    if (failed && check === failed.check) {
      results.push({ check, status: "fail", detail: failed.detail });
      reached = false;
      continue;
    }

    if (!reached) {
      results.push({
        check,
        status: "not_evaluated",
        detail: "not evaluated, an earlier check failed",
      });
      continue;
    }

    results.push({
      check,
      status: "pass",
      detail: passed[check] ?? "ok",
    });
  }

  return results;
}

function fail(
  failureReason: MandateFailureReason,
  check: MandateCheckName,
  detail: string,
  passed: Partial<Record<MandateCheckName, string>>,
): MandateVerification {
  return {
    valid: false,
    failureReason,
    detail,
    checks: buildChecks(passed, { check, detail }),
  };
}

/**
 * Pure, deterministic, no network, no model. Never throws: a malformed input
 * comes back as a typed failure.
 *
 * Checks run in order and the first failure wins:
 *   1. malformed          — does it parse as a Mandate at all
 *   2. invalid_signature  — is it signed by the agent it claims
 *   3. expired            — is it still within its validity window
 *   4. replayed_nonce     — has this single-use nonce already been spent
 */
export function verifyMandate(
  candidate: unknown,
  context: MandateVerificationContext,
): MandateVerification {
  const passed: Partial<Record<MandateCheckName, string>> = {};

  // 1. Malformed.
  const parsed = Mandate.safeParse(candidate);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.join(".") || "mandate";
    const why = first?.message ?? "does not match the mandate schema";
    return fail(
      "malformed",
      "malformed",
      `${where}: ${why}`,
      passed,
    );
  }
  const mandate = parsed.data;
  passed.malformed = "parses as a well-formed mandate";

  // 2. Signature. Anything unexpected here fails closed.
  const publicKey = context.resolvePublicKeyForAgent(mandate.agentId);
  if (!publicKey) {
    return fail(
      "invalid_signature",
      "signature",
      `no public key on file for agent ${mandate.agentId}`,
      passed,
    );
  }

  const signatureBytes = decodeSignature(mandate.signature);
  if (!signatureBytes) {
    return fail(
      "invalid_signature",
      "signature",
      "signature is not a well-formed ed25519 signature",
      passed,
    );
  }

  let signatureValid = false;
  try {
    signatureValid = crypto.verify(
      null,
      canonicalMandatePayload(mandate),
      publicKey,
      signatureBytes,
    );
  } catch {
    signatureValid = false;
  }

  if (!signatureValid) {
    return fail(
      "invalid_signature",
      "signature",
      "signature does not verify against the agent's public key",
      passed,
    );
  }
  passed.signature = "ed25519 signature verified against the agent's key";

  // 3. Expiry.
  if (mandate.expiresAt.getTime() <= context.now.getTime()) {
    return fail(
      "expired",
      "expiry",
      `mandate expired at ${mandate.expiresAt.toISOString()}`,
      passed,
    );
  }
  passed.expiry = `valid until ${mandate.expiresAt.toISOString()}`;

  // 4. Replay. Single-use: the first request to present this nonce spends it.
  const consumedBy = context.nonceConsumedBy(mandate.nonce);
  if (consumedBy && consumedBy !== context.presentedByPurchaseRequestId) {
    return fail(
      "replayed_nonce",
      "replay",
      `nonce already spent by purchase request ${consumedBy}`,
      passed,
    );
  }
  passed.replay = consumedBy
    ? "nonce spent by this request"
    : "nonce unused";

  return { valid: true, checks: buildChecks(passed) };
}
