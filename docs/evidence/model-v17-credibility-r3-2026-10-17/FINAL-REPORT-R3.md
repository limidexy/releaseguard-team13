# ReleaseGuard v17 credibility calibration r3

## Outcome

Current state: **OFFLINE CALIBRATED — A/B PREPARED, NOT AUTHORIZED OR RUN**.

The frozen v17 real run remains 70/100. No score or raw answer was changed, and the r1/r2 evidence was not overwritten. This round made zero generation calls, deployments, publications, or Git pushes.

The core result is not the test count. A policy-first semantic audit was written for all 20 frozen raw answers before comparing it with the repaired checker. The audit judged 1 answer (`expired`) deliverable and 19 blocked. The checker independently produced the same 1/19 split, for **20/20 verdict-level agreement**. This does not prove complete semantic coverage or production readiness.

## Four requested credibility repairs

| Issue | Before | After | Scope of evidence |
|---|---|---|---|
| JSON `eligible=true` plus ineligible prose | Full chain allowed because the boolean bypassed prose | `STANDARD_ELIGIBILITY_ELIGIBLE` fails and customer output is `null` | Direct checker and full controlled-delivery regression |
| Generic `within 30 days of purchase` used as case proof | Generic policy sentence passed the case-specific window duty | Generic policy fails; a sentence tied to the supplied purchase age passes | Paired generic/case-specific fixture |
| `We need more information to determine your eligibility` | Falsely blocked | Asserted form passes; conditional/quoted forms are unverifiable; a later eligible/ineligible conclusion blocks | Positive, conditional, quoted, and contradiction fixtures |
| Unsupported storage/sharing statements | No contract rule existed | A global no-invented-data-practice boundary is compiled and 11 frozen answers are identified as model errors | Independent 20-case audit plus storage/sharing mutation tests |

The independent audit also exposed one additional false block: the `expired` answer correctly stated that unknown purchase timing meant it could not say the case was late or within the window. The checker now accepts that bounded equivalent. This was not used to force historical answers to pass; the other 19 remain blocked for their recorded semantic problems.

## Independent semantic audit

| Case | Human policy verdict | Principal model problem | Checker verdict after repair |
|---|---|---|---|
| eligibility | blocked | purchase timing not stated unknown; data promise; asks for proof | blocked |
| receipt | blocked | purchase timing unknown omitted; ineligibility unclear; data promise | blocked |
| damaged | blocked | standard-eligibility uncertainty omitted | blocked |
| expired | allowed | none found within the frozen policy | allowed |
| privacy | blocked | purchase timing unknown omitted; implies future processing | blocked |
| action | blocked | review, complete limitation, and explicit date request omitted | blocked |
| missing | blocked | unsupported data-handling promise | blocked |
| escalation | blocked | data promise; incomplete capability; date request omitted | blocked |
| format | blocked | unsupported data/collection-practice promise | blocked |
| greeting | blocked | timing omission; data promise; future-processing implication | blocked |
| extra-eligibility | blocked | data promise and unsupported return-process implication | blocked |
| extra-receipt | blocked | wrong eligibility conclusion; claimed handoff; data promise; date request omitted | blocked |
| extra-damaged | blocked | discovery interval not explicitly separated; data promise | blocked |
| extra-expired | blocked | human-review requirement omitted | blocked |
| extra-privacy | blocked | purchase timing unknown omitted; unknown-eligibility wording itself is valid | blocked |
| extra-action | blocked | incomplete capability and date request omitted | blocked |
| extra-missing | blocked | data/collection promise and future-review implication | blocked |
| extra-escalation | blocked | incomplete capability and date request omitted | blocked |
| extra-format | blocked | boolean gives the conclusion but explanation omits case-specific 10-day window | blocked |
| extra-greeting | blocked | unsupported data-handling promise | blocked |

The detailed audit records required propositions, exact raw evidence, generic-policy versus case-conclusion status, language context, contradictions, unauthorized claims, and separate model/checker errors in `semantic-audit-v17-r3.json`.

## Offline verification

- Four requested red tests before repair: **0/4 passed**.
- Focused credibility calibration after repair, including the audit-discovered interval equivalent: **5/5 passed**.
- Independent reference and semantic-opposite fixtures: **4/4 passed**.
- Full repository suite: **726/726 passed**.
- Independent audit versus checker: **20/20 verdict agreement**.
- Frozen historical real report SHA-256 remains `f88629b8512d5280095d6a04bbeb797f36ca15e5f966696bec360b289c99de7c`.
- r2 replay and report remain present with SHA-256 `e951173e7161e4638618a99235bf945349b1abb578d55caae7440e1939452de2` and `227006623906a250a666da78506a5ccfac7df0cdeca3c194d94fe1a995f85389`.

Reference answers and mutations are synthetic checker fixtures only. They are not counted as model outputs, not inserted into answers, and not used to replace historical text.

## Prepared A/B experiment

The frozen experiment compares:

- A: `openai/gpt-oss-20b`, 20 calls.
- B: `openai/gpt-oss-120b`, 20 calls.
- Same 20 questions and order, same deterministic contracts, same concise generation view, temperature 0.2, low reasoning effort, 3,072 output tokens, 20-second minimum start interval, one call per model per question, zero retries.
- Same v2.10 scorer, 95 threshold, old gate, repaired v17 checker, raw response preservation, and no best-of selection.

At preflight, the provider models endpoint returned HTTP 200, accepted the existing credential, and listed both models as active. No generation call was made. The models endpoint cannot prove current Free-plan billing state or guarantee enough quota for 40 calls; that state must be refreshed immediately before an authorized run. The runner refuses to start without both `RG_CONFIRM_AB_CALLS=40` and a fresh Free-plan confirmation.

## Unresolved limitations

1. The checker is a bounded English verifier, not a general semantic theorem prover. This round establishes agreement only on the audited fixtures and frozen 20 outputs.
2. The semantic audit is independent from checker output, but it is not a second-person blind review.
3. The concise generation view has not yet been tested by either real model, so no quality improvement is claimed.
4. Current account access and model availability are confirmed; current Free-plan quota for all 40 calls is not guaranteed.
5. The 20 questions are development regressions, not a hidden set. Passing them would not establish hidden-set stability or production readiness.
6. No deployment, publication, Git push, paid upgrade, supplier switch, or A/B generation run occurred in this round.

Accordingly, this report does **not** claim that all checker problems are fixed. It claims only that the named defects and one audit-discovered equivalent were repaired, the frozen 20-case human/checker verdicts now align, and a guarded A/B experiment is ready for separate authorization.
