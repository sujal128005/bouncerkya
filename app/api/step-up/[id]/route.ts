import { NextResponse } from "next/server";

import { respondToStepUp, type StepUpAction } from "@/lib/step-up";

/**
 * The principal's answer to a step-up. Writes through to the database and the
 * audit chain — there is no optimistic-only path.
 */

const ACTIONS: StepUpAction[] = ["approve", "reject"];

function isAction(value: unknown): value is StepUpAction {
  return typeof value === "string" && ACTIONS.includes(value as StepUpAction);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "bad_request", detail: "body must be JSON" },
      { status: 400 },
    );
  }

  const action = (body as { action?: unknown } | null)?.action;
  if (!isAction(action)) {
    return NextResponse.json(
      { error: "bad_request", detail: 'action must be "approve" or "reject"' },
      { status: 400 },
    );
  }

  // A database failure here would otherwise surface as an unhandled throw:
  // a 500 carrying a framework stack trace, which can leak the connection
  // string and file paths. The principal's answer either lands or is refused
  // with a message they can act on.
  try {
    const result = await respondToStepUp(id, action);

    if (!result.ok) {
      return NextResponse.json(result, {
        status: result.error === "not_found" ? 404 : 409,
      });
    }

    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error("[step-up] failed to record answer", { stepUpId: id, error });
    return NextResponse.json(
      {
        error: "internal_error",
        detail:
          "The answer could not be recorded. Nothing was changed. Reload the approvals page and try again.",
      },
      { status: 500 },
    );
  }
}
