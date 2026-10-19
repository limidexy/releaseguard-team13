# ReleaseGuard repair process and evidence

This account covers the engineering changes behind the current C-side handoff. It preserves the distinction between a corrected checker, a model's original answer, protocol validity and formal delivery.

| Problem | Root cause | Change | Actual verification | Remaining boundary |
|---|---|---|---|---|
| Different scores and delivery outcomes | Frozen scorer, older guard and new checker expressed different scopes | Separate original score, offline rescore, independent guard and final intersection | v15/v16 and r4 reports retain each layer | No retroactive replacement of original outcomes |
| Valid paraphrases blocked; new violations missed | Bounded phrase matching could not reliably handle negation, subject and extra claims | Explicit deterministic decisions and contracts; keep evaluator-next as rejected candidate | Retained holdout failure reproduces in clean checkout | Tests increasing did not establish semantic accuracy |
| Model explanations omitted requirements | Prompt and control responsibilities were mixed | Deterministic business facts/conclusions; model explains; raw output independently inspected | Controlled v17 real experiments and raw outputs preserved | 70/75 customer-generation scores unchanged |
| Hybrid mock tests looked more complete than real evidence | Integration tests validated receipt of synthetic reviews | Actual Groq reviewer transport and frozen experiments | Early real feasibility retained, including failures | Mock integration is not model judgment accuracy |
| JSON mode did not enforce required wire fields | `json_object` guarantees JSON syntax, not the full schema | Strict provider `json_schema` plus local structure and cross-field checks | Provider HTTP 200 with strict schema in bounded real runs | Strict structure does not establish correct semantic meaning |
| Evidence coordinates were unreliable | Model calculated character locations and metadata | Model chooses exact quote and field; program locates unique matches and derives coordinates | Unicode, JSON fields, missing/ambiguous quotes tested | Program never repairs status, reason or quote |
| Early raw reviews were unavailable | Validation preceded adequate raw-response capture | Bounded provider response persists before parse and local validation | Raw-first success/error-path tests; v3 raw evidence retained | 16 lost historical review texts remain unavailable |
| Pilot stopped at sample 3 | `reason`, evidence and `missingReason` duplicated obligations and conflicted | Additive v3 removes model-visible `missingReason`; omission explanation stays in `reason` | Offline compatibility diagnosis retains old conflicts | Old pilot remains `SEMANTIC_PILOT_INCOMPLETE` |
| Need to establish v3 transport works with real provider | Offline fixtures could not prove supplier compliance | Frozen three-sample validation with one request per sample | 3/3 protocol-valid and 3/3 frozen-reference matches | Correct, omission and JSON-conflict types only |
| Need a bounded cross-scenario development result | Three protocol examples did not cover the remaining development set | Independent experiment selects original pilot positions 4–20 after ledger check | 17/17 valid; 9/9 correct allows; 8/8 violations and expected key reasons; zero false allow/block/unverifiable | Development labels, not verified human blind review; not production calibration |

## Evidence index

- Original customer A/B: `docs/evidence/model-v17-ab-r4-2026-10-17/ab-real-v17-r4-final.json`.
- Rejected evaluator: `docs/evidence/evaluator-next-v1-2026-10-17/` and its retained holdout test.
- Hybrid design and first real attempts: `docs/evidence/hybrid-evaluation-v1-2026-10-17/`, `hybrid-review-feasibility-v1-2026-10-17/`.
- Strict v2 and old stopped pilot: `hybrid-review-strict-v2-2026-10-18/`, `hybrid-semantic-pilot-v1-2026-10-18/`.
- v3 candidate and old-record diagnosis: `semantic-review-wire-v3-candidate-2026-10-18/`.
- Three-sample real validation: `semantic-review-wire-v3-real-2026-10-19/`.
- Separate seventeen-sample development validation: `semantic-review-wire-v3-cross-scenario-dev-2026-10-19/`.

The original records remain local/in the existing evidence history. The presentation's `evidence/Curated_Evidence.json` is an explicitly derived selection, with source hashes. It is not a claim of original provider response bytes. Raw supplier envelopes, request IDs and metadata can be inspected in the original dated directories when appropriate.

## Final state

The v3 model wire contains `ruleId`, `status`, `reason` and zero-or-more exact evidence quotes. Deterministic validators check structure, rule coverage, identity, completeness, provenance and exact evidence locations. They do not change the model judgment. The two v3 experiments have independent identities and attempt ledgers. They are not merged into one 20/20 experiment. Formal delivery remains `shadowOnly=true` and the reviewer remains `calibration_pending`. The Worker continues the existing controlled-evaluation path. A shadow allow never means an answer reached a customer.

The strongest supported conclusion is that v3 passed these frozen protocol and cross-scenario development validations. Arbitrary natural-language reliability, a hidden test set, independent human calibration, production readiness and improved customer-generation scores have not been established.
