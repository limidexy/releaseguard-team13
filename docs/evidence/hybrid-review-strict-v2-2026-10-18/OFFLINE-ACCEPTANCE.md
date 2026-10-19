# Strict semantic-review transport v2 — offline acceptance

Date: 2026-10-18

## In-scope result

- Build: passed.
- Current regression suite excluding the separately tracked legacy evaluator-next v2 holdout: **758/758 passed**.
- Strict transport and evidence tests: passed.
- Request body uses `response_format.type=json_schema`, `strict=true`, a complete wire schema, required fields and `additionalProperties=false` on every object.
- Exact quote lookup covers plain text, decoded JSON fields, Unicode, JSON escaping, multiple fragments, no match and ambiguous repeated matches.
- Missing, duplicate and unknown rules are rejected.
- A model's wrong semantic status is preserved; the program does not rewrite it into a correct status.
- Provider envelopes are persisted before JSON parsing, schema, finish-reason, model-ID and evidence validation. Non-2xx, malformed JSON, truncation, model mismatch, partial reads and persistence failure are covered.
- An uncalibrated reviewer remains `calibration_pending`; formal customer delivery remains blocked.

## Separately tracked historical evaluator status

The two pre-existing holdout files were rerun separately: **1/2 passed**. The known `evaluator-next-v1-holdout-v2` test remains failed. It evaluates the older regex candidate and is not changed or relabelled by this transport-only task. This known historical failure does not prove or disprove the strict transport protocol and remains preserved as an unresolved evaluator issue.

## Gate decision

The transport-specific offline gate is passed. The real protocol test may proceed only under the separately recorded two-request authorization and fresh authenticated Free-plan evidence. A failure of the first real request at HTTP, completeness, strict schema or exact evidence localization must stop the experiment before request two.
