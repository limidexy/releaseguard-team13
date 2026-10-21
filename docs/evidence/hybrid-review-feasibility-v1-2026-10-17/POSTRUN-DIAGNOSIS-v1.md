# Hybrid semantic reviewer — post-run diagnosis

**Status: `REAL_REVIEW_FEASIBILITY_FAILED`**

This run proved that the real Groq connection and one-shot execution path work. It did not prove that `openai/gpt-oss-120b` is a usable semantic reviewer under the frozen protocol.

## Actual run

- Groq account observed before execution: Free, $0, Current Plan.
- Frozen reviewer: `openai/gpt-oss-120b`.
- Frozen project-reference samples: 10 clearly correct and 10 clearly violating.
- Semantic-review requests: exactly 20.
- Customer-answer generation: 0.
- Automatic retries, fallback models and provider switches: 0.
- Deployment, publication and Git push: none.

## What happened

| Outcome | Count |
|---|---:|
| HTTP response parsed into the expected top-level payload schema | 3 |
| Model payload failed schema validation | 16 |
| Provider returned HTTP 429 | 1 |
| Review passed the complete schema, evidence and provenance validator | **0** |

The fail-closed delivery view blocked all 20 samples. That produces 0 false allows but also blocks all 10 correct answers. The 10 violating answers were blocked because their reviews were invalid or unavailable, not because a valid semantic judgment established the violation. They must not be reported as a 100% semantic violation-block rate.

Under the strict semantic-accuracy view, **0 correct and 0 violating samples were evaluable**, so accuracy is unavailable rather than 50% or 100%.

## Failure causes

1. Sixteen model outputs violated the result schema. Across their recorded schema diagnostics there were 119 invalid evidence source/path issues, two observations returned as strings instead of objects, and 18 wrong observation-shape issues.
2. The three parseable reviews still failed final validation because required rules marked `passed` did not include verifiable quotations and offsets.
3. One of those three also appeared to make a genuine semantic error: it marked `HUMAN_REVIEW_REQUIRED` failed even though the answer said the requested action meant human review was necessary. Because the review failed evidence validation, this is a post-run observation, not a valid scored judgment.
4. One request received HTTP 429. The preceding retained header showed only 324 tokens remaining and a token reset of about 57.57 seconds, so the frozen 30-second spacing was not conservative enough for this larger review payload. The request was not retried.

## Evidence limitation discovered

The frozen implementation preserved exact raw reviewer text for the three parseable results. For sixteen schema-invalid results, it preserved schema issues and attempt records but discarded the raw reviewer text and request metadata. Those sixteen raw outputs are therefore **unavailable** and cannot be reconstructed or silently replaced.

After the experiment completed, the adapter was minimally hardened so future schema-invalid results retain raw text and provider metadata. This post-run code change did not alter the frozen results and did not trigger another request.

## Decision

Do not activate this reviewer, do not change historical 70/75 scores, and do not expand to the 220-request plan. A future run would require separate authorization and a newly frozen revision that:

- uses provider-enforced structured output where verified supported;
- preserves raw provider evidence before schema validation;
- gives a machine-checkable evidence example or simplifies evidence coordinates without weakening semantic duties;
- schedules requests from actual token-reset headers rather than a fixed 30-second interval;
- keeps the same no-retry and fail-closed controls.

No second run is authorized or performed here.
