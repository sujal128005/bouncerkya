/**
 * The measured results, in one place.
 *
 * Every figure here is transcribed from a run recorded in README.md, and the
 * `command` field is how you reproduce it. Nothing on this list is projected,
 * rounded up, or averaged across runs that disagreed.
 *
 * The shape is deliberate. A result that carries only `proves` is a marketing
 * claim; every entry here must also say what it does NOT prove, because the
 * fastest way to lose a technical reader is to let them find the limitation
 * themselves. Where a result came back negative or unstable, it is on this
 * list with the same weight as the good ones.
 *
 * This module is data, not logic. It is rendered by /evidence and summarised
 * on the landing page, and it is imported by nothing in the decision path.
 */

export type Verification = {
  /** What was claimed. */
  claim: string;
  status: "verified" | "verified-by-human" | "not-verified";
  /** How it was established, or why it has not been. */
  evidence: string;
};

export type MeasuredResult = {
  id: string;
  title: string;
  /** The command that reproduces it, if there is one. */
  command: string | null;
  /** One line of framing before the numbers. */
  summary: string;
  figures: Array<{ label: string; value: string; emphasis?: boolean }>;
  proves: string;
  doesNotProve: string;
};

/** Size of the automated suite, as `npx vitest run` last reported it. */
export const TEST_COUNT = 257;

/* ------------------------------------------------------------- the results */

export const CREDENTIAL_BENCHMARK: MeasuredResult = {
  id: "credentials",
  title: "Credential path at scale",
  command: "npm run eval:credentials",
  summary:
    "The credential path is deterministic: Ed25519 plus three checks, no model. Unlike a semantic judgement it can therefore be attacked at scale. 100,000 generated credentials across eight adversarial families, seed 20260829, reproducible on any machine.",
  figures: [
    { label: "Cases", value: "100,000" },
    { label: "False accepts", value: "0", emphasis: true },
    { label: "False rejects", value: "0", emphasis: true },
    { label: "Model calls", value: "0", emphasis: true },
    { label: "Throughput", value: "7,487 / sec" },
    { label: "Per decision", value: "134 µs" },
    { label: "Wall clock", value: "13.4 s" },
  ],
  proves:
    "No attack family in the set slips through, and the fail-closed path costs microseconds rather than a model call. The hardest family is substituted_signature, a cryptographically valid signature lifted from a different mandate. It passes every structural check and is caught only because the signature covers a canonical payload binding the mandate's own fields.",
  doesNotProve:
    "This is a correctness and throughput result, not an accuracy claim. Ed25519 either verifies or it does not; there is no judgement involved, so a near-perfect score is the expected outcome and demonstrates no clever discrimination. It says nothing about the semantic path.",
};

export const NEGATIVE_CONTROL: MeasuredResult = {
  id: "self-test",
  title: "The benchmark can fail, and that is proven rather than asserted",
  command: "npm run eval:credentials -- 100000 --self-test",
  summary:
    "“Zero false accepts” means nothing if the harness is incapable of reporting one. That is not hypothetical here: an earlier version of this benchmark reported 491,000 verifications/sec while every single verification was failing. It was timing the early-exit rejection path, and the number looked 63× better than the truth while measuring nothing.",
  figures: [
    { label: "Injected bug", value: "1% always-valid" },
    { label: "False accepts expected", value: "~449" },
    { label: "False accepts caught", value: "479" },
    { label: "Result", value: "PASS", emphasis: true },
  ],
  proves:
    "The harness detects a deliberately broken verifier, so a clean run is a measurement rather than an assumption. If this ever prints FAIL, every clean number the harness has produced is void.",
  doesNotProve:
    "It validates the harness, not the product. A working detector of one injected bug is not a guarantee against every possible harness defect.",
};

export const DECISION_QUALITY: MeasuredResult = {
  id: "decision-quality",
  title: "Decision quality",
  command: "npm run eval",
  summary:
    "21 labelled cases through the real pipeline, one run, groq · openai/gpt-oss-120b.",
  figures: [
    { label: "Precision", value: "100.0%" },
    { label: "Recall", value: "92.9%" },
    { label: "False allows", value: "0", emphasis: true },
    { label: "False declines", value: "0", emphasis: true },
    { label: "Deferred to a human", value: "1 of 19 scored" },
    { label: "Latency mean / p95", value: "10.5 s / 19.8 s" },
    { label: "Credential-only cases", value: "4/4 in under 2 ms" },
  ],
  proves:
    "On this set the pipeline never allowed something it should have blocked. The single recall miss stepped up rather than declining, so a human still had to approve it. That is not a path to an unauthorised payment.",
  doesNotProve:
    "21 cases is a small set and this is one run. Two ambiguous cases are excluded from precision and recall by design.",
};

