# ReleaseGuard hybrid evaluation v1 — final offline report

**Final status: `HYBRID_INTEGRATION_READY_CALIBRATION_PENDING`**

**Preserved evaluator-next status: `EVALUATOR_NOT_READY`**

Date: 2026-10-17  
Scope: offline integration and control verification only  
Formal runtime: unchanged

## 1. Outcome

A new parallel `hybrid-evaluation-v1` candidate now evaluates an immutable saved answer through deterministic checks, a pluggable independent semantic-review result, provenance and evidence validation, and deterministic aggregation. It is shadow-only and is not imported by the formal worker.

The integration and control tests pass. No real semantic reviewer or verified human review has been calibrated, so this result does not establish reviewer accuracy, improved model quality or production readiness. The older `evaluator-next-v1` unseen holdout still fails with 34 false blocks and 6 false allows; its `EVALUATOR_NOT_READY` status remains unchanged.

## 2. Files changed in this work

| File | Responsibility |
|---|---|
| `src/hybrid-evaluation-v1.ts` | Versioned input/result schemas, canonical hashes, contract-derived semantic rule set, deterministic checks, evidence/provenance validation and mechanical candidate aggregation. |
| `src/semantic-review-sources-v1.ts` | Trusted/untrusted request separation, project-reference and verified-human import paths, disabled-by-default model adapter, independent authorization and budget, persistent attempt ledger, no-retry error path and exact-bound cache. |
| `tests/hybrid-evaluation-v1.test.ts` | Offline integration, failure-path, provenance, immutable-output, zero-call, retry, cache and historical-compatibility tests. |
| `docs/evidence/hybrid-evaluation-v1-2026-10-17/SEMANTIC-REVIEW-PROTOCOL-v1.md` | Review protocol, source meanings, evidence coordinates, trust boundaries, deterministic aggregation and current limitations. |
| `docs/evidence/hybrid-evaluation-v1-2026-10-17/CALIBRATION-PLAN-v1.md` | A separate, not-authorized calibration design with sample lineage, reference-label requirements, metrics, freeze controls and a maximum staged budget. |
| `docs/evidence/hybrid-evaluation-v1-2026-10-17/VERIFICATION-LOG.md` | Commands, runtime, test separation, historical integrity and zero-call evidence. |
| `docs/evidence/hybrid-evaluation-v1-2026-10-17/MANIFEST.sha256` | SHA-256 integrity list for the new candidate and its evidence. |

No existing formal-runtime file was modified for hybrid activation.

## 3. Deterministic controls actually verified

The offline tests verify that the candidate:

1. binds the review to the exact case, run, response, policy, facts, deterministic decision, contract, original response and applicable rule set;
2. rejects missing/incomplete responses and provider failures;
3. enforces plain versus exact JSON format, rejects duplicate keys and checks `eligible` against the deterministic decision;
4. rejects missing, duplicate, unknown or inapplicable rule results;
5. verifies quoted evidence and UTF-16 offsets against the unchanged original response or named JSON field;
6. rejects incomplete, timed-out, truncated, invalid or mismatched reviews;
7. keeps project references, verified humans, models and mocks as different provenance types;
8. requires a separately trusted registry before a human or model can be qualified for delivery;
9. blocks on any critical failed/unverifiable rule, unresolved contradiction, unauthorized/unverifiable extra claim or unqualified reviewer;
10. returns `customerOutput=null` when blocked, and can return only the exact original answer when allowed;
11. defaults the judge adapter to disabled and records an attempt before any future request;
12. performs no automatic retry, fallback-provider switch or best-of selection;
13. prevents cache reuse when result-affecting input or configuration differs.

These checks establish control behavior, not the correctness of future semantic judgments.

## 4. Results that are mock-only

The following are integration fixtures only:

- a complete all-passed mock review;
- failed and unverifiable rule judgments;
- contradictions and extra claims;
- malformed, forged and truncated review results;
- a test-only trusted-human registry record;
- an in-process model transport stub;
- hostile text asking the reviewer to ignore policy or claim human provenance.

The mock reviewer remains `mock_only`, project labels remain `reference_only`, and the stubbed model remains `calibration_pending`. None can activate formal delivery or be counted as a real review accuracy result.

## 5. Formal path and historical evidence

The formal worker still imports and runs `evaluateControlledV17`. It does not import `hybrid-evaluation-v1`. The new result includes `shadowOnly=true` and records the historical path as unmodified and unchanged.

The frozen r4 file still hashes to:

`de31624111012d425ccb789e1fdd1a3d500a0916615ec4c3e4b51a404f259587`

The compatibility test reproduces, without overwriting:

| Arm | Historical v2.10 score | Historical final allowed |
|---|---:|---:|
| 20B | 70 | 5/20 |
| 120B | 75 | 1/20 |

These remain historical customer-model results. The hybrid candidate has not generated a new score for those 40 answers.

## 6. Verification results

Using Node.js v24.19.0:

- TypeScript build: pass;
- hybrid candidate integration: 13/13 pass;
- old and new regression tests excluding the deliberately failing evaluator-next unseen holdout: 748/748 pass;
- evaluator-next unseen holdout: still fails, with 34 false blocks and 6 false allows.

The failing holdout is preserved and reported separately. It was not deleted or folded into an “all tests passed” claim.

## 7. Real calls and external changes

- Customer-generation calls: **0**
- Semantic-review model calls: **0**
- Verified-human reviews: **0**
- Deployment or publication: **none**
- Git commit or push: **none**

The previous customer A/B authorization is not reused for semantic reviewing. `judgeEnabled` remains false by default.

## 8. Semantic abilities not yet verified

The current evidence does not establish that a real reviewer can reliably handle:

- arbitrary English paraphrases, long-distance negation, pronouns, quotation and conditional scope;
- generic policy statements versus case-specific conclusions;
- JSON fields that conflict semantically with visible prose;
- invented refunds, transfers, tickets, follow-up, channels, timelines or organizational abilities;
- receipt availability versus requests for receipt material;
- privacy, secret requests and unsupported data-handling claims;
- ambiguous interval anchors and numeric timing fidelity;
- prompt injection beyond the tested structural separation;
- repeatability, bias, latency, provider failures or production-scale behavior.

Schema-valid evidence proves only that the cited text exists at the stated location. It does not prove the semantic label is correct.

## 9. Authorization needed for calibration

The next step requires a new, explicit authorization that names:

- the semantic-review experiment ID and evidence directory;
- the provider and exact reviewer model candidates;
- permission to send the frozen evaluation fields to that provider;
- the maximum semantic-review request count;
- verified-free-only operation or a precise spending cap;
- the frozen samples, reference-label source, prompt, reviewer configuration, schemas, validation and aggregation versions;
- confirmation of zero customer-generation calls, no deployment/publication and no Git push.

The prepared plan proposes up to 220 separately authorized semantic-review requests across preflight, calibration, sealed validation and repeatability. That number is a plan ceiling, not an authorization. No call may begin until the user approves a concrete execution record and the cost/free condition is verified.

## 10. Final determination

The integration and control layer is ready for a separately authorized calibration experiment, but the semantic reviewer is not yet qualified. The candidate must remain shadow-only.

`HYBRID_INTEGRATION_READY_CALIBRATION_PENDING`

The previous handwritten semantic candidate remains:

`EVALUATOR_NOT_READY`

No evidence from this work supports claiming improved customer-model quality, reliable semantic review, new scores for the old r4 answers, production readiness or general natural-language understanding.
