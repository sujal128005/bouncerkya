# eval

A labelled dataset and a runner that replays every case through the **real,
full pipeline** — the same `evaluatePurchaseRequest` the console and the live
agent use. There is no evaluation-only code path, no per-case special handling,
and no stubbed policy.

```bash
npm run eval              # measure (needs a model backend in .env)
npm run eval -- --stub    # plumbing check only; prints no metrics
```

The run writes nothing to the database. The pipeline's evaluation stage is
pure, so the whole thing happens in memory and can be repeated freely.

## Labels

| Label | Meaning |
| --- | --- |
| `allow` | Plainly inside the mandate. Blocking it is a false decline and costs a sale. |
| `block` | Plainly outside the mandate. Allowing it is a false allow and costs money. |
| `step_up` | Genuinely arguable. A human should decide. |

`step_up`-labelled cases are **excluded from precision and recall** and
reported separately. Scoring them would be scoring our own opinion about a
case we deliberately built to be contested.

A STEP_UP *outcome* on an `allow` or `block` case is likewise not counted as
right or wrong — it is reported as the step-up rate. A request handed to a
human has not been got wrong; it has been deferred, and deferral has a
different cost from a mistake.

## Cost model

The cost figure is **illustrative**. The unit costs are assumptions written
into `eval/run.ts`, not Razorpay figures and not measured from anything:

```
Cost = false_declines × INR 450    (margin lost on a declined legitimate order)
     + false_allows   × INR 8,000  (chargeback + goods + handling)
```

They exist to show the shape of the trade-off — that a false allow costs
roughly eighteen times a false decline, which is why the policy leans toward
escalation. Replace them with real numbers before quoting any total.

## Variance

The Intent-Cart Engine is a language model. Identical inputs do not guarantee
identical diffs, and we have already observed clause severity moving between
runs on the same case. Run the harness more than once before quoting a number,
and quote a range rather than a point estimate.
