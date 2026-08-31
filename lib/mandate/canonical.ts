import type { Mandate } from "@/schemas";

/** Everything a mandate commits to, except the signature over it. */
export type SignableMandate = Omit<Mandate, "signature">;

/** Version tag — a future field change gets a new tag, not a silent break. */
export const MANDATE_PAYLOAD_VERSION = "bouncer.mandate.v1";

/**
 * The exact bytes that get signed and verified.
 *
 * A JSON array rather than an object: array order is fixed by this function,
 * so there is no dependence on object key ordering, and JSON escaping means a
 * field containing a separator character cannot be used to shift the meaning
 * of another field. `signature` is excluded — it signs this, it cannot sign
 * itself.
 *
 * Signing and verification both go through here, so the two can never drift.
 */
export function canonicalMandatePayload(mandate: SignableMandate): Buffer {
  const canonical = JSON.stringify([
    MANDATE_PAYLOAD_VERSION,
    mandate.id,
    mandate.principalId,
    mandate.agentId,
    mandate.categoryScope,
    mandate.spendCapMinor,
    mandate.currency,
    mandate.expiresAt.toISOString(),
    mandate.nonce,
    mandate.createdAt.toISOString(),
  ]);

  return Buffer.from(canonical, "utf8");
}
