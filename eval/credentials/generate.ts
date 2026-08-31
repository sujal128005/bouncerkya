/**
 * Adversarial credential generator.
 *
 * WHY THIS EXISTS SEPARATELY FROM `eval/dataset.ts`
 *
 * The 21-case dataset measures decision quality and needs a model call per
 * case, which caps it at a few hundred cases on any realistic budget. The
 * Mandate Verifier is different: it is pure Ed25519 plus three deterministic
 * checks, it costs ~129 microseconds, and it never reaches a model. That path
 * can be attacked at a scale the model path never will be, and the property it
 * must hold is a security property rather than an accuracy one:
 *
 *     NO INVALID CREDENTIAL MAY EVER VERIFY.
 *
 * A false allow here is worse than any diff mistake, because it means a forged
 * or replayed mandate reached the engine at all.
 *
 * ON LABEL PROVENANCE — the thing that makes a synthetic benchmark honest or
 * worthless. Every case is built from an INTENT chosen first; the artifacts are
 * then derived to match, and the label is read off the intent. The generator
 * never calls `verifyMandate`, never imports the policy, and encodes no copy of
 * Bouncer's rules. So "expected: reject" means "this credential was constructed
 * to be invalid", not "Bouncer said it was invalid". If the two disagree, that
 * is a real finding rather than a tautology.
 *
 * Deterministic: the same seed produces byte-identical cases, so a reviewer can
 * reproduce any number this harness reports.
 */

import crypto, { type KeyObject } from "node:crypto";

import { canonicalMandatePayload } from "@/lib/mandate/canonical";
import { generateAgentKeyPair, signMandate } from "@/lib/mandate/keys";

/** What the case IS. The label is derived from this, never from Bouncer. */
export type CredentialIntent =
  | "valid"
  | "expired"
  | "expired_by_one_second"
  | "replayed_nonce"
  | "tampered_signature"
  | "wrong_agent_key"
  | "substituted_signature"
  | "malformed";

export type CredentialCase = {
  id: string;
  intent: CredentialIntent;
  /** Derived from intent alone. */
  expected: "accept" | "reject";
  mandate: unknown;
  agentId: string;
  /** Nonces already spent before this case is presented. */
  nonceAlreadySpentBy: string | null;
  presentedByPurchaseRequestId: string;
};

/* ------------------------------------------------------------------ random */

/** mulberry32 — small, fast, seeded. Reproducibility matters more than quality. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(rng: () => number, xs: readonly T[]): T =>
  xs[Math.floor(rng() * xs.length)]!;

const intBetween = (rng: () => number, lo: number, hi: number): number =>
  lo + Math.floor(rng() * (hi - lo + 1));

/* ------------------------------------------------------------- populations */

const CATEGORIES = [
  "footwear/running-shoes",
  "home/kitchen-equipment",
  "electronics/audio",
  "apparel/outerwear",
  "books/print",
] as const;

const AGENTS = ["agt_vega_01", "agt_pantry_02", "agt_orbit_03"] as const;
const PRINCIPALS = ["prn_7K21QD", "prn_3M88ZP", "prn_9W02LT"] as const;

/**
 * Malformations, each a distinct way a credential can be structurally wrong.
 * Listed explicitly rather than fuzzed at random so coverage is auditable.
 */
const MALFORMATIONS = [
  "missing_signature",
  "empty_category_scope",
  "negative_spend_cap",
  "non_integer_spend_cap",
  "missing_nonce",
  "wrong_currency",
  "signature_not_base64",
  "signature_wrong_length",
  "missing_expiry",
  "expiry_not_a_date",
] as const;

export type Malformation = (typeof MALFORMATIONS)[number];

/* ---------------------------------------------------------------- keystore */

export type GeneratedKeystore = {
  /** Public key per agent, as the verifier would resolve it. */
  publicKeyForAgent: Map<string, KeyObject>;
  privateKeyForAgent: Map<string, KeyObject>;
  /** An agent whose key is NOT registered — used for wrong-key cases. */
  strangerPrivateKey: KeyObject;
};

export function buildKeystore(): GeneratedKeystore {
  const publicKeyForAgent = new Map<string, KeyObject>();
  const privateKeyForAgent = new Map<string, KeyObject>();

  for (const agent of AGENTS) {
    const kp = generateAgentKeyPair();
    publicKeyForAgent.set(agent, kp.publicKey);
    privateKeyForAgent.set(agent, kp.privateKey);
  }

  return {
    publicKeyForAgent,
    privateKeyForAgent,
    strangerPrivateKey: generateAgentKeyPair().privateKey,
  };
}

/* ------------------------------------------------------------- generation */

/**
 * Intent mix. Weighted so valid credentials dominate, as they would in
 * production — a benchmark made mostly of attacks would flatter the false-allow
 * rate by giving it few chances to be wrong on the accept side.
 */
const INTENT_MIX: ReadonlyArray<[CredentialIntent, number]> = [
  ["valid", 55],
  ["expired", 8],
  ["expired_by_one_second", 4],
  ["replayed_nonce", 8],
  ["tampered_signature", 8],
  ["wrong_agent_key", 7],
  ["substituted_signature", 4],
  ["malformed", 6],
];

