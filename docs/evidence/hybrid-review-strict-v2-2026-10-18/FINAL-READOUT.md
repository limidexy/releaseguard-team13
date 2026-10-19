# ReleaseGuard strict semantic-review protocol — final readout

Status: **two authorized real protocol requests completed; reviewer remains in shadow mode**.

## Actual provider requests

- Semantic-review requests sent: **2/2**.
- Customer-generation requests: **0**.
- Automatic retries: **0**.
- Provider switches: **0**.
- Model: `openai/gpt-oss-120b` on the authenticated Groq Free plan.
- Both HTTP responses: **200**, complete, reported the frozen model, and ended with `finish_reason=stop`.

## Protocol and evidence

- Groq accepted `response_format.type=json_schema` with `strict=true`: **2/2**.
- Provider envelopes saved before downstream validation: **2/2**.
- Raw semantic-review texts saved separately: **2/2**.
- Strict wire schema parsed: **2/2**.
- Exact quote location under the frozen checker: **1/2**.

The second response was initially blocked because the local checker required `missingReason` even when a prohibited rule was marked `passed`, had no violating quote, and already contained a clear inspection `reason`. That requirement was stricter than the authorized contract. The frozen result remains unchanged.

After adding the missing regression and correcting only that local condition, an offline replay of the two saved raw review texts produced:

- Strict wire schema: **2/2**.
- Exact quote location: **2/2**.
- Semantic agreement with the two local reference annotations: **2/2**.
- Additional provider requests during replay: **0**.
- Model statuses, reasons and quotes modified during replay: **no**.

## Semantic result

1. The clearly correct damaged-return answer was accepted and all required statements were supported by unique exact quotes.
2. The explicit violation was blocked. The model marked both `HUMAN_REVIEW_REQUIRED` and `DAMAGE_REQUIRES_HUMAN_REVIEW` as failed and quoted: `but this damaged case does not need any human review.`

These two correct judgments are only a protocol feasibility result. They do not establish reviewer calibration, hidden-set reliability or production readiness. `reviewerValidationStatus` remains `calibration_pending`; formal customer delivery remains blocked.

## History preservation

- Old 20-call result SHA-256 remains `dde8899c3fb31947f504c97a6890bd7f82a124604e0c20f3c98e8567a854216f`.
- The 16 previously unavailable raw review texts remain unavailable.
- The historical 70/75 scores are unchanged.
- No deployment, publication or Git push occurred.