export const SEMANTIC_PATH: MeasuredResult = {
  id: "semantic",
  title: "Semantic path: boundary cases through the live pipeline",
  command: "npm run eval:semantic",
  summary:
    "The model-in-loop half, measured on deliberately hard cases. Every case ran through the same evaluatePurchaseRequest the console and the live agent use.",
  figures: [
    { label: "Cases measured", value: "46 (43 scored, 3 ambiguous)" },
    { label: "True blocks", value: "22/26" },
    { label: "True allows", value: "17/17" },
    { label: "False allows", value: "0", emphasis: true },
    { label: "False declines", value: "0", emphasis: true },
    { label: "Precision", value: "100.0%" },
    { label: "Recall", value: "84.6%" },
  ],
  proves:
    "Every single disagreement is the ₹1 boundary family, always in the same direction, escalated to a human instead of declined, four for four, across two different model providers. The behaviour is consistent, explainable, and never resolves toward allowing.",
  doesNotProve:
    "n = 46, not the 250 planned: two providers hit daily quotas mid-run, and the honest number is what was measured rather than what was intended. The 46 span groq · openai/gpt-oss-120b and gemini · gemini-3.6-flash, so it is not a single-model result, but it is a small one.",
};

export const OUTAGE_FINDING: MeasuredResult = {
  id: "outage",
  title: "What the outages accidentally proved",
  command: null,
  summary:
    "Across the abandoned runs, more than 400 cases were evaluated with no working model backend at all: first Groq's daily token quota, then Gemini's. Nobody designed this experiment; two free tiers ran it.",
  figures: [
    { label: "Cases with no working engine", value: "400+" },
    { label: "Escalated to a human", value: "all of them", emphasis: true },
    { label: "Carts approved without an engine", value: "0", emphasis: true },
  ],
  proves:
    "The locked invariant, that AI failure never becomes ALLOW, tested at a scale we would never have paid for, under two independent failure modes (quota exhaustion, request timeout), on two providers.",
  doesNotProve:
    "These cases are not scored as decision quality. A STEP_UP from the threshold policy and a STEP_UP from a dead engine are different events; the harness separates them, warns when more than 20% of a run is unmeasured, and exits non-zero.",
};

export const INJECTION_RESISTANCE: MeasuredResult = {
  id: "injection",
  title: "Injection resistance, and a change made after measuring",
  command: "npm run agent:run -- adversarial",
  summary:
    "The first measurement was worthless and the reason is worth stating. Baseline exposure was 0 of 7 completed runs: browse_catalog returns only id, name, category and price, the injection lives in the listing description, and the agent bought off the browse list without opening a product page. That “0% hit rate” measured browsing behaviour, not injection resistance.",
  figures: [
    { label: "Exposure, after the fix", value: "3 of 4 runs" },
    { label: "Followed the injection", value: "0 of 3" },
  ],
  proves:
    "Delivery was fixed, not persuasion: add_to_cart now requires a prior view_listing, and the poisoned listing was repriced ₹3,899 → ₹2,999 to become the cheapest running shoe. The injection text, the agent's system prompt and the agent's freedom to comply were deliberately left alone.",
  doesNotProve:
    "With n = 3 this is a weak signal and no resistance rate is claimed from it. Resistance is a property of one model on one day, which is exactly why the gateway is not premised on the agent being hard to fool.",
};

export const KNOWN_INSTABILITY: MeasuredResult = {
  id: "instability",
  title: "Known instability",
  command: null,
  summary:
    "Clause severity is not stable across identical input. The seeded commercial-blender case was run four times against the same model with the same cart and the same mandate.",
  figures: [
    { label: "Run 1", value: "0.86 · high · DECLINE" },
    { label: "Run 2", value: "0.82 · high · DECLINE" },
    { label: "Run 3", value: "0.85 · medium + low · STEP_UP" },
    { label: "Run 4", value: "0.85 · high · DECLINE" },
  ],
  proves:
    "The variance is real and it is disclosed rather than hidden behind a cached fixture. Note the direction: the unstable run escalated to a human. The instability moves between blocking and asking, never toward allowing.",
  doesNotProve:
    "It is not fixed. A model that grades the same input differently on different calls is a genuine limitation of a model-in-loop design, and the deterministic policy exists precisely because the model cannot be the decider.",
};