const INTENT_TOTAL = INTENT_MIX.reduce((sum, [, w]) => sum + w, 0);

function pickIntent(rng: () => number): CredentialIntent {
  let roll = rng() * INTENT_TOTAL;
  for (const [intent, weight] of INTENT_MIX) {
    roll -= weight;
    if (roll <= 0) return intent;
  }
  return "valid";
}

const NOW = new Date("2026-08-25T08:00:00.000Z");

type MandateShape = {
  id: string;
  principalId: string;
  agentId: string;
  categoryScope: string[];
  spendCapMinor: number;
  currency: "INR";
  expiresAt: Date;
  nonce: string;
  createdAt: Date;
  signature?: string;
};

function applyMalformation(
  mandate: Record<string, unknown>,
  which: Malformation,
): Record<string, unknown> {
  const m = { ...mandate };
  switch (which) {
    case "missing_signature":
      delete m.signature;
      return m;
    case "empty_category_scope":
      return { ...m, categoryScope: [] };
    case "negative_spend_cap":
      return { ...m, spendCapMinor: -50_000 };
    case "non_integer_spend_cap":
      return { ...m, spendCapMinor: 4999.5 };
    case "missing_nonce":
      delete m.nonce;
      return m;
    case "wrong_currency":
      return { ...m, currency: "USD" };
    case "signature_not_base64":
      return { ...m, signature: "ed25519:!!!not base64!!!" };
    case "signature_wrong_length":
      return { ...m, signature: `ed25519:${Buffer.from("short").toString("base64")}` };
    case "missing_expiry":
      delete m.expiresAt;
      return m;
    case "expiry_not_a_date":
      return { ...m, expiresAt: "whenever" };
  }
}

export function generateCredentialCases(
  count: number,
  keystore: GeneratedKeystore,
  seed = 20260829,
): CredentialCase[] {
  const rng = makeRng(seed);
  const cases: CredentialCase[] = [];

  for (let i = 0; i < count; i += 1) {
    const intent = pickIntent(rng);
    const agentId = pick(rng, AGENTS);
    const id = `mnd_G${i.toString(36).toUpperCase().padStart(6, "0")}`;
    const requestId = `req_G${i.toString(36).toUpperCase().padStart(6, "0")}`;

    // Expiry is chosen from the intent, not corrected afterwards.
    const expiresAt =
      intent === "expired"
        ? new Date(NOW.getTime() - intBetween(rng, 60_000, 90 * 24 * 3600_000))
        : intent === "expired_by_one_second"
          ? new Date(NOW.getTime() - 1000)
          : new Date(NOW.getTime() + intBetween(rng, 3600_000, 120 * 24 * 3600_000));

    const base: MandateShape = {
      id,
      principalId: pick(rng, PRINCIPALS),
      agentId,
      categoryScope: [pick(rng, CATEGORIES)],
      spendCapMinor: intBetween(rng, 50, 2000) * 100,
      currency: "INR",
      expiresAt,
      nonce: `nnc_${i.toString(36)}_${Math.floor(rng() * 1e9).toString(36)}`,
      createdAt: new Date(NOW.getTime() - intBetween(rng, 3600_000, 30 * 24 * 3600_000)),
    };

    // The signing key is chosen by intent: the wrong-key and substitution
    // cases are forgeries in the cryptographic sense, not just bad data.
    const signingKey =
      intent === "wrong_agent_key"
        ? keystore.strangerPrivateKey
        : keystore.privateKeyForAgent.get(agentId)!;

    let signature = signMandate(base, signingKey);

    if (intent === "tampered_signature") {
      // Flip one bit in the signature body. Still 64 bytes, still base64 —
      // only real verification catches this, not a shape check.
      const raw = Buffer.from(signature.slice("ed25519:".length), "base64");
      raw[intBetween(rng, 0, raw.length - 1)] ^= 1 << intBetween(rng, 0, 7);
      signature = `ed25519:${raw.toString("base64")}`;
    }

    if (intent === "substituted_signature") {
      // A VALID signature — over a different mandate. Lifting a real signature
      // onto other content is the classic substitution attack, and it passes
      // every structural check.
      const other: MandateShape = {
        ...base,
        id: `${id}_OTHER`,
        spendCapMinor: base.spendCapMinor * 4,
      };
      signature = signMandate(other, keystore.privateKeyForAgent.get(agentId)!);
      void canonicalMandatePayload; // documents that the payload differs
    }

    let mandate: Record<string, unknown> = { ...base, signature };

    if (intent === "malformed") {
      mandate = applyMalformation(mandate, pick(rng, MALFORMATIONS));
    }

    cases.push({
      id: requestId,
      intent,
      expected: intent === "valid" ? "accept" : "reject",
      mandate,
      agentId,
      nonceAlreadySpentBy:
        intent === "replayed_nonce" ? `req_EARLIER_${i.toString(36)}` : null,
      presentedByPurchaseRequestId: requestId,
    });
  }

  return cases;
}

export const CREDENTIAL_INTENTS = INTENT_MIX.map(([intent]) => intent);
export { MALFORMATIONS, crypto };
