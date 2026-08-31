import { createHash } from "node:crypto";

/**
 * The pure core of the audit log: canonicalisation, hashing, and chain
 * verification over a plain array. No database, no clock — so the tamper test
 * is a unit test, not an integration test.
 */

export type AuditPayload = Record<string, unknown>;

export type ChainEvent = {
  sequence: number;
  payload: string;
  payloadHash: string;
  previousEventHash: string | null;
};

/**
 * Deterministic JSON: object keys sorted at every depth, arrays left in order.
 * Two structurally identical payloads must hash identically regardless of the
 * order the fields happened to be written in.
 */
export function canonicalise(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return Object.fromEntries(entries.map(([k, v]) => [k, sortDeep(v)]));
}

export function hashPayload(canonicalPayload: string): string {
  return createHash("sha256").update(canonicalPayload, "utf8").digest("hex");
}

export type ChainViolation =
  | { sequence: number; kind: "hash_mismatch"; detail: string }
  | { sequence: number; kind: "broken_link"; detail: string }
  | { sequence: number; kind: "sequence_gap"; detail: string }
  | { sequence: number; kind: "genesis_not_null"; detail: string };

export type ChainVerification = {
  valid: boolean;
  eventsChecked: number;
  violations: ChainViolation[];
};

/**
 * Walks the chain in sequence order and checks three things per event:
 *   - the stored hash still matches a fresh hash of the stored payload
 *   - previousEventHash points at the previous event's hash (null at genesis)
 *   - sequence numbers are contiguous from 1
 *
 * Editing a payload breaks the first check. Editing a payload *and* its hash
 * breaks the second, at the next event. Both are caught.
 */
export function verifyChain(events: ChainEvent[]): ChainVerification {
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  const violations: ChainViolation[] = [];

  let previousHash: string | null = null;
  let expectedSequence = 1;

  for (const event of ordered) {
    if (event.sequence !== expectedSequence) {
      violations.push({
        sequence: event.sequence,
        kind: "sequence_gap",
        detail: `expected sequence ${expectedSequence}, found ${event.sequence}`,
      });
      expectedSequence = event.sequence;
    }
    expectedSequence += 1;

    const recomputed = hashPayload(event.payload);
    if (recomputed !== event.payloadHash) {
      violations.push({
        sequence: event.sequence,
        kind: "hash_mismatch",
        detail: `stored hash ${event.payloadHash.slice(0, 16)}… does not match the payload, which hashes to ${recomputed.slice(0, 16)}…`,
      });
    }

    if (previousHash === null && event.previousEventHash !== null) {
      violations.push({
        sequence: event.sequence,
        kind: "genesis_not_null",
        detail: "the first event must have a null previousEventHash",
      });
    } else if (previousHash !== null && event.previousEventHash !== previousHash) {
      violations.push({
        sequence: event.sequence,
        kind: "broken_link",
        detail: `previousEventHash ${String(event.previousEventHash).slice(0, 16)}… does not point at the preceding event's hash ${previousHash.slice(0, 16)}…`,
      });
    }

    previousHash = event.payloadHash;
  }

  return {
    valid: violations.length === 0,
    eventsChecked: ordered.length,
    violations,
  };
}
