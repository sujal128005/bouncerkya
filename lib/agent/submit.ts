import { randomUUID } from "node:crypto";

import { computeAuthorizationDiff, createDiffClient, withRateLimitPacing } from "@/lib/ai";
import { prisma } from "@/lib/db";
import { seal } from "@/lib/privacy/at-rest";
import { detectInjectionMarkers } from "@/lib/extraction";
import {
  exportPublicKey,
  generateAgentKeyPair,
  readKeystore,
  resolvePublicKey,
  signMandate,
  writeKeystore,
} from "@/lib/mandate";
import { evaluatePurchaseRequest, recordEvaluation } from "@/lib/pipeline";
import { createOrderForDecision } from "@/lib/razorpay";
import { Mandate, PurchaseRequest, type PolicyOutcome } from "@/schemas";

import { safeSink, stamp, type AgentEventSink } from "./events";
import { cartTotalMinor, wentOffMandate, type AgentRunResult } from "./run";

/**
 * Bridges a finished agent run into the real pipeline.
 *
 * Nothing here shortcuts anything: the run mints a real Ed25519 identity,
 * really signs a mandate, writes a real PurchaseRequest, and goes through
 * evaluatePurchaseRequest exactly like a seeded scenario. The only difference
 * is that the cart was chosen by a live model rather than written by hand.
 */

const DEMO_PRINCIPAL = { id: "prn_7K21QD", displayName: "Aarav Menon" };

export type SubmittedRun = {
  purchaseRequestId: string;
  mandateId: string;
  agentId: string;
  outcome: PolicyOutcome;
  decidedBy: string;
  reason: string;
  offMandate: boolean;
  cartTotalMinor: number;
  razorpay: { orderId: string | null; status: string | null; note: string } | null;
};

/**
 * Each live run mints its own agent identity and keypair. Private keys are
 * never persisted — the public half goes to the keystore so the Mandate
 * Verifier can check the signature for real.
 */
async function mintRunIdentity(mode: string): Promise<{
  agentId: string;
  publicKeyRef: string;
  privateKey: ReturnType<typeof generateAgentKeyPair>["privateKey"];
}> {
  const short = randomUUID().replace(/-/g, "").slice(0, 8);
  const agentId = `agt_live_${short}`;
  const publicKeyRef = `kms://bouncer/agent-keys/live-${short}`;
  const keyPair = generateAgentKeyPair();

  const keystore = readKeystore();
  keystore[publicKeyRef] = exportPublicKey(keyPair.publicKey);
  writeKeystore(keystore);

  await prisma.principal.upsert({
    where: { id: DEMO_PRINCIPAL.id },
    update: {},
    create: DEMO_PRINCIPAL,
  });

  await prisma.agent.create({
    data: {
      id: agentId,
      operatorName: `Live Demo Agent (${mode})`,
      platform: "bouncer-demo-harness/1.0",
      publicKeyRef,
    },
  });

  return { agentId, publicKeyRef, privateKey: keyPair.privateKey };
}

