/**
 * Redaction for credential material shown in the console.
 *
 * WHY SERVER-SIDE
 *
 * The obvious way to hide a value on screen is a CSS blur or a masked span.
 * Both are theatre. The full value is still in the HTML, still in the React
 * payload, still in view-source, still in the devtools DOM inspector, and
 * still in anything that scrapes the page. Masking it in the browser hides it
 * from the one person who was already allowed to look at it, and from nobody
 * else.
 *
 * So redaction happens where the string is built. The server sends the
 * truncated form; the full value is not in the document at all. What a reader
 * sees in devtools is exactly what they see on screen, which is the property
 * that was actually wanted.
 *
 * WHAT IS REDACTED, AND WHY NOT MORE
 *
 * Signatures, nonces, key references and the merchant account id. These are
 * credential and account material: long, opaque, and of no use to a human
 * reading a decision, so truncating them costs the reader nothing.
 *
 * Amounts, categories, outcomes, timestamps and the diff are NOT redacted.
 * This is an audit console. A reviewer who cannot see what was bought and why
 * it was blocked has been handed a product that does not work, and hiding the
 * evidence would be privacy theatre in the opposite direction.
 */

/**
 * Keeps a head and a tail so a human can still match a value against a log
 * line or a dashboard, and drops the middle.
 *
 * The character count of the removed section is shown rather than a fixed
 * number of dots: a reader comparing two redacted signatures should be able to
 * tell that they are different lengths, and a fixed ellipsis hides that.
 */
export const MIN_HIDDEN = 4;
const MIN_REDACTABLE_LENGTH = 8;

export function redactMiddle(
  value: string,
  { keepStart = 10, keepEnd = 4 }: { keepStart?: number; keepEnd?: number } = {},
): string {
  // Below this there is nothing worth hiding, and the redacted form would be
  // longer than the value it replaced.
  if (value.length < MIN_REDACTABLE_LENGTH) return value;

  /*
   * The keeps are a REQUEST, not a promise, and they are clamped so that at
   * least MIN_HIDDEN characters are always hidden.
   *
   * This clamp is here because of a real bug: a 12-character merchant account
   * id was passed keepStart 6 and keepEnd 3, which left 3 characters to hide,
   * and an earlier version treated "too little to hide" as "return the value
   * unchanged". The result was a field that looked redacted in the code and
   * was published in full in the page source. Silently doing nothing is the
   * worst possible behaviour for a redaction helper, so the short case now
   * hides more rather than less.
   */
  let start = Math.max(0, keepStart);
  let end = Math.max(0, keepEnd);
  const budget = value.length - MIN_HIDDEN;
  if (start + end > budget) {
    // Give up the tail first: a prefix like "ed25519:" or "acc_" is what makes
    // a value recognisable to a human, and the tail rarely is.
    end = Math.max(0, Math.min(end, budget - Math.min(start, budget)));
    start = Math.min(start, budget - end);
  }

  const hidden = value.length - start - end;
  return `${value.slice(0, start)}…${hidden}…${end > 0 ? value.slice(-end) : ""}`;
}

/**
 * The fields the console will reveal on request, and the only ones.
 *
 * An open-ended "give me field X of row Y" endpoint is a database read
 * primitive wearing a costume. This list is the allow-list, checked
 * server-side, so a crafted request cannot walk out of it.
 */
export const REVEALABLE_FIELDS = [
  "signature",
  "nonce",
  "keyRef",
  "merchantId",
] as const;

export type RevealableField = (typeof REVEALABLE_FIELDS)[number];

export function isRevealableField(value: unknown): value is RevealableField {
  return (
    typeof value === "string" &&
    (REVEALABLE_FIELDS as readonly string[]).includes(value)
  );
}
