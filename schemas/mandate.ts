import { z } from "zod";
import { Currency, Id, MinorUnits, Timestamp } from "./primitives";

/**
 * A mandate is the signed spending authorization a principal issues to an
 * agent. It is the authoritative statement of what the agent may buy.
 *
 * NOTE: `signature` is carried but NOT verified in this prompt. Signature
 * verification is the Mandate Verifier, reserved for Prompt 2.
 */
export const Mandate = z.object({
  id: Id,
  principalId: Id,
  agentId: Id,
  /** Category paths the agent is authorized to purchase within. */
  categoryScope: z.array(z.string().min(1)).min(1),
  /** Spend ceiling for this mandate, in paise. */
  spendCapMinor: MinorUnits,
  currency: Currency,
  expiresAt: Timestamp,
  /** Replay protection. Uniqueness is enforced at the database level. */
  nonce: z.string().min(1),
  signature: z.string().min(1),
  createdAt: Timestamp,
});

export type Mandate = z.infer<typeof Mandate>;
