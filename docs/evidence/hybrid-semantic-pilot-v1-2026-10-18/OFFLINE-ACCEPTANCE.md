# Semantic pilot v1 — offline acceptance

Date: 2026-10-18 (Asia/Singapore)

## Relevant frozen-path checks

- Build: passed.
- Strict provider transport, raw-first persistence, exact evidence location and pilot-fixture tests: **16/16 passed**.
- The 20 frozen responses all pass deterministic binding and format validation before semantic review.
- The set contains 10 allowed references and 10 single-meaning violating variants in a shuffled opaque order.
- Provider request snapshots contain no expected label, pair identity, reference evidence, rationale or expected outcome.
- No pilot answer exactly reuses an answer from the previous v2 held-out fixture file.
- The corrected rule for a prohibited item marked `passed` permits no violating quote and a clear inspection reason without requiring `missingReason`.
- An uncalibrated reviewer still cannot activate formal customer delivery.

## Wider repository check

`npm test` completed with **764/765 passed**. The sole failure is the previously tracked `evaluator-next-v1-holdout-v2` heuristic evaluator mismatch. That old regex evaluator is not used to calculate this semantic pilot, is not being modified in this scope, and is not represented as passing.

## Reference provenance

The sample texts and labels are project semantic reference annotations prepared by an isolated subtask that read only the approved policy/rule definitions and the requested scenarios. It did not read reviewer outputs or provider responses. This is a pre-freeze validation set, not a verified human blind review.

## Network state

No semantic-review inference request was sent while preparing or testing this acceptance record. Customer-generation requests remain zero.
