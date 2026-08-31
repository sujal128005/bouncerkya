import {
  decryptField,
  encryptField,
  fieldAad,
  isEncrypted,
  readEncryptionKey,
} from "./crypto";

/**
 * Which columns are encrypted, and the only place that list lives.
 *
 * WHY THESE FOUR
 *
 * Not everything, and the choice is not arbitrary. Encrypting a column costs
 * the ability to query it, so each one has to earn it by being something an
 * attacker with the database file would actually want:
 *
 *   Principal.displayName                 who the shopper is
 *   CartItem.name                         what they bought, line by line
 *   PurchaseRequest.sessionFreeText       the session's merchant copy
 *   PurchaseRequest.sessionStructuredFields   the merchant account id
 *
 * Deliberately NOT encrypted, and visible to anyone with the file: amounts,
 * categories, timestamps, outcomes, ids, mandate signatures and the audit
 * chain. Every one of those is either needed for a query, needed for
 * verification, or not sensitive on its own. Encrypting the audit chain in
 * particular would be actively wrong: a tamper-evidence log that cannot be
 * checked without a secret is not much of a tamper-evidence log.
 *
 * The honest summary, and the one on /privacy: someone who steals this file
 * learns that a purchase happened, for how much, in what category, and what
 * Bouncer decided. They do not learn whose it was or what was in the basket.
 *
 * HOW IT IS KEPT HONEST
 *
 * These helpers are explicit rather than hidden inside a Prisma extension,
 * because a control an auditor can grep for is worth more than a clever one
 * they have to trust. The risk of an explicit codec is that a future write
 * path forgets to call it, so that is covered by an integration test which
 * opens the SQLite file directly and asserts no plaintext is present. The
 * test checks the outcome, not the mechanism, so it catches a forgotten call
 * site that no amount of reading the code would.
 */

export const ENCRYPTED_FIELDS = [
  { model: "Principal", field: "displayName" },
  { model: "CartItem", field: "name" },
  { model: "PurchaseRequest", field: "sessionFreeText" },
  { model: "PurchaseRequest", field: "sessionStructuredFields" },
] as const;

export type EncryptedField = (typeof ENCRYPTED_FIELDS)[number];

/** Plaintext going in. Null passes through: an absent value has nothing to hide. */
export function seal(
  model: string,
  field: string,
  id: string,
  plaintext: string | null,
): string | null {
  if (plaintext === null) return null;
  // Idempotent, so a reseed over an already-encrypted row cannot double-wrap.
  if (isEncrypted(plaintext)) return plaintext;
  return encryptField(plaintext, fieldAad(model, field, id), readEncryptionKey());
}

/** Stored value coming out. */
export function open(
  model: string,
  field: string,
  id: string,
  stored: string | null,
): string | null {
  if (stored === null) return null;
  if (!isEncrypted(stored)) {
    // Almost always a database written before this column was encrypted.
    // Failing loudly beats silently rendering plaintext and reporting the
    // deployment as encrypted.
    throw new Error(
      `${model}.${field} is stored as plaintext, not ciphertext. ` +
        "This database predates field encryption. Stop the dev server and run " +
        "`npm run db:reset` to rewrite it.",
    );
  }
  return decryptField(stored, fieldAad(model, field, id), readEncryptionKey());
}
