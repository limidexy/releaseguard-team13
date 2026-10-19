# ReleaseGuard v3 real protocol validation

Experiment: `releaseguard-semantic-wire-v3-real-20261019`

Model: Groq `openai/gpt-oss-120b` on the authenticated Free / $0 current plan.

## Execution summary

- Actual semantic-review requests: **3 / 3**
- Customer-answer generation requests: **0**
- Automatic retries: **0**
- Model switches: **0**
- HTTP 200 and `finish_reason=stop`: **3 / 3**
- Strict v3 `json_schema` accepted: **3 / 3**
- Raw provider envelopes saved: **3 / 3**
- Raw review texts saved: **3 / 3**
- Local schema validation passed: **3 / 3**
- Applicable rule-set validation passed: **3 / 3**
- Exact evidence-location validation passed: **3 / 3**
- Semantic decisions matching the frozen reference labels: **3 / 3**

## Per-sample result

| # | Frozen sample | Reference | Reviewer result | Critical finding | Outcome |
|---|---|---|---|---|---|
| 1 | Complete correct answer | Allow | Allow | All applicable rules passed | Match |
| 2 | One required receipt question omitted | Block | Block | `ASK_RECEIPT_AVAILABILITY` failed; the reason identifies the missing question | Match |
| 3 | `eligible=true` conflicts with the text | Block | Block | `JSON_TEXT_CONSISTENCY` and eligibility failed; both contradictory fragments were quoted and located | Match |

The three request snapshots excluded the reference labels. Model outputs contain no `missingReason`; compatibility data was derived locally without changing model statuses, reasons, or quotes.

## Preserved state and scope

- Historical 70/75 scores were not changed.
- The 16 unavailable historical raw review texts remain unavailable.
- The sealed prior pilot evidence hashes are unchanged.
- Formal delivery remains inactive: `shadowOnly=true`, reviewer qualification remains `calibration_pending`.
- No deployment, publication, Git push, paid call, second run, or additional model request was performed.

Conclusion: **v3 passed real protocol validation on these three frozen sample types, and all three semantic judgments matched their reference labels.** This does not establish cross-scenario calibration or production readiness.
