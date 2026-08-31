/**
 * The model boundary.
 *
 * THE PROBLEM THIS EXISTS FOR
 *
 * Bouncer judges a cart with a large language model, and that model runs at a
 * third party: Groq, Google, Anthropic, OpenRouter. Every byte of the prompt
 * leaves this machine, crosses the public internet, and lands in somebody
 * else's logs, retention window and jurisdiction.
 *
 * That is the single largest privacy exposure in the entire product, and it is
 * the one that agentic-commerce demos almost universally ignore. They hand the
 * model the whole request object because it is easier, and the shopper's name,
 * account id and payment identifiers go with it.
 *
 * WHAT IS ACTUALLY SENT
 *
 * The prompt carries what the judgement needs and nothing else: authorized
 * categories, the spend cap and currency, the cart's line names, categories,
 * quantities and prices, the listing ids, and the untrusted listing text.
 *
 * The cart contents ARE sent. Judging the cart is the task, so this is not a
 * system that hides the purchase from the model. What it withholds is
 * IDENTITY: who is buying, under which mandate, against which merchant
 * account, with which credential. The model is given a shopping basket and no
 * way to know whose it is.
 *
 * WHY A RUNTIME GUARD AND NOT JUST CARE
 *
 * The property currently holds because `buildUserMessage` reads a narrow set
 * of fields. That is a fact about today's code, not a guarantee, and it is one
 * refactor away from being false: adding `${evidence.purchaseRequestId}` to
 * the prompt "for traceability" is an entirely reasonable-looking change that
 * would silently start shipping a correlatable identifier to a third party on
 * every checkout.
 *
 * So the boundary is enforced at runtime, on the exact string that leaves.
 * If an identity value is ever found in an outbound prompt, this throws and
 * the engine call never happens. Because an engine that cannot answer produces
 * STEP_UP and never ALLOW, a privacy regression degrades into a human
 * approval. It cannot degrade into a leak, and it cannot degrade into a
 * purchase.
 *
 * WHAT IT DOES NOT DO
 *
 * It cannot protect a value it was not told about, it does not encrypt
 * anything in transit beyond the TLS the provider offers, and it says nothing
 * about what the provider does with the cart contents that are legitimately
 * sent. Those limits are stated on /privacy rather than left for a reader to
 * discover.
 */

/** One value that must never appear in an outbound payload. */
export type IdentityValue = {
  /** What this is, for the error message. NEVER the value itself. */
  field: string;
  value: string;
};

/**
 * Thrown instead of making the request. The message names the field and never
 * the value: an exception that prints the secret it caught has simply moved
 * the leak from the network into the log file.
 */
export class EgressViolation extends Error {
  readonly field: string;

  constructor(field: string) {
    super(
      `Refusing to send: the outbound model prompt contains the value of "${field}", ` +
        "which is identity data and must never leave this process. " +
        "The engine call was not made.",
    );
    this.name = "EgressViolation";
    this.field = field;
  }
}

/**
 * Values shorter than this are not checked. A two-character id would match by
 * coincidence inside an ordinary product name and turn the guard into a source
 * of false refusals, which is how safety controls get switched off.
 */
const MIN_CHECKED_LENGTH = 8;

/** Throws if any deny-listed value appears anywhere in the payload. */
export function assertNoEgress(
  payload: string,
  denyList: readonly IdentityValue[],
): void {
  for (const entry of denyList) {
    if (entry.value.length < MIN_CHECKED_LENGTH) continue;
    if (payload.includes(entry.value)) {
      throw new EgressViolation(entry.field);
    }
  }
}

/**
 * The identity values carried by one checkout, as they would appear verbatim.
 *
 * Everything here is an identifier or a credential. Nothing here is needed to
 * decide whether a cart matches a mandate, which is why withholding all of it
 * costs the judgement nothing.
 */
export function identityValues(input: {
  purchaseRequestId?: string;
  mandateId?: string;
  principalId?: string;
  principalDisplayName?: string;
  agentId?: string;
  nonce?: string;
  signature?: string;
  /** Merchant account id and anything else from the structured session block. */
  sessionStructuredFields?: Record<string, unknown>;
}): IdentityValue[] {
  const out: IdentityValue[] = [];
  const push = (field: string, value: string | undefined) => {
    if (typeof value === "string" && value.length > 0) out.push({ field, value });
  };

  push("purchaseRequestId", input.purchaseRequestId);
  push("mandateId", input.mandateId);
  push("principalId", input.principalId);
  push("principal.displayName", input.principalDisplayName);
  push("agentId", input.agentId);
  push("mandate.nonce", input.nonce);
  push("mandate.signature", input.signature);

  // The structured block is merchant-supplied and holds the merchant account
  // id. Its shape is not fixed, so every string value in it is denied rather
  // than a hand-listed subset that a new key could slip past.
  for (const [key, value] of Object.entries(input.sessionStructuredFields ?? {})) {
    if (typeof value === "string") push(`sessionContext.${key}`, value);
  }

  return out;
}
