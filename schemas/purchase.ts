import { z } from "zod";
import { Id, MinorUnits, Timestamp } from "./primitives";

/** One line in the cart the agent is actually trying to buy. */
export const CartItem = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPriceMinor: MinorUnits,
  /** The listing this line came from. Provenance for injection analysis. */
  sourceListingId: z.string().min(1),
});

/**
 * Everything the agent saw around the cart. `freeText` is untrusted:
 * it is merchant/listing copy and is the usual carrier of prompt injection.
 */
export const SessionContext = z.object({
  structuredFields: z.record(z.string(), z.unknown()),
  freeText: z.string().nullable(),
  injectionMarkerDetected: z.boolean(),
});

/** The checkout attempt presented to STEALTH. */
export const PurchaseRequest = z.object({
  id: Id,
  mandateId: Id,
  agentId: Id,
  items: z.array(CartItem).min(1),
  /** Cart total in paise. Must equal the sum of the lines. */
  totalMinor: MinorUnits,
  sessionContext: SessionContext,
  requestedAt: Timestamp,
});

export type CartItem = z.infer<typeof CartItem>;
export type SessionContext = z.infer<typeof SessionContext>;
export type PurchaseRequest = z.infer<typeof PurchaseRequest>;