export async function submitAgentRun(
  run: AgentRunResult,
  goal: { categoryScope: string[]; spendCapMinor: number },
  onEvent?: AgentEventSink,
): Promise<SubmittedRun> {
  const emit = safeSink(onEvent);

  if (!run.session.checkedOut || run.session.cart.length === 0) {
    throw new Error("agent did not check out; nothing to submit");
  }

  const short = randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
  const identity = await mintRunIdentity(run.session.mode);
  const now = new Date();

  const unsigned = {
    id: `mnd_LIVE${short}`,
    principalId: DEMO_PRINCIPAL.id,
    agentId: identity.agentId,
    categoryScope: goal.categoryScope,
    spendCapMinor: goal.spendCapMinor,
    currency: "INR" as const,
    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    nonce: `nnc_live_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    createdAt: now,
  };

  const mandate = Mandate.parse({
    ...unsigned,
    signature: signMandate(unsigned, identity.privateKey),
  });

  await prisma.mandate.create({
    data: {
      id: mandate.id,
      principalId: mandate.principalId,
      agentId: mandate.agentId,
      categoryScope: JSON.stringify(mandate.categoryScope),
      spendCapMinor: mandate.spendCapMinor,
      currency: mandate.currency,
      expiresAt: mandate.expiresAt,
      nonce: mandate.nonce,
      signature: mandate.signature,
      createdAt: mandate.createdAt,
    },
  });

  // Everything the agent read becomes the session's untrusted free text —
  // including, in the adversarial run, the poisoned description.
  const freeText =
    run.session.viewed
      .map((listing) => `[${listing.id}] ${listing.name}\n${listing.description}`)
      .join("\n\n") || null;

  const request = PurchaseRequest.parse({
    id: `req_LIVE${short}`,
    mandateId: mandate.id,
    agentId: identity.agentId,
    items: run.session.cart.map((line) => ({
      name: line.listing.name,
      category: line.listing.category,
      quantity: line.quantity,
      unitPriceMinor: line.listing.priceMinor,
      sourceListingId: line.listing.id,
    })),
    totalMinor: cartTotalMinor(run.session),
    sessionContext: {
      structuredFields: {
        checkoutSurface: "agent-api",
        demoMode: run.session.mode,
        listingsViewed: run.session.viewed.length,
        agentReasoning: run.session.checkoutReasoning ?? "",
        modelCalls: run.modelCalls,
      },
      freeText,
      injectionMarkerDetected: detectInjectionMarkers(freeText ?? ""),
    },
    requestedAt: now,
  });

  await prisma.purchaseRequest.create({
    data: {
      id: request.id,
      mandateId: request.mandateId,
      agentId: request.agentId,
      totalMinor: request.totalMinor,
      // Sealed at the boundary, exactly as the seeder does. A live agent run
      // writes ciphertext for the same four columns as a seeded row.
      sessionStructuredFields: seal(
        "PurchaseRequest",
        "sessionStructuredFields",
        request.id,
        JSON.stringify(request.sessionContext.structuredFields),
      )!,
      sessionFreeText: seal(
        "PurchaseRequest",
        "sessionFreeText",
        request.id,
        request.sessionContext.freeText,
      ),
      injectionMarkerDetected: request.sessionContext.injectionMarkerDetected,
      requestedAt: request.requestedAt,
      items: {
        create: request.items.map((item, position) => ({
          id: `itm_LIVE${short}_${position}`,
          name: seal(
            "CartItem",
            "name",
            `itm_LIVE${short}_${position}`,
            item.name,
          )!,
          category: item.category,
          quantity: item.quantity,
          unitPriceMinor: item.unitPriceMinor,
          sourceListingId: item.sourceListingId,
          position,
        })),
      },
    },
  });

  emit({
    type: "stage.ok",
    stage: "mandate.sign",
    detail: `Ed25519 mandate signed for ${identity.agentId}`,
    at: stamp(),
  });

  const { client, config } = createDiffClient();
  const keystore = readKeystore();
  const consumed = await prisma.consumedNonce.findMany({ select: { nonce: true, purchaseRequestId: true } });
  const consumedMap = new Map(consumed.map((row) => [row.nonce, row.purchaseRequestId]));

  emit({
    type: "stage.start",
    stage: "mandate.verify",
    detail: "signature, expiry, replay",
    at: stamp(),
  });

  const evaluation = await evaluatePurchaseRequest(request, mandate, {
    now,
    resolvePublicKeyForAgent: (agentId) =>
      agentId === identity.agentId
        ? resolvePublicKey(keystore, identity.publicKeyRef)
        : null,
    nonceConsumedBy: (nonce) => consumedMap.get(nonce) ?? null,
    runEngine: (evidence) => {
      emit({
        type: "stage.ok",
        stage: "mandate.verify",
        detail: "credential valid: signature, expiry and nonce all pass",
        at: stamp(),
      });
      emit({
        type: "stage.ok",
        stage: "evidence.extract",
        detail: `${evidence.cart.lines.length} cart line(s), injection marker: ${
          evidence.injectionMarkerIds.length > 0
            ? evidence.injectionMarkerIds.join(", ")
            : "none"
        }`,
        at: stamp(),
      });
      emit({
        type: "stage.start",
        stage: "intent.diff",
        detail: `asking ${config.model} to diff the cart against the mandate`,
        at: stamp(),
      });
      return withRateLimitPacing(
        () => computeAuthorizationDiff(evidence, client, { model: config.model }),
        {
          onWait: (waitMs) =>
            emit({
              type: "waiting",
              detail: "provider rate limit, waiting it out",
              ms: waitMs,
              at: stamp(),
            }),
        },
      );
    },
  });

  // Report what the engine actually did, including when it failed. A failed
  // engine is the most interesting thing the trace can show: it is the moment
  // the fail-closed rule takes over.
  if (evaluation.engineResult && !evaluation.engineResult.success) {
    emit({
      type: "stage.failed",
      stage: "intent.diff",
      detail: `engine ${evaluation.engineResult.failureReason}, escalating to a human, never allowing`,
      at: stamp(),
    });
  } else if (evaluation.diff) {
    const highs = evaluation.diff.clauses.filter((c) => c.severity === "high").length;
    emit({
      type: "stage.ok",
      stage: "intent.diff",
      detail: `${evaluation.diff.overallVerdictRecommendation} at confidence ${evaluation.diff.confidence.toFixed(2)} · ${evaluation.diff.clauses.length} clause(s), ${highs} high`,
      at: stamp(),
    });
  } else if (!evaluation.verification.valid) {
    emit({
      type: "stage.failed",
      stage: "mandate.verify",
      detail: `credential rejected: ${evaluation.verification.failureReason}, no model was called`,
      at: stamp(),
    });
  }

  emit({
    type: "stage.ok",
    stage: "policy.evaluate",
    detail: `${evaluation.outcome} by ${evaluation.decidedBy}, deterministic, the model only recommended`,
    at: stamp(),
  });

  emit({
    type: "stage.start",
    stage: "audit.append",
    detail: "hash-chaining the decision",
    at: stamp(),
  });

  const persisted = await recordEvaluation(evaluation, {
    principalId: DEMO_PRINCIPAL.id,
    diffSource: "live",
    decidedAt: new Date(),
  });

  emit({
    type: "stage.ok",
    stage: "audit.append",
    detail: `decision ${persisted.policyDecisionId} appended to the chain`,
    at: stamp(),
  });

  // The only path to money. Reached from ALLOW and nowhere else.
  let razorpay: SubmittedRun["razorpay"] = null;
  if (evaluation.outcome === "ALLOW") {
    emit({
      type: "stage.start",
      stage: "razorpay.order",
      detail: "ALLOW, creating a test-mode order",
      at: stamp(),
    });
    const order = await createOrderForDecision({
      purchaseRequestId: request.id,
      policyDecisionId: persisted.policyDecisionId,
      outcome: evaluation.outcome,
      amountMinor: request.totalMinor,
    });
    razorpay = order.ok
      ? {
          orderId: order.razorpayOrderId,
          status: order.status,
          note: order.idempotentHit ? "existing order reused" : "order created",
        }
      : { orderId: null, status: null, note: `${order.error}: ${order.detail}` };

    emit(
      order.ok
        ? {
            type: "stage.ok",
            stage: "razorpay.order",
            detail: `${order.razorpayOrderId} (${order.idempotentHit ? "existing order reused" : "created"})`,
            at: stamp(),
          }
        : {
            type: "stage.failed",
            stage: "razorpay.order",
            detail: `${order.error}: ${order.detail}`,
            at: stamp(),
          },
    );
  } else {
    emit({
      type: "stage.ok",
      stage: "razorpay.order",
      detail: `skipped: outcome is ${evaluation.outcome}, and only ALLOW reaches Razorpay`,
      at: stamp(),
    });
  }

  return {
    purchaseRequestId: request.id,
    mandateId: mandate.id,
    agentId: identity.agentId,
    outcome: evaluation.outcome,
    decidedBy: evaluation.decidedBy,
    reason: evaluation.reason,
    offMandate: wentOffMandate(run.session, goal.categoryScope),
    cartTotalMinor: request.totalMinor,
    razorpay,
  };
}
