# ReleaseGuard candidate evaluator v1 — final offline report

**Final status: `EVALUATOR_NOT_READY`**

Date: 2026-10-17  
Scope: offline evaluator development and validation only  
Formal runtime: unchanged

## 1. Executive conclusion

The candidate evaluator is not ready to replace any legacy scoring or delivery gate.

The development fixtures and the first independently authored fixture set now pass, but that first fixture set became development data after its initial failures were used to change the evaluator. A second independently authored fixture set was frozen after candidate revision r3 and then run once without tuning. On that unseen set, final decision agreement was only **40/80 (50%)**, including **34 false blocks** and **6 false allows**. This fails every predeclared zero-error acceptance condition.

The principal blocker is evaluator generalization across legitimate English paraphrases and previously unseen violation wording. The business contract and frozen r4 model outputs were not changed. No evidence supports calling the candidate validated, replacing the old gate, or starting another real-model experiment.

## 2. Integrity and scope controls

- Frozen r4 evidence: `docs/evidence/model-v17-ab-r4-2026-10-17/ab-real-v17-r4-final.json`
- Frozen r4 SHA-256: `de31624111012d425ccb789e1fdd1a3d500a0916615ec4c3e4b51a404f259587`
- The 40 r4 raw model answers were read but not modified.
- Provider inference calls in this work: **0**
- Judge-model calls in this work: **0**
- Deployment, publication and Git push: **none**
- Existing real-call authorization and safeguards: **unchanged and not bypassed**
- Historical scoring path and formal delivery gate: **unchanged**
- Candidate implementation path: separate files under `src/*-next-v1.ts`

The pre-holdout `OFFLINE-REPORT-v1.json` intentionally retains its intermediate `PENDING_HOLDOUT` status. This final report and `ACCEPTANCE-METRICS-v1.json` record the later holdout result and supersede that intermediate status for readiness decisions.

## 3. Frozen evaluation specification

The specification was written before implementation and is preserved in `EVALUATION-SPEC-v1.md`.

It defines:

1. Stable business rules: 30-day purchase-based policy, unused condition, receipt condition, damaged-item human review, privacy warnings, and no invented operations or organizational processes.
2. Three outcomes per critical rule: `passed`, `failed`, or `unverifiable`.
3. Evidence coordinates for plain text and flat exact-schema JSON.
4. Separation of generic policy statements, case-specific conclusions, customer actions, and claimed system actions.
5. Fixed acceptance thresholds: all correct references allowed, all required mutations blocked, no false allow, no false block, exact failure-reason agreement, and historical reproduction.

Specification SHA-256: `e3cc79d4282b1453ec90e92bdecf6f79bd8b15389ef2ff160b2faf8b3e5ce5e7`

## 4. Candidate architecture

The candidate uses one versioned semantic-evidence layer for both scoring inputs and final delivery checks:

1. Parse the response into plain-text or exact JSON evidence regions.
2. Split customer-visible prose into clauses while retaining source coordinates.
3. Extract bounded propositions for policy, case timing, item/receipt conditions, eligibility, review, customer contact, capability, privacy, data handling, external actions, refund execution and invented process claims.
4. Compare the propositions with the frozen deterministic contract.
5. Return per-rule `passed`, `failed` or `unverifiable`, then compute the final intersection.

This reduces contradictory duplicated checks, but it also creates a common-mode risk: if the semantic extractor misses an expression, both scoring and delivery can be wrong together. The unseen holdout demonstrates that this risk remains material.

Candidate r3 source hashes:

| File | SHA-256 |
|---|---|
| `src/semantic-evidence-next-v1.ts` | `34a27ef6c78441cc94fad4fe530ebc49ffe53b16a79e627bee7d263a94ef0399` |
| `src/evaluator-next-v1.ts` | `d724a987593d168651816e3335249b79a1a857b4d8427ae24478e247e37c8a1c` |
| `tests/evaluator-next-v1.test.ts` | `346e8240cb1aa507c5470499a47b97f575cd69a1cbfa0dec372bf6a000775819` |

