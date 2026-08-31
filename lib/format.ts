/**
 * Display formatting. Money is stored as integer paise and only ever converted
 * to a decimal string at the edge, here.
 */

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 449900 -> "₹4,499.00" */
export function formatMinor(minor: number): string {
  return inr.format(minor / 100);
}

/** 449900 -> "449900" — used where the raw stored value matters. */
export function rawMinor(minor: number): string {
  return minor.toLocaleString("en-US").replace(/,/g, "");
}

const two = (n: number) => String(n).padStart(2, "0");

/** Fixed UTC rendering so the console reads the same on every machine. */
export function formatTimestamp(date: Date): string {
  return (
    `${date.getUTCFullYear()}-${two(date.getUTCMonth() + 1)}-${two(date.getUTCDate())}` +
    ` ${two(date.getUTCHours())}:${two(date.getUTCMinutes())}:${two(date.getUTCSeconds())} UTC`
  );
}

export function formatDate(date: Date): string {
  return `${date.getUTCFullYear()}-${two(date.getUTCMonth() + 1)}-${two(date.getUTCDate())}`;
}

/** 0.97 -> "0.97" — confidence is a probability, shown as one. */
export function formatConfidence(confidence: number): string {
  return confidence.toFixed(2);
}

/** Share of the mandate cap a cart consumes, as a percentage string. */
export function capUtilisation(totalMinor: number, capMinor: number): string {
  if (capMinor <= 0) return "n/a";
  return `${Math.round((totalMinor / capMinor) * 100)}%`;
}
