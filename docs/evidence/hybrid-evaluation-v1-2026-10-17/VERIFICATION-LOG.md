# Hybrid evaluation v1 verification log

Date: 2026-10-17  
Scope: offline integration and control verification only  
Runtime: Node.js v24.19.0  
Git HEAD at verification: `20d258d891935b2d5bee3375ebf81b2872adf76f`  
Branch: `feat/b-api-review`

## 1. Commands and outcomes

The project was compiled with the bundled Node.js 24 runtime required by the repository.

| Check | Outcome |
|---|---:|
| TypeScript build | Pass |
| `hybrid-evaluation-v1` integration suite | 13/13 pass |
| Regression suite excluding the deliberately failing evaluator-next unseen holdout | 748/748 pass |
| Existing evaluator-next unseen holdout | Fail as preserved evidence |

The failing holdout remains intentionally separate from the passing regression count. Its current result is unchanged:

- 80 fixtures total;
- 34 false blocks;
- 6 false allows;
- 40/80 final-decision agreement;
- final status remains `EVALUATOR_NOT_READY`.

## 2. Hybrid controls verified offline

The 13 hybrid tests verified:

- schema and identifier binding for case, run and response;
- policy, facts, decision, contract and original-response hash binding;
- response-completion checks;
- exact plain/JSON format checks, duplicate JSON-key rejection and deterministic `eligible` binding;
- complete, unique and applicable semantic rule sets;
- evidence quote and UTF-16 coordinate validation for plain, raw and JSON-field evidence;
- missing, duplicate, inapplicable, mismatched, malformed, truncated and provider-error review rejection;
- critical `failed` and `unverifiable` outcomes, contradictions and unauthorized/unverifiable extra claims causing a block;
- `customerOutput=null` on a block and byte-identical original output only on an allowed candidate result;
- project reference, verified-human, model and mock provenance remaining distinct;
- an asserted `reviewerType` not upgrading its own trust;
- trusted reviewer instructions remaining separate from the untrusted question and answer, with no external tools exposed;
- judge disabled by default with zero requests;
- persistent attempt reservation preventing a resend after an unknown provider outcome;
- cache binding across identifiers, response, policy, facts, contract, prompt, model/provider and result-affecting settings;
- formal worker remaining on `evaluateControlledV17` and not importing the hybrid candidate.

## 3. Mock-only evidence

The passing mock and synthetic-human fixtures prove control-flow integration only. They are not real semantic-review results, verified human reviews, calibration scores or evidence of natural-language accuracy. The model adapter test uses an in-process transport stub and sends no provider request.

## 4. Historical evidence integrity

- Frozen r4 evidence: `docs/evidence/model-v17-ab-r4-2026-10-17/ab-real-v17-r4-final.json`
- SHA-256: `de31624111012d425ccb789e1fdd1a3d500a0916615ec4c3e4b51a404f259587`
- Historical raw v2.10 scores reproduced by the hybrid compatibility test: 20B = 70; 120B = 75.
- Historical final allowed counts reproduced: 20B = 5/20; 120B = 1/20.
- No historical answer, score, gate decision or failed holdout was overwritten.

## 5. External actions

- Customer-generation calls: 0
- Semantic-review model calls: 0
- Verified-human reviews imported: 0
- Deployment/publication: none
- Git commit/push: none

## 6. Result

The new parallel integration and its controls pass offline verification. The semantic reviewer has not been calibrated, so the candidate remains shadow-only and cannot activate formal delivery.

`HYBRID_INTEGRATION_READY_CALIBRATION_PENDING`

The older candidate remains separately:

`EVALUATOR_NOT_READY`