## 5. Validation chronology

### 5.1 Development suite

- Complete references allowed: **40/40**
- Single-duty omissions blocked: **20/20**
- Appended contradictions blocked: **20/20**
- Plain and JSON paths are both covered.

### 5.2 First independently authored fixture set

Fixture SHA-256: `3606f7e2942e541490408c07d0d75161aa4c5559a7edb54d9e607d2a7ebdadd3`

The first run exposed failures. Those fixtures were then used to repair the candidate, so they ceased to be a holdout and are correctly labelled **converted-to-development**. Their final result was 80/80, but this is regression evidence only and is not independent validation.

### 5.3 Second independently authored unseen fixture set

Fixture SHA-256: `9488bb0b955f3fc4036a74009a863cd3f2881ec8d44269310cb8110b5de017bf`

The second set was authored from the frozen specification and test plan, not from the candidate implementation. Candidate revision r3 was frozen before the fixture file was read or executed. The set was run once and was not used to tune the candidate.

This is an independently authored project holdout, not a verified external human benchmark.

| Metric | Predeclared requirement | Unseen result | Decision |
|---|---:|---:|---|
| Correct-reference allow rate | 100% | 6/40 = **15%** | Fail |
| Mutation block rate | 100% | 34/40 = **85%** | Fail |
| Final-decision agreement | 100% | 40/80 = **50%** | Fail |
| False allows | 0 | **6** | Fail |
| False blocks | 0 | **34** | Fail |
| Failure-reason agreement | 100% | 32/48 = **66.67%** | Fail |
| Critical unverifiable on supported expressions | 0 | 0 reported | Inconclusive: unsupported phrases were often forced to pass/fail instead |

The failed test is preserved intentionally. A failing validation test is evidence that the candidate must not be activated.

## 6. Main failure families

### False blocks

The candidate overfit development wording for:

- purchase timing unknown versus generic policy timing;
- case-specific eligibility unknown;
- purchase-date and unused-status questions;
- human-review and customer-contact language;
- capability limitations;
- within-window and outside-window conclusions;
- damaged-item interval wording;
- normal paraphrases of the standard policy.

### False allows

The candidate missed previously unseen forms of:

- unauthorized retention or sharing claims;
- requests for receipt contents, identifiers or uploaded material;
- requests for secrets;
- third-party ticket or follow-up promises;
- claims that the assistant can change the decision or forward the case;
- ungrounded outside-window conclusions;
- refund entitlement, guarantee or execution claims.

The absence of `unverifiable` outcomes on the unseen set is not a strength. It shows that unsupported language was generally forced into a binary decision instead of being safely surfaced as unverified.

## 7. Frozen r4 replay and 40-answer diagnosis

Historical results were reproduced before candidate diagnostics:

| Arm | Model | Historical raw v2.10 | Historical final allowed | Candidate post-hoc allowed | Candidate agreement with project semantic reference |
|---|---|---:|---:|---:|---:|
| A | `openai/gpt-oss-20b` | 70 | 5/20 | 7/20 | 17/20 |
| B | `openai/gpt-oss-120b` | 75 | 1/20 | 6/20 | 17/20 |

Candidate post-hoc counts are **not** new model scores and are **not** evidence that either model improved. The raw responses, original scores and original final decisions remain unchanged. The candidate analysis merely diagnoses those same frozen answers under a different, still-unvalidated evaluator.

The detailed 40-record file is `R4-POSTHOC-DIAGNOSTICS-v1.json`. Each record contains the customer question, original answer, historical score and guards, project semantic reference annotation, candidate checks, agreement classification and provenance. The semantic annotations are project labels, not verified independent human-review records.

## 8. Migration decision

**No legacy check is approved for removal or replacement in the formal runtime.**

Some candidate components are promising in isolation, including duplicate JSON-key detection, exact JSON type checks, internal-enum blocking, separation of customer contact from claimed system handoff, and evidence coordinates. However, the candidate is a shared semantic layer, and its unseen-set errors make partial activation unsafe without separate rule-level validation.

