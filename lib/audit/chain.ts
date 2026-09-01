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
  | { sequence: number; kind: "genesis_not_null"; detail: string }
  | { sequence: number; kind: "record_drift"; detail: string }
  | { sequence: number; kind: "unreadable_payload"; detail: string };

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

/* ------------------------------------------------------- record reconciliation
 *
 * WHY THE HASH CHAIN ALONE IS NOT ENOUGH
 *
 * verifyChain proves that the audit events have not been edited. It says
 * nothing about the rows they describe. The operational tables are separate,
 * and until this existed you could open the database, change one
 * PolicyDecision from DECLINE to ALLOW, and the chain would still report
 * "verified" — because no audit event had been touched.
 *
 * That is precisely the attack an audit log is for. The recorded outcome is
 * the authority; the row is a mutable projection of it. So verification also
 * has to ask whether the projection still agrees with the record.
 *
 * Kept pure and separate from verifyChain so it can be tested without a
 * database, and so a caller with no access to the operational tables can still
 * verify the chain on its own.
 */

/** The subset of a PolicyDecision row that an audit event pins down. */
export type DecisionRecord = {
  id: string;
  purchaseRequestId: string;
  outcome: string;
  reason: string;
};

/** The subset of a StepUpRequest row that a step-up event pins down. */
export type StepUpRecord = {
  id: string;
  status: string;
};

export type ReconcilableEvent = {
  sequence: number;
  payload: string;
};

function compare(
  sequence: number,
  label: string,
  field: string,
  recorded: unknown,
  stored: unknown,
  violations: ChainViolation[],
): void {
  if (recorded === undefined) return; // the event does not pin this field down
  if (recorded === stored) return;
  violations.push({
    sequence,
    kind: "record_drift",
    detail:
      `${label}.${field} is "${String(stored)}" in the database but the audit ` +
      `event recorded "${String(recorded)}". The stored record was changed ` +
      `after the decision was written.`,
  });
}

/**
 * Checks every event against the row it describes.
 *
 * A missing row is a violation too: deleting the record an event points at is
 * a way of erasing a decision that leaves the chain itself intact.
 */
export function reconcileRecords(
  events: readonly ReconcilableEvent[],
  decisions: readonly DecisionRecord[],
  stepUps: readonly StepUpRecord[],
): ChainViolation[] {
  const violations: ChainViolation[] = [];
  const decisionById = new Map(decisions.map((d) => [d.id, d]));
  const stepUpById = new Map(stepUps.map((s) => [s.id, s]));

  for (const event of events) {
    let payload: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(event.payload);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("payload is not a JSON object");
      }
      payload = parsed as Record<string, unknown>;
    } catch (error) {
      violations.push({
        sequence: event.sequence,
        kind: "unreadable_payload",
        detail: `Payload could not be parsed as JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
      continue;
    }

    if (payload.event === "policy_decision") {
      const id = payload.policyDecisionId;
      if (typeof id !== "string") continue;
      const stored = decisionById.get(id);
      if (!stored) {
        violations.push({
          sequence: event.sequence,
          kind: "record_drift",
          detail: `PolicyDecision ${id} is recorded in the audit chain but no longer exists in the database.`,
        });
        continue;
      }
      compare(event.sequence, `PolicyDecision ${id}`, "outcome", payload.outcome, stored.outcome, violations);
      compare(event.sequence, `PolicyDecision ${id}`, "reason", payload.reason, stored.reason, violations);
      compare(
        event.sequence,
        `PolicyDecision ${id}`,
        "purchaseRequestId",
        payload.purchaseRequestId,
        stored.purchaseRequestId,
        violations,
      );
      continue;
    }

    if (payload.event === "step_up_response") {
      const id = payload.stepUpRequestId;
      if (typeof id !== "string") continue;
      const stored = stepUpById.get(id);
      if (!stored) {
        violations.push({
          sequence: event.sequence,
          kind: "record_drift",
          detail: `StepUpRequest ${id} is recorded in the audit chain but no longer exists in the database.`,
        });
        continue;
      }
      compare(event.sequence, `StepUpRequest ${id}`, "status", payload.status, stored.status, violations);
    }
  }

  return violations;
}
