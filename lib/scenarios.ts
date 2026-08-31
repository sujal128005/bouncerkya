/**
 * Reads the seeded scenarios out of SQLite via Prisma and maps the rows back
 * into the Zod domain objects the UI renders. Every row is validated on the way
 * out, so a drift between prisma/schema.prisma and /schemas surfaces as a parse
 * error rather than as a wrong number on screen.
 *
 * Mandate validity is NOT read from the database — it is recomputed here, on
 * every request, by the real Mandate Verifier against the keystore and the
 * nonce ledger. What the console shows is the verifier's live output.
 */
import { prisma } from "@/lib/db";
import { open } from "@/lib/privacy/at-rest";
import {
  readKeystore,
  resolvePublicKey,
  verifyMandate,
  type MandateVerification,
} from "@/lib/mandate";
import {
  Agent,
  AuthorizationDiff,
  Mandate,
  PolicyDecision,
  Principal,
  PurchaseRequest,
  StepUpRequest,
} from "@/schemas";

export type ScenarioView = {
  /** Stable key used by the scenario switcher. */
  key: string;
  purchaseRequest: PurchaseRequest;
  mandate: Mandate;
  agent: Agent;
  principal: Principal;
  /** Live output of the Mandate Verifier, recomputed on read. */
  mandateVerification: MandateVerification;
  /** Null when the request was short-circuited before the Intent-Cart Engine. */
  diffId: string | null;
  diff: AuthorizationDiff | null;
  /** Where the diff came from. Null when there is no diff. */
  diffProvenance: {
    source: "live" | "fixture";
    model: string | null;
    engineLatencyMs: number | null;
    computedAt: Date | null;
  } | null;
  /** Set when the engine was called and did not return a usable diff. */
  engineFailure: { reason: string; details: string } | null;
  /**
   * Null for every mandate-valid scenario: nothing has decided them yet. The
   * Policy Engine is Prompt 4. Present only on the DECLINEs the Mandate
   * Verifier produced by construction.
   */
  decision: PolicyDecision | null;
  stepUp: StepUpRequest | null;
  /** Present only for an ALLOW that reached Razorpay. */
  razorpayOrder: {
    razorpayOrderId: string;
    status: string;
    amountMinor: number;
    receipt: string;
    paymentStatus: string | null;
    razorpayPaymentId: string | null;
  } | null;
};

const scenarioInclude = {
  items: { orderBy: { position: "asc" } },
  mandate: { include: { principal: true, agent: true } },
  agent: true,
  authorizationDiff: { include: { clauses: { orderBy: { position: "asc" } } } },
  policyDecision: { include: { stepUpRequest: true } },
  razorpayOrder: true,
} as const;

function parseStructuredFields(json: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(json);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("sessionStructuredFields is not a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function parseCategoryScope(json: string): string[] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed) || !parsed.every((v) => typeof v === "string")) {
    throw new Error("categoryScope is not a JSON array of strings");
  }
  return parsed;
}

/**
 * The generated Prisma client is a build artifact, not source. Pulling a schema
 * change without re-running `prisma generate` leaves it missing models, which
 * otherwise surfaces as "Cannot read properties of undefined".
 */
function assertClientIsCurrent(): void {
  if (typeof prisma.consumedNonce?.findMany !== "function") {
    throw new Error(
      "The generated Prisma client is out of date: it has no ConsumedNonce model.",
    );
  }
}