The detailed mapping is in `MIGRATION-TABLE.md`. It should be treated as a future migration design, not an approved runtime change.

## 9. Constraints requiring human review or restricted output

Until a future evaluator is independently validated, these cases should remain blocked or routed to review:

- unsupported languages or novel English paraphrases outside the declared grammar;
- remote pronoun/coreference and long-distance negation;
- novel organizational channels, timelines, retention or data-sharing claims;
- refund entitlement versus generic policy explanation;
- numeric interval fidelity and unclear interval anchors;
- third-party action or capability claims with indirect subjects;
- compound policy exceptions not represented in the frozen contract;
- any critical proposition the evaluator marks `unverifiable`.

## 10. Readiness for the next real-model experiment

**Not ready.** Another real A/B run would measure models using an evaluator that failed its unseen validation and could therefore produce misleading rankings and delivery counts.

Before any real calls are authorized, the next evaluator revision should:

1. turn the current v2 holdout failures into an explicit development error taxonomy;
2. repair semantic coverage without changing the business policy or historical outputs;
3. freeze a new candidate revision;
4. obtain a new, independently authored unseen holdout that is not used for tuning;
5. meet the predeclared zero-error criteria or revise those criteria transparently before seeing the new holdout;
6. only then request separate authorization for a real-model experiment.

## 11. Reproducible offline commands

From the repository root:

```sh
npm run build

# Candidate development and converted-to-development regression suites
node --test \
  dist/tests/evaluator-next-v1.test.js \
  dist/tests/evaluator-next-v1-holdout.test.js

# Unseen holdout: expected to fail while status is EVALUATOR_NOT_READY
node --test dist/tests/evaluator-next-v1-holdout-v2.test.js

# Reproduce historical r4 results and generate the 40-answer diagnostics
node scripts/evaluator-next-v1-offline.mjs

# Recompute development/holdout acceptance metrics
node scripts/evaluator-next-v1-metrics.mjs

# Verify frozen r4 evidence
shasum -a 256 docs/evidence/model-v17-ab-r4-2026-10-17/ab-real-v17-r4-final.json
```

Verified outcomes in this work:

- TypeScript build: pass
- Existing and candidate tests excluding the deliberately failing unseen holdout: **735/735 pass**
- Unseen holdout validation: fail, as detailed above
- Frozen r4 SHA-256: exact match
- Historical r4 reproduction: exact match (20B 70 and 5/20; 120B 75 and 1/20)

## 12. Delivered artifacts

- Frozen specification: `EVALUATION-SPEC-v1.md`
- Candidate semantic layer: `src/semantic-evidence-next-v1.ts`
- Candidate evaluator: `src/evaluator-next-v1.ts`
- Development tests: `tests/evaluator-next-v1.test.ts`
- Converted-to-development fixture suite and runner: `tests/evaluator-next-v1-holdout-fixtures.json`, `tests/evaluator-next-v1-holdout.test.ts`
- Unseen holdout fixture suite and runner: `tests/evaluator-next-v1-holdout-v2-fixtures.json`, `tests/evaluator-next-v1-holdout-v2.test.ts`
- Historical replay and 40-answer diagnosis generator: `scripts/evaluator-next-v1-offline.mjs`
- Acceptance metrics generator: `scripts/evaluator-next-v1-metrics.mjs`
- 40-answer diagnosis: `R4-POSTHOC-DIAGNOSTICS-v1.json`
- Acceptance metrics: `ACCEPTANCE-METRICS-v1.json`
- Verification commands and results: `VERIFICATION-LOG.md`
- Legacy migration map: `MIGRATION-TABLE.md`
- Candidate freeze manifests: `candidate-freeze-v1.sha256`, `candidate-freeze-r2.sha256`, `candidate-freeze-r3.sha256`
- Final integrity manifest: `MANIFEST.sha256`

## 13. Diff summary

This work only adds a parallel candidate evaluator, its tests, offline replay/metrics scripts and evidence documents. It does not edit the legacy evaluator, provider authorization, model configuration, r4 evidence, deployment files or Git history. No remote state was changed.
