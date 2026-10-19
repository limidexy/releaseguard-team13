# Offline verification log

Date: 2026-10-17  
Final status: `EVALUATOR_NOT_READY`

## Build

Command: `npm run build`

Result: pass (`tsc`, exit 0).

## Regression suite excluding the deliberately failing unseen holdout

Command:

```sh
test_files=(${(f)"$(rg --files dist/tests -g '*.test.js' | rg -v 'evaluator-next-v1-holdout-v2\.test\.js$')"})
node --test $test_files
```

Result:

```text
tests 735
pass 735
fail 0
duration_ms 988.794583
```

## Candidate development and converted-to-development suites

Command:

```sh
node --test \
  dist/tests/evaluator-next-v1.test.js \
  dist/tests/evaluator-next-v1-holdout.test.js
```

Result: 7 aggregate tests passed, 0 failed. The aggregate assertions cover 40 complete references, 20 single-duty omissions, 20 appended contradictions and 80 converted-to-development fixtures.

## Unseen holdout

Command: `node --test dist/tests/evaluator-next-v1-holdout-v2.test.js`

Result: fail (exit 1), intentionally preserved as validation evidence.

Metrics computed from all 80 unseen fixtures:

```text
trueAllow: 6
trueBlock: 34
falseAllow: 6
falseBlock: 34
finalDecisionAgreement: 40/80
failureReasonAgreement: 32/48
unverifiable: 0
```

The detailed mismatch records are in `ACCEPTANCE-METRICS-v1.json`.

## Historical replay

Command: `node scripts/evaluator-next-v1-offline.mjs`

Result: pass (exit 0).

```text
20B historical raw v2.10: 70
20B historical final allowed: 5/20
120B historical raw v2.10: 75
120B historical final allowed: 1/20
diagnostics generated: 40
provider calls: 0
judge calls: 0
```

## Metrics generation

Command: `node scripts/evaluator-next-v1-metrics.mjs`

Result: pass (exit 0); generated final status `EVALUATOR_NOT_READY`.

## Frozen evidence integrity

Command:

```sh
shasum -a 256 docs/evidence/model-v17-ab-r4-2026-10-17/ab-real-v17-r4-final.json
```

Result:

```text
de31624111012d425ccb789e1fdd1a3d500a0916615ec4c3e4b51a404f259587
```

This matches the expected frozen r4 hash. No r4 answer or historical score was modified.

## External actions

No provider inference, judge-model call, deployment, publication, Git commit or Git push was performed.