export async function listScenarios(): Promise<ScenarioView[]> {
  assertClientIsCurrent();

  const [rows, agents, consumedNonces] = await Promise.all([
    prisma.purchaseRequest.findMany({
      include: scenarioInclude,
      orderBy: { requestedAt: "asc" },
    }),
    prisma.agent.findMany(),
    prisma.consumedNonce.findMany(),
  ]);

  const keystore = readKeystore();
  if (rows.length > 0 && Object.keys(keystore).length === 0) {
    throw new Error(
      "No agent keystore found at keystore/agent-keys.json, so mandate signatures cannot be verified.",
    );
  }

  const keyRefByAgentId = new Map(
    agents.map((agent) => [agent.id, agent.publicKeyRef]),
  );
  const nonceConsumers = new Map(
    consumedNonces.map((entry) => [entry.nonce, entry.purchaseRequestId]),
  );
  const now = new Date();

  return rows.map((row) => {
    const mandate = Mandate.parse({
      ...row.mandate,
      categoryScope: parseCategoryScope(row.mandate.categoryScope),
    });

    const mandateVerification = verifyMandate(mandate, {
      now,
      resolvePublicKeyForAgent: (agentId) => {
        const ref = keyRefByAgentId.get(agentId);
        return ref ? resolvePublicKey(keystore, ref) : null;
      },
      nonceConsumedBy: (nonce) => nonceConsumers.get(nonce) ?? null,
      presentedByPurchaseRequestId: row.id,
    });

    return {
      key: row.id,
      purchaseRequest: PurchaseRequest.parse({
        id: row.id,
        mandateId: row.mandateId,
        agentId: row.agentId,
        // Opened here, at the single read boundary, so nothing downstream --
        // the UI, the engine, the policy -- has to know a column was sealed.
        items: row.items.map((item) => ({
          name: open("CartItem", "name", item.id, item.name)!,
          category: item.category,
          quantity: item.quantity,
          unitPriceMinor: item.unitPriceMinor,
          sourceListingId: item.sourceListingId,
        })),
        totalMinor: row.totalMinor,
        sessionContext: {
          structuredFields: parseStructuredFields(
            open(
              "PurchaseRequest",
              "sessionStructuredFields",
              row.id,
              row.sessionStructuredFields,
            )!,
          ),
          freeText: open(
            "PurchaseRequest",
            "sessionFreeText",
            row.id,
            row.sessionFreeText,
          ),
          injectionMarkerDetected: row.injectionMarkerDetected,
        },
        requestedAt: row.requestedAt,
      }),
      mandate,
      agent: Agent.parse(row.agent),
      principal: Principal.parse({
        ...row.mandate.principal,
        displayName: open(
          "Principal",
          "displayName",
          row.mandate.principal.id,
          row.mandate.principal.displayName,
        )!,
      }),
      mandateVerification,
      diffId: row.authorizationDiff?.id ?? null,
      diff: row.authorizationDiff
        ? AuthorizationDiff.parse(row.authorizationDiff)
        : null,
      diffProvenance: row.authorizationDiff
        ? {
            source:
              row.authorizationDiff.source === "live" ? "live" : "fixture",
            model: row.authorizationDiff.model,
            engineLatencyMs: row.authorizationDiff.engineLatencyMs,
            computedAt: row.authorizationDiff.computedAt,
          }
        : null,
      engineFailure: row.engineFailureReason
        ? {
            reason: row.engineFailureReason,
            details: row.engineFailureDetails ?? "",
          }
        : null,
      decision: row.policyDecision
        ? PolicyDecision.parse(row.policyDecision)
        : null,
      stepUp: row.policyDecision?.stepUpRequest
        ? StepUpRequest.parse(row.policyDecision.stepUpRequest)
        : null,
      razorpayOrder: row.razorpayOrder
        ? {
            razorpayOrderId: row.razorpayOrder.razorpayOrderId,
            status: row.razorpayOrder.status,
            amountMinor: row.razorpayOrder.amountMinor,
            receipt: row.razorpayOrder.receipt,
            paymentStatus: row.razorpayOrder.paymentStatus,
            razorpayPaymentId: row.razorpayOrder.razorpayPaymentId,
          }
        : null,
    };
  });
}

export type StepUpQueueEntry = {
  stepUp: StepUpRequest;
  scenario: ScenarioView;
};

/** Every step-up, pending first, then most recently answered. */
export async function listStepUps(): Promise<StepUpQueueEntry[]> {
  const scenarios = await listScenarios();

  return scenarios
    .filter((scenario): scenario is ScenarioView & { stepUp: StepUpRequest } =>
      scenario.stepUp !== null,
    )
    .map((scenario) => ({ stepUp: scenario.stepUp, scenario }))
    .sort((a, b) => {
      const pending = Number(b.stepUp.status === "pending") - Number(a.stepUp.status === "pending");
      if (pending !== 0) return pending;
      return (
        b.scenario.purchaseRequest.requestedAt.getTime() -
        a.scenario.purchaseRequest.requestedAt.getTime()
      );
    });
}

/** Everything currently waiting on a human answer. */
export async function listPendingStepUps(): Promise<StepUpQueueEntry[]> {
  return (await listStepUps()).filter(
    (entry) => entry.stepUp.status === "pending",
  );
}
