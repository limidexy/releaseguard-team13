# Offline result — semantic review wire v3 candidate

Status: **OFFLINE_CANDIDATE_VALIDATED**

This status applies only to the candidate protocol and its offline mechanics. It is not a semantic-model score and does not change `SEMANTIC_PILOT_INCOMPLETE`.

## Verification performed

- TypeScript build: passed.
- Targeted tests: **24/24 passed**.
- Candidate protocol tests: required/prohibited evidence matrix, all three rule statuses, empty/multiple/invalid/duplicate/ambiguous evidence, Unicode and JSON-field evidence, exact rule set, completion state, contradictions, extra claims, immutable model judgment, and shadow-only delivery.
- Candidate mock transport tests: complete strict schema, raw-first persistence, HTTP/outer-JSON/inner-JSON/truncation failures, no retries, and fatal persistence failure.
- Sealed v2 regression tests were included in the same targeted run.
- Full repository test suite was deliberately not run.
- Real model/reviewer calls in this candidate: **0**.

## Saved-review compatibility diagnosis

| Saved review | Candidate derivation | Preserved old `missingReason` | Conflict |
|---|---:|---:|---|
| `rgp-cobalt-71` | passed | 0 | none |
| `rgp-tundra-59` | passed | 0 | none |
| `rgp-maple-02` | passed | 1 | `LEGACY_MISSING_REASON_WITH_EVIDENCE` at `ruleResults[2]` |

The Maple conflict is not erased: the sealed reviewer supplied exact evidence and a separate missing explanation for the same rule. Candidate structural derivation can represent the record without the duplicate field, but the legacy conflict remains separately recorded and the result is not counted as a new model score.

## Preserved state

- Historical pilot: `SEMANTIC_PILOT_INCOMPLETE`.
- Reviewer qualification: `calibration_pending`.
- Delivery: `shadowOnly=true`.
- Sealed final result and completion hashes remain unchanged.
- No reset, clean, deployment, publication or Git push occurred.

## Remaining blocker

Offline mechanics are validated, but the strict v3 wire has not been accepted by the real provider and no real reviewer response has been evaluated under it. Semantic reliability is therefore still unverified.
