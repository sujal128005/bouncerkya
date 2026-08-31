# Bouncer

**Know Your Agent — a trust gateway for AI-driven checkout.**

Built for the Razorpay AI Buildathon by [Sujal Negi](https://sujalnegi.tech).

Bouncer sits between an AI shopping agent and Razorpay checkout. The agent presents a signed *mandate* that defines what it is allowed to buy, together with the cart it wants to purchase. Bouncer verifies the mandate, extracts evidence from the cart, asks an AI model to identify any mismatch, and then lets deterministic policy decide what happens.

The important part is simple:

> **The agent can propose a purchase. It cannot approve its own purchase.**

A purchase can end in one of three ways:

| Outcome | Meaning |
| --- | --- |
| `ALLOW` | The cart is consistent with the signed mandate. |
| `STEP_UP` | The result is ambiguous or the engine cannot safely decide, so a human must answer. |
| `DECLINE` | The purchase is outside the mandate or the credential is invalid. |

If an agent is hijacked by a prompt-injected product listing and tries to buy something outside its mandate, Bouncer checks the resulting cart against the authorization before anything reaches the payment rail.

---

## Architecture

```text
                         UNTRUSTED WORLD
┌──────────────────────────────────────────────────────────────────────┐
│                                                                      │
│   AI Shopping Agent                     Merchant / Product Pages    │
│   ┌─────────────────┐                  ┌────────────────────────┐   │
│   │ browse / choose │ ───────────────► │ names, prices, text     │   │
│   │ present mandate │                  │ may contain injection   │   │
│   └────────┬────────┘                  └───────────┬────────────┘   │
│            │ mandate + cart                         │ evidence       │
└────────────┼────────────────────────────────────────┼────────────────┘
             │                                        │
             ▼                                        ▼
┌──────────────────────────────── BOUNCER GATEWAY ─────────────────────┐
│                                                                      │
│  1. MANDATE VERIFIER                                                 │
│     Ed25519 · expiry · nonce replay · deterministic                  │
│                    │                                                 │
│                    ▼                                                 │
│  2. EVIDENCE EXTRACTION                                              │
│     category taxonomy · injection-marker scan · deterministic        │
│                    │                                                 │
│                    ▼                                                 │
│  3. INTENT-CART DIFF                 ┌───────────────────────────┐   │
│     AI model identifies mismatch ◄──►│ Model provider            │   │
│     schema-validated evidence only   │ cart data, no identity    │   │
│                                     └───────────────────────────┘   │
│                    │                                                 │
│                    ▼                                                 │
│  4. THRESHOLD POLICY                                                  │
│     deterministic · the only component that can produce ALLOW       │
│              ┌───────────────┼───────────────────┐                   │
│              ▼               ▼                   ▼                   │
│           ALLOW           STEP_UP              DECLINE               │
│              │               │                   │                   │
│              │               ▼                   │                   │
│              │        5. HUMAN APPROVAL          │                   │
│              │        principal answers          │                   │
│              │               │                   │                   │
│              └───────────────┼───────────────────┘                   │
│                              ▼                                       │
│                    6. SHA-256 AUDIT CHAIN                            │
│                                                                      │
└────────────────────────────────┬─────────────────────────────────────┘
                                 │
                                 │ ALLOW only
                                 ▼
                       ┌─────────────────────┐
                       │ Razorpay TEST MODE  │
                       │ Orders API          │
                       │ order only          │
                       └─────────────────────┘

                         TRUST MODEL

       Principal        Agent        Merchant text       AI model
          │                │                │                │
       TRUSTED          UNTRUSTED        UNTRUSTED       SEMI-TRUSTED
          │                │                │                │
       signs the        proposes         evidence,       opinion only
       mandate          the cart         never rules     never verdict
```

Every path to Razorpay passes through the gateway. A failed credential is rejected before the model is called. A failed or unavailable model cannot produce `ALLOW`. Only a completed, schema-valid diff evaluated by the deterministic policy can reach `ALLOW`.

The model is deliberately **not** the final decision-maker.

---

## Why Bouncer exists

AI shopping agents can browse products, compare options, and complete purchases with very little human involvement. That is useful, but it creates a different security problem.

A product page is controlled by somebody else. Its text can contain instructions aimed at the agent rather than the shopper. A compromised agent can also make a perfectly valid API request while still violating what the human originally authorized.

Bouncer therefore does not try to make the agent trustworthy.

It asks a narrower question:

> **Does this purchase match what the human actually authorized?**

The human's signed mandate is the root of authority. The agent can present a mandate and a cart, but neither the agent nor the merchant can declare that the purchase is acceptable.

---

## The six-stage pipeline

| Stage | Component | What it does | Failure behaviour |
| --- | --- | --- | --- |
| 1 | `lib/mandate` | Verifies structure, Ed25519 signature, expiry and nonce | `DECLINE` |
| 2 | `lib/extraction` | Extracts deterministic evidence, categories and injection markers | Continues |
| 3 | `lib/ai` | Produces a schema-validated intent-cart diff | `STEP_UP` |
| 4 | `lib/policy` | Applies fixed thresholds to the diff | `ALLOW`, `STEP_UP` or `DECLINE` |
| 5 | `lib/step-up` | Lets a human answer ambiguous cases | Human decision |
| 6 | `lib/audit` | Appends the decision flow to a SHA-256 hash chain | Recorded |

### The key separation

Stage 3 produces an `AuthorizationDiff`.

It describes things such as:

- category mismatch
- budget mismatch
- quantity mismatch
- injected instructions
- authorized value
- attempted value
- severity
- confidence
- explanation

It does **not** contain a verdict.

Stage 4 receives that object and applies deterministic thresholds. The same diff produces the same policy result every time.

That separation is intentional. Model variability stays inside the evidence-producing stage and cannot directly become payment authority.

---

## Fail-closed by design

The most important invariant in Bouncer is:

> **If the engine cannot safely produce a judgement, Bouncer escalates to `STEP_UP`. It never turns missing AI output into permission.**

That includes:

- timeout
- malformed model output
- API error
- rate limit
- missing API key
- provider outage
- provider switched off

The other important failure happens even earlier.

A malformed, forged, expired or replayed mandate is rejected by the deterministic verifier before a model call is made.

```text
                         ┌───────────────┐
                         │ Mandate check │
                         └───────┬───────┘
                                 │
                    ┌────────────┴────────────┐
                    │                         │
               invalid                    valid
                    │                         │
                    ▼                         ▼
                DECLINE                Evidence extraction
                                              │
                                              ▼
                                      Intent-cart engine
                                              │
                                  ┌───────────┴───────────┐
                                  │                       │
                              engine fails           valid diff
                                  │                       │
                                  ▼                       ▼
                               STEP_UP             Threshold policy
                                                          │
                                               ┌──────────┼──────────┐
                                               │          │          │
                                               ▼          ▼          ▼
                                            ALLOW      STEP_UP     DECLINE
                                               │
                                               ▼
                                           Razorpay
```

A model outage cannot become a successful payment.

This behaviour was also observed during evaluation: more than 400 cases across abandoned runs encountered model-backend failures from provider quotas, and every one escalated instead of being approved.

---

## Mandate Verifier

`verifyMandate(mandate, context)` in `lib/mandate` is pure, synchronous, deterministic, and never throws.

It checks, in order:

1. `malformed` — does the mandate parse?
2. `invalid_signature` — is it signed by the correct agent key?
3. `expired` — is it still within its validity window?
4. `replayed_nonce` — has its single-use nonce already been consumed?

Cart contents, categories and budget are deliberately **not** checked here. Those are semantic questions for the Intent-Cart Engine.

The mandate is signed using Ed25519 over a canonical payload containing its own fields, including principal, agent, category scope, spend cap, currency, expiry and nonce.

That binding matters. A signature copied from another valid mandate is still rejected because it does not verify against the substituted mandate's canonical payload.

The verifier receives its clock, public-key lookup and nonce ledger through its context. It does not reach into external state itself, which keeps the core verification logic deterministic and testable.

---

## Intent-Cart Consistency Engine

`computeAuthorizationDiff(evidence, client)` in `lib/ai` is the only model-backed stage.

The engine:

- receives only the evidence required for the judgement
- fences untrusted listing text in `<untrusted_listing_text>` tags
- treats listing text as data, never instructions
- uses forced tool use
- validates output against the `AuthorizationDiff` Zod schema
- retries once when the output is structurally invalid
- returns typed failures instead of inventing a result

The model is behind a narrow `DiffModelClient` interface. This keeps the engine independent of the provider.

Two adapters are included:

- `lib/ai/anthropic.ts`
- `lib/ai/openai-compatible.ts`

Provider selection is handled by `lib/ai/provider.ts`.

The backend is therefore an environment setting rather than a code change.

### Model privacy boundary

The model receives:

- authorized categories
- spend cap
- currency
- cart line names
- quantities
- prices
- listing ids
- untrusted listing text

The model does **not** receive:

- principal name or id
- mandate id
- purchase request id
- agent id
- mandate nonce
- mandate signature
- merchant account id

This is enforced at runtime by `lib/privacy/egress.ts`. If an identity value accidentally appears in the assembled prompt, the call is rejected before it leaves the machine. Because a failed engine results in `STEP_UP`, a privacy regression cannot silently become an approved purchase.

The cart contents themselves are necessarily sent to the model because judging the cart is the purpose of this stage. Bouncer does not claim anything about the provider's retention, jurisdiction, or handling of those contents.

---

## Persistence and cryptography

### Encryption at rest

Four fields are encrypted using AES-256-GCM with a fresh IV for every value:

- `Principal.displayName`
- `CartItem.name`
- `PurchaseRequest.sessionFreeText`
- `PurchaseRequest.sessionStructuredFields`

The ciphertext is also bound through AAD to its exact model, field and row id. Moving a ciphertext to another row therefore results in a decryption failure rather than silently authenticating the value in the wrong place.

Amounts, categories, timestamps, outcomes, ids, mandate signatures and the audit chain remain unencrypted by design.

`BOUNCER_ENCRYPTION_KEY` is required. Bouncer does not silently fall back to plaintext.

Generate one with:

```bash
npm run privacy:keygen
```

### Audit chain

Every decision step is appended to a SHA-256 hash chain over canonical JSON.

Each event contains the hash of its predecessor. Verification is recomputed when the chain is read rather than trusting a stored "valid" flag.

This makes the log **tamper-evident**, not tamper-proof. Someone with database write access could rewrite every subsequent link. A production deployment would need an external anchor for stronger guarantees.

### Credential material

Full signatures, nonces, key references and merchant account ids are not embedded in the HTML or React payload. The UI exposes truncated values and retrieves a full value only through an explicit reveal endpoint.

This is exposure reduction, not access control.

The demo deployment is intentionally unauthenticated, so anyone who can reach the console can reach the reveal endpoint. A real deployment would need authentication, authorization and a reveal audit log.

---

## Measured results

The numbers below are deliberately reported with their limitations. They are measurements of this implementation and these datasets, not claims of general AI accuracy.

### Decision quality — `npm run eval`

21 labelled cases through the real pipeline:

| Metric | Result |
| --- | ---: |
| Precision | 100.0% |
| Recall | 92.9% |
| False allows | **0** |
| False declines | **0** |
| Deferred to a human | 1 of 19 scored |
| Step-up rate | 14.3% |
| Decline rate | 61.9% |
| Mean latency | 10.5 s |
| p95 latency | 19.8 s |
| Credential-only cases declined without a model | 4/4, under 2 ms |

Two ambiguous cases were excluded from precision and recall by design.

The single recall miss was `budget_02_just_over`: the system stepped up instead of declining. A human therefore still had to approve it; it did not become an unauthorized automatic approval.

---

## Credential path at scale

The deterministic credential path was tested with 100,000 generated credentials across eight adversarial families, seed `20260829`.

| Metric | Result |
| --- | ---: |
| Cases | 100,000 |
| False accepts | **0** |
| False rejects | **0** |
| Model calls | **0** |
| Throughput | **7,487 decisions/sec** |
| Per decision | **134 µs** |

The result demonstrates correctness and throughput for the tested credential families. It is not an "AI accuracy" claim. Ed25519 verification is deterministic.

### Benchmark self-test

The benchmark includes a negative control because a clean benchmark is only useful if the harness can detect a broken verifier.

Run:

```bash
npm run eval:credentials -- 100000 --self-test
```

The self-test injects an artificial always-valid bug and requires the benchmark to catch it.

An earlier version of the benchmark reported roughly 491,000 verifications/sec while every verification was actually failing early. The benchmark looked much faster because it was measuring rejection rather than successful verification.

The current harness includes the negative control specifically to prevent that kind of false confidence.

---

## Semantic path — 46 boundary cases

The model-in-loop evaluation used 46 deliberately difficult cases, with 43 scored and 3 ambiguous.

| Metric | Result |
| --- | ---: |
| True blocks | 22/26 |
| True allows | 17/17 |
| False allows | **0** |
| False declines | **0** |
| Deferred to a human | 4 |
| Precision | 100.0% |
| Recall | 84.6% |

The only disagreements were in the `over_cap_by_one_rupee` family.

Four cases were expected to block but stepped up instead. The model treated a one-rupee overrun as medium severity rather than high severity, so the deterministic policy escalated it.

That behaviour is consistent across the tested providers and, importantly, never resolves the boundary case toward automatic approval.

The dataset is 46 cases rather than the larger planned set because two model providers hit daily quotas during the measurement. The honest number is therefore the measured number.

---

## Injection resistance

The first injection experiment produced a result that was not useful.

The poisoned text lived in the product description, while the catalogue browsing endpoint returned only basic listing information. The agent could buy the cheapest product without ever opening its product page.

So the initial `0 of 7` exposure result did **not** demonstrate injection resistance. It demonstrated that the agent did not encounter the injected text.

The delivery path was then changed:

1. `add_to_cart` requires a prior `view_listing` of the same item.
2. The poisoned listing was repriced from ₹3,899 to ₹2,999 so it became the cheapest running shoe.

The injection text, agent system prompt and agent freedom to comply were intentionally left unchanged.

After that change:

| | Result |
| --- | ---: |
| Exposure | 3 of 4 runs |
| Followed the injection after exposure | 0 of 3 |

The sample is too small to claim a meaningful resistance rate. It is reported because the measurement itself is important: Bouncer's safety claim does not depend on the agent resisting the attack.

Even if the agent follows the malicious instruction, the resulting cart still has to pass the mandate and policy checks.

---

## Razorpay integration

Bouncer uses the Razorpay Orders API in **TEST MODE**.

The following properties are verified:

| Claim | Status |
| --- | --- |
| Webhook signature verification | **Verified** |
| Live-mode keys refused | **Verified** |
| Idempotency | **Verified** |
| SDK/auth/minor units/receipt against test API | **Verified** |
| Real test order exists in dashboard | **Verified** |
| No payment captured | **Verified** |
| ALLOW -> live test order end to end | **Not yet verified** |
| Actual Razorpay webhook delivery | **Not yet verified** |

The direct Razorpay verification command is:

```bash
npm run razorpay:verify
```

It requires an `rzp_test_` key, creates a deliberately unusual test amount, and reports what it did and did not prove.

Bouncer refuses to use a live-mode key.

### Important limitation

Bouncer creates an order. It does **not** capture a payment.

Nothing is captured unless a human completes a payment manually in the Razorpay test environment.

---

## Known instability

The model's clause severity is not perfectly stable across identical input.

One seeded commercial-blender case was run four times against the same model:

| Run | Confidence | Severity | Outcome |
| --- | ---: | --- | --- |
| 1 | 0.86 | high | DECLINE |
| 2 | 0.82 | high | DECLINE |
| 3 | 0.85 | medium + low | STEP_UP |
| 4 | 0.85 | high | DECLINE |

Confidence remained close, while severity changed. Since the policy declines on any high-severity clause, that label can change the final outcome.

This is exactly why the model is not allowed to make the final decision.

Other practical limitations:

- `gpt-oss-120b` initially returned prose instead of using the required tool in 3 of 5 early agent runs. The agent loop now nudges once before giving up.
- Incomplete agent runs are excluded from resistance denominators rather than counted as successful resistance.
- Free-tier provider limits can make evaluation slow. A batch of 10 agent runs can take 15–30 minutes.

---

## What is real and what is simulated

### Real

| Component | What is actually implemented |
| --- | --- |
| Ed25519 mandate signing and verification | Real keypairs and real signatures over a canonical payload |
| Nonce replay protection | SQLite-backed single-use nonce ledger |
| Intent-Cart Engine | Real model API calls, forced tool use and schema validation |
| Threshold policy | Deterministic pure function |
| Audit chain | SHA-256 hash chain with verification |
| Human step-up | Database-backed approve/reject state |
| Razorpay Orders API | Official SDK against the test environment |
| Razorpay webhook verification | HMAC-SHA256 over the raw request body |
| Demo agent | Live model-driven agent using the real pipeline |

### Simulated by design

| Component | Why |
| --- | --- |
| Storefront catalogue | 15 hardcoded listings stand in for the outside merchant world |
| Poisoned listing | Deliberate fixture for security testing |
| Agent traffic | Generated by the demo agent and seeded scenarios |
| Principals and agent operators | Fictional identities and local key references |
| KMS / identity provider | Not connected in this demo |
| Evaluation cost model | Illustrative assumptions, not Razorpay data |

---

## Explicit limitations

This project is a working buildathon prototype, not a production payment-security product.

- No payment is captured by Bouncer.
- No live-mode Razorpay key is supported.
- The console and APIs are unauthenticated.
- `POST /api/step-up/{id}` can be called by anyone who can reach the deployment.
- Rate limiting is in-memory and single-instance.
- The audit chain is tamper-evident, not tamper-proof.
- There is no production KMS, key rotation system or external audit anchor.
- There is no identity provider.
- The model provider receives cart data and listing text; Bouncer does not claim anything about provider-side retention or jurisdiction.
- The semantic evaluation set is small.
- Model severity can vary across identical runs.
- The injection experiment has a very small sample size.
- The measured metrics should not be interpreted as general-purpose fraud-detection accuracy.

---

## Running it

Requires **Node 20+** and npm.

```bash
npm install
cp .env.example .env
# Windows:
# copy .env.example .env

npm run db:setup
npm run dev
```

Then open:

```text
http://localhost:3000
```

`npm run db:setup` is the main setup command. It:

1. generates the Prisma client
2. applies the database migrations
3. seeds the reference data

### Configure a model backend

#### Option A — Anthropic

```bash
ANTHROPIC_API_KEY="sk-ant-..."
```

#### Option B — OpenAI-compatible provider

For example:

```bash
BOUNCER_ENGINE_PRESET="groq"
BOUNCER_ENGINE_API_KEY="gsk_..."
```

Supported presets depend on the provider adapter configuration.

Without a working model backend, Bouncer does not invent a reasoned diff. Model-dependent scenarios remain clearly marked as placeholders or escalate rather than pretending that an AI judgement exists.

---

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm run db:setup` | Generate Prisma client, migrate and seed |
| `npm run db:reset` | Rebuild SQLite database from scratch |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:seed` | Re-seed reference data |
| `npm test` | Run the Vitest suite |
| `npm run engine:check` | Make a real model call against seeded scenarios |
| `npm run typecheck` | Run TypeScript checks |
| `npm run lint` | Run ESLint |
| `npm run build` | Build the production application |
| `npm run privacy:keygen` | Generate an AES-256 encryption key |
| `npm run privacy:audit` | Check tracked files for secret and repository-hygiene issues |
| `npm run eval` | Run the labelled decision evaluation |
| `npm run eval:credentials` | Run the credential benchmark |
| `npm run eval:semantic` | Run the semantic boundary-case evaluation |
| `npm run razorpay:verify` | Verify the Razorpay TEST-mode integration |

---

## Database reset warning

Stop `npm run dev` before running:

```bash
npm run db:reset
```

The command deletes `prisma/dev.db`.

On Windows, a running server can hold the database open and prevent deletion.

On Linux and macOS, the operating system can allow the running process to keep using the deleted database inode while a new database is created. That can leave the application serving stale data and make freshly seeded mandates appear invalid.

The safe sequence is:

```text
stop dev server
      ↓
npm run db:reset
      ↓
npm run dev
```

The lock-detection behaviour is covered by `lib/db-reset.test.ts`.

---

## Why `db:migrate` exists

`prisma/migrate.ts` applies the SQL migrations using the better-sqlite3 driver and records them in `_prisma_migrations` using Prisma's migration format.

It exists because the original build environment could not reach `binaries.prisma.sh` to download Prisma's native schema engine.

On a normal machine with unrestricted network access, `npx prisma migrate dev` can be used to create new migrations.

---

## Repository layout

```text
app/
  page.tsx                         overview and live counts
  requests/                        purchase attempts and walkthrough
  approvals/                       step-up approval screen
  evidence/                        measured results
  privacy/                         privacy controls and limitations
  console/, inbox/                 compatibility redirects
  _components/                     shared UI components

lib/
  db.ts                            Prisma + SQLite
  format.ts                        money and timestamp formatting
  scenarios.ts                     validated scenario reads
  scenario-label.ts                human-readable labels
  evidence.ts                      measured evidence
  mandate/                         signing and verification
  extraction/                      evidence and injection scanning
  ai/                              Intent-Cart Engine and model adapters
  policy/                          deterministic threshold policy
  pipeline/                        orchestration and persistence
  audit/                           SHA-256 audit chain
  privacy/                         egress controls and encryption
  razorpay/                        orders and webhook verification
  agent/                           demo agent
  catalog/                         simulated storefront

schemas/                            Zod domain schemas

prisma/
  schema.prisma                    database model
  migrations/                      SQL migrations
  migrate.ts                       engine-free migration runner
  seed.ts                           reference scenarios

eval/                               labelled datasets and evaluation harness
DEMO.md                             live demo / recording script
docs/technical-reference.html       detailed architecture and measurement document
```

---

## Documents

### `DEMO.md`

The recording script for the project demo, including:

- timed scenes
- what to click
- what to show
- likely judge questions
- honest answers about limitations

### `docs/technical-reference.html`

The deeper technical reference covering:

- architecture
- trust boundaries
- fail-closed decision flow
- mandate verification
- privacy architecture
- cryptography
- Razorpay integration
- evaluation methodology
- measured results
- limitations and non-claims

If you want the detailed engineering reasoning behind Bouncer, this is the document to read alongside the source code.

---

## Privacy and data handling

There is no real person's data in this deployment. Principals, carts and merchant ids are fictional and seeded, and Razorpay is used in test mode.

The privacy controls are therefore engineering for the system Bouncer would need before handling real information.

### Identity separation

The model receives the shopping information required to judge the cart but not the identity of the person behind it.

Runtime egress checks make this an enforced property rather than a prompt-writing convention.

### Encryption

Sensitive text fields are encrypted at rest with AES-256-GCM.

The encryption key is mandatory. If the key is missing, Bouncer refuses to run rather than silently storing plaintext.

### Credential exposure

Sensitive credential values are redacted from the rendered application and revealed only through an explicit server endpoint.

Again, this is not authentication. A production deployment must put real authorization in front of the application.

---

## Design conventions

### Money

Money is stored as integer minor units (paise).

No floating-point arithmetic is used for monetary amounts in the domain model. Formatting such as `₹4,499.00` happens at the UI edge.

### Schema validation

Rows read from SQLite are revalidated against the Zod domain schemas.

The goal is to make persistence/schema drift fail loudly rather than silently rendering incorrect data.

### Decision colours

Green, amber and red are reserved for decision outcomes.

Decorative UI colours are intentionally kept separate from verdict colours so the meaning of a status cannot be confused with visual decoration.

Every outcome is represented using a glyph, colour and text rather than colour alone.

### Typography

The UI uses:

- Space Grotesk for display and interface text
- IBM Plex Mono for identifiers, hashes, amounts and timestamps

Both are self-hosted through `@fontsource`.

---

## Tech stack

- Next.js 16 / App Router
- TypeScript / strict mode
- Tailwind CSS v4
- Prisma 7
- SQLite
- better-sqlite3
- Zod
- Vitest
- Ed25519 via `node:crypto`
- AES-256-GCM
- SHA-256
- Razorpay Orders API
- Anthropic and OpenAI-compatible model adapters

There is no authentication library, component library or state-management library in the current build.

---

## The short version

Bouncer is built around one idea:

**AI can recommend. AI can reason. AI cannot grant itself permission to spend.**

The human's signed mandate defines the authority.

Deterministic verification establishes whether that authority is authentic.

The model helps interpret whether the cart matches it.

Deterministic policy decides what the model's evidence means.

A human handles ambiguity.

Only `ALLOW` reaches Razorpay.

And if anything goes wrong along the way, the system fails closed.
