# ReleaseGuard repair timeline and evidence boundaries

Prepared 19 October 2026. This is an evidence-backed account of completed experiments and limitations, not a claim that all candidates passed.

| Stage | Root issue / change | Observed outcome | Interpretation |
|---|---|---|---|
| v15/v16 | Unknown purchase timing omitted or inferred from a bare interval | Frozen original scores and delivery failures retained | Correct one output defect without rewriting history |
| v17 contracts | Explicit mustState/mustAsk/mustNotClaim and independent output checks | Several phrase/negation/extra-claim errors discovered in checkers | Contract existence does not prove output compliance |
| r4 A/B | 20B versus 120B, same fixed customer questions | Raw v2.10 70/75; final intersections 5/20 and 1/20 | Real generation errors and checker errors coexist; no production choice validated |
| Handwritten evaluator-next | Bounded semantic propositions | Unseen set: 6/40 correct allows, 34/40 violation blocks | Rejected candidate remains EVALUATOR_NOT_READY |
| Hybrid | Separate deterministic checks, semantic review, source validation and aggregation | Mock integration only at first | Integration is not reviewer accuracy |
| First real reviewer feasibility | JSON mode and model-generated evidence coordinates | 0/20 complete protocol-valid reviews; 16 raw texts unavailable | Historical missing evidence cannot be reconstructed or replaced |
| strict wire v2 | Provider schema plus programmatic quote location | Small successes; later pilot stopped at 3/20 on evidence/missingReason conflict | Protocol failures are not semantic-success credit |
| wire v3 | Model returns ruleId/status/reason/evidence; no redundant missingReason | Offline compatibility keeps legacy conflicts visible | Mechanical coordinates and metadata do not alter model judgment |
| v3 real protocol | Correct answer, omission, JSON contradiction | 3/3 protocol and reference matches | Three fixed types only |
| v3 cross-scenario development | Remaining 17 samples in a separate experiment | 17/17 valid; 9/9 correct allowed; 8/8 violations and key reasons identified | Development validation passed; not a merged 20/20 experiment or production calibration |

Current reviewer state is `shadowOnly=true`, `calibration_pending`. The formal Worker remains on the original `evaluateControlledV17` path. The old pilot stays `SEMANTIC_PILOT_INCOMPLETE`; this does not negate the later separately versioned v3 results.

## What changed in responsibility

The model decides semantic meaning and quotes exact evidence. The program validates schemas, input bindings, exact quote locations, provenance, completeness and final policy conditions. Neither model output nor historical customer text is repaired after generation. Unavailable evidence remains unavailable.

## Test result discipline

The handoff's fresh `npm test` result is 776/777 with the older rejected evaluator holdout still failing. It is not an all-green release pipeline. The new semantic reviewer does not turn that historical evaluator into a validated component, nor replace old scores retroactively.

## Public handoff scope

The new branch preserves source, tests, scripts and dated evidence. Duplicate `handoff-*` archives, local `.env` files, private runtime evidence, build output and local-only Compose overrides are not part of this publication. A configured-pattern scan found no matched provider keys, JWTs, private keys or hard-coded authorisation/cookie headers in the selected source/evidence set; this is not a guarantee against every unknown secret format.
