import { appendAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { StepUpStatus } from "@/schemas";

/**
 * Human step-up responses.
 *
 * The principal's answer is a durable fact about a decision, so it is written
 * to the database and hash-chained into the audit log exactly like the machine
 * decision it answers. The UI reflects stored state, not optimistic state.
 */

export type StepUpAction = "approve" | "reject";

export type StepUpResponse =
  | {
      ok: true;
      stepUpId: string;
      status: "approved" | "rejected";
      respondedAt: Date;
      auditSequence: number;
    }
  | { ok: false; error: "not_found" | "already_resolved"; detail: string };

const ACTION_TO_STATUS: Record<StepUpAction, "approved" | "rejected"> = {
  approve: "approved",
  reject: "rejected",
};

export async function respondToStepUp(
  stepUpId: string,
  action: StepUpAction,
  options: { now?: Date } = {},
): Promise<StepUpResponse> {
  const respondedAt = options.now ?? new Date();
  const status = ACTION_TO_STATUS[action];

  const existing = await prisma.stepUpRequest.findUnique({
    where: { id: stepUpId },
    include: { policyDecision: { select: { id: true, purchaseRequestId: true } } },
  });

  if (!existing) {
    return { ok: false, error: "not_found", detail: `no step-up ${stepUpId}` };
  }

  // A principal answers once. A second answer is not an update, it is a race
  // or a replay, and silently overwriting the first would erase who decided.
  //
  // This check is a fast path for the common case and for a good error
  // message. It is NOT what makes the guarantee hold: read-then-write leaves a
  // window in which two concurrent answers both observe "pending" and both
  // proceed, producing two audit events and letting the later answer overwrite
  // the earlier one. Two people clicking Approve and Reject at the same moment
  // is exactly the scenario an audit trail exists to survive.
  if (StepUpStatus.parse(existing.status) !== "pending") {
    return {
      ok: false,
      error: "already_resolved",
      detail: `step-up ${stepUpId} is already ${existing.status}`,
    };
  }

  // The real guarantee: one conditional UPDATE, with the expected state in the
  // WHERE clause. The database decides the winner, so there is no window
  // between the check and the write. A count of zero means someone else
  // answered first, and this caller must not append an audit event.
  const claimed = await prisma.stepUpRequest.updateMany({
    where: { id: stepUpId, status: "pending" },
    data: { status, respondedAt },
  });

  if (claimed.count === 0) {
    const current = await prisma.stepUpRequest.findUnique({
      where: { id: stepUpId },
      select: { status: true },
    });
    return {
      ok: false,
      error: "already_resolved",
      detail: `step-up ${stepUpId} was answered concurrently and is already ${current?.status ?? "resolved"}`,
    };
  }

  const event = await appendAuditEvent(
    existing.policyDecision.purchaseRequestId,
    existing.policyDecision.id,
    {
      event: "step_up_response",
      stepUpRequestId: stepUpId,
      policyDecisionId: existing.policyDecision.id,
      purchaseRequestId: existing.policyDecision.purchaseRequestId,
      principalId: existing.principalId,
      action,
      status,
      respondedAt: respondedAt.toISOString(),
    },
    { eventType: "step_up_response", now: respondedAt },
  );

  return {
    ok: true,
    stepUpId,
    status,
    respondedAt,
    auditSequence: event.sequence,
  };
}
