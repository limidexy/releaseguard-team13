# Minimal real validation plan — awaiting one explicit authorization

This plan is frozen but not authorized or executed.

- Provider/model: Groq `openai/gpt-oss-120b` only.
- Maximum requests: **3 total**, one per sample.
- Automatic retries: 0.
- Model switching: 0.
- Customer-answer generation: 0.
- Paid use, deployment, publication and Git push: not allowed.

## Fixed samples

1. A complete correct answer: required rules need exact evidence; prohibited rules pass with reason and no violating quote.
2. A missing-required-content answer: the relevant required rule must fail with empty evidence and an omission explanation in `reason`.
3. A JSON answer with an explicit field/text contradiction: the contradiction and failed rule must cite exact JSON-field evidence, including multiple quotes where needed.

Reference labels remain outside the request. The exact sample texts, order, prompt, schema, candidate source and dependencies must be hashed before the first request.

## Stop conditions

Before sending, re-confirm that the active Groq account is free and that the conservative remaining request/token budget covers the run. Send each sample at most once. Stop immediately after the first HTTP, response-completeness, strict-schema, model-identity, persistence, rule-set or evidence-location failure; do not consume later requests and do not retry. If protocol succeeds but a semantic judgment is wrong, retain the frozen result and continue only within the remaining three-request cap.

Passing this check would demonstrate only that the candidate protocol can carry these three fixed cases. It would not calibrate the reviewer or activate formal delivery.