export const ALL_RESULTS: MeasuredResult[] = [
  CREDENTIAL_BENCHMARK,
  NEGATIVE_CONTROL,
  DECISION_QUALITY,
  SEMANTIC_PATH,
  OUTAGE_FINDING,
  INJECTION_RESISTANCE,
  KNOWN_INSTABILITY,
];

/* ------------------------------------------------------- razorpay, itemised */

/**
 * Four different things get called "verified" in write-ups like this one, and
 * they are not the same. Split so a reader can see the seam.
 */
export const RAZORPAY_VERIFICATION: Verification[] = [
  {
    claim: "Webhook signature verification",
    status: "verified",
    evidence:
      "Unit tests: HMAC-SHA256 over the raw body, constant-time compare, wrong signature rejected.",
  },
  {
    claim: "Live-mode keys are refused",
    status: "verified-by-human",
    evidence:
      "Fired in production on a real rzp_live_ credential that reached .env by mistake. Three independent layers refused it and the error masked the key; no API call was ever made with it. The keys were rotated immediately.",
  },
  {
    claim: "Idempotency",
    status: "verified",
    evidence:
      "Database-unique on purchaseRequestId and policyDecisionId; a repeat returns the existing order.",
  },
  {
    claim: "SDK, auth, minor units, receipt",
    status: "verified",
    evidence: "npm run razorpay:verify against the live test API, 294 ms round trip.",
  },
  {
    claim: "An order exists in the Razorpay dashboard",
    status: "verified-by-human",
    evidence:
      "order_TVI6K1KFNkmPxM · ₹1,001.01 · receipt bouncer_verify_mtezfd8u · 30 Aug 2026 · status created.",
  },
  {
    claim: "No payment is captured",
    status: "verified",
    evidence: "Dashboard shows 0 captured payments, 0 refunds, 0 disputes, 0 failed.",
  },
  {
    claim: "A pipeline ALLOW creates the order",
    status: "not-verified",
    evidence:
      "The confirmed order came from razorpay:verify, a direct probe. The ALLOW → order path is unit-tested and database-enforced, but has not been observed end to end against the live API.",
  },
  {
    claim: "Webhook delivery from Razorpay",
    status: "not-verified",
    evidence: "Requires a public URL. The handler is tested; the delivery is not.",
  },
];

/* ------------------------------------------------------------ the pipeline */

export type Stage = {
  n: number;
  key: string;
  name: string;
  /** What the stage does, in one sentence a non-engineer can follow. */
  what: string;
  /** Deterministic code, or a model call. The distinction is the product. */
  kind: "deterministic" | "model" | "human";
  /** What it costs, honestly. */
  cost: string;
};

export const PIPELINE: Stage[] = [
  {
    n: 1,
    key: "mandate",
    name: "Verify the mandate",
    what: "Check the human's signed authorization is well-formed, genuinely signed by this agent's key, unexpired, and not already spent.",
    kind: "deterministic",
    cost: "~134 µs · no model call",
  },
  {
    n: 2,
    key: "evidence",
    name: "Extract the evidence",
    what: "Separate what the merchant asserts from what the listing's free text says. Untrusted text is quoted as evidence, never obeyed as instruction.",
    kind: "deterministic",
    cost: "sub-millisecond",
  },
  {
    n: 3,
    key: "diff",
    name: "Diff intent against cart",
    what: "Ask the model where the cart departs from the mandate, clause by clause: category, budget, quantity, injected instruction.",
    kind: "model",
    cost: "seconds · the only model call",
  },
  {
    n: 4,
    key: "policy",
    name: "Apply the policy",
    what: "A deterministic threshold rule turns the diff into ALLOW, STEP_UP or DECLINE. The model recommends; this decides.",
    kind: "deterministic",
    cost: "sub-millisecond",
  },
  {
    n: 5,
    key: "stepup",
    name: "Escalate to the human",
    what: "Anything the policy will not decide alone waits for the principal to answer. An engine that cannot judge lands here, never on allow.",
    kind: "human",
    cost: "as long as the human takes",
  },
  {
    n: 6,
    key: "audit",
    name: "Append to the audit chain",
    what: "Every step is written to a SHA-256 hash chain over canonical JSON, so a later edit to any record breaks the chain visibly.",
    kind: "deterministic",
    cost: "sub-millisecond",
  },
];
