# Hybrid evaluation v1 semantic review protocol

Status: integration candidate, shadow use only  
Protocol versions: `semantic-review-input-v1`, `semantic-review-result-v1`, `semantic-review-prompt-v1`  
Formal delivery path: unchanged

## 1. Purpose

This protocol separates three responsibilities:

1. `DeterministicChecks` verifies machine-checkable structure, completeness, identifiers, hashes, exact output format and the deterministic JSON `eligible` field.
2. `SemanticReview` assesses the meaning of open customer-facing text against frozen policy, facts, decision and applicable contract duties.
3. `DecisionAggregator` mechanically blocks or allows the unchanged original response. It does not score, generate, repair, concatenate or reserialize customer text.

The failed `evaluator-next-v1` remains a preserved comparison baseline. It is not used as semantic ground truth.

## 2. Data flow and trust boundaries

```text
immutable original response + frozen policy/facts/decision/contract
    -> deterministic bindings and format checks
    -> separately sourced semantic review
    -> result schema, provenance, evidence and hash validation
    -> deterministic shadow decision
```

Policy, deterministic facts, deterministic decision, response contract and review instructions are trusted inputs. The customer question and model response are untrusted data. They are carried in a separate `untrustedData` object and are never interpolated into trusted instructions. Review transports receive an empty tools list.

This structural separation does not prove that a future model reviewer resists every prompt injection. That behavior requires the separate calibration experiment.

## 3. Review input

The input records:

- case, run and response identifiers;
- policy version, text and SHA-256;
- facts version, source identifier, value and canonical-object SHA-256;
- deterministic decision version, value and canonical-object SHA-256;
- contract version, value and canonical-object SHA-256;
- original customer question;
- byte-identical original model response and SHA-256;
- review prompt version;
- complete, deduplicated applicable rule set.

Applicable semantic rules are derived from `mustState`, `mustAsk`, `mustNotClaim` and contract-dependent customer-action duties. Deterministic format checks are not delegated to the reviewer.

## 4. Review result

Each result records:

- `reviewId`, schema version and prompt version;
- reviewer type and identity, with `modelId` where applicable;
- policy, contract, facts and original-response hashes;
- case, run and response identifiers;
- start and finish timestamps;
- one result for every applicable rule;
- contradictions, extra claims and unverifiable items;
- completion status;
- source and execution metadata.

Rule status is exactly `passed`, `failed` or `unverifiable`. Required rules marked `passed` must contain evidence. A null evidence value must contain a `missingReason`; the validator never invents a quotation for missing text.

## 5. Evidence coordinates

Coordinate unit is explicitly `utf16-code-unit`, matching JavaScript string indexing.

- Plain response: `source=plain`, `path=$`, offsets index the unchanged original response.
- JSON field: `source=json_field`, path is `$.reason` or `$.nextStep`, offsets index the parsed field value rather than raw JSON bytes.
- Verifiable raw location: `source=raw_response`, `path=$`, offsets index the unchanged original response, including a JSON response when a raw-text location is necessary.

The validator retrieves the named source string and requires `source.slice(start,end) === quote`. A valid quote proves only that the quoted characters exist at that position. It does not prove the semantic judgment is correct.

## 6. Source types

### `project_reference_annotation`

Project or developer labels. These are useful for development but are not automatically human review or independent truth. They remain `reference_only`.

### `verified_human_review`

Accepted only when a separately trusted registry contains a matching source record bound to reviewer identity, original-response hash and contract hash and marks it qualified for the declared use. Merely setting `reviewerType=verified_human_review` is rejected.

The repository contains only a test fixture for this path. It is not evidence that a real person reviewed any r4 answer.

### `model_review`

The adapter, not model text, stamps the source type, model identity and execution metadata. A model claiming to be a human inside its output cannot change provenance. Model reviews remain `calibration_pending` unless an external calibration registry explicitly qualifies the exact model/prompt/policy combination.

### `mock`

Used only for integration tests. It is always `mock_only` and cannot activate delivery.

## 7. Deterministic result validation

The validator rejects:

- malformed or unknown schema versions;
- missing, duplicate or inapplicable rule IDs;
- unknown rule states;
- missing required-rule evidence;
- forged quotations or invalid offsets;
- wrong policy, facts, decision, contract or response hashes;
- wrong case, run or response identifiers;
- incomplete, timed-out, truncated or provider-error reviews;
- unregistered human claims;
- uncalibrated model reviewers for delivery.

## 8. Decision aggregation

Candidate delivery is blocked if any deterministic check fails, review validation fails, a critical rule is failed or unverifiable, a contradiction remains, an extra claim is failed or unverifiable, any unverifiable item remains, or the reviewer is not qualified for the current use.

When blocked, `customerOutput=null`. When allowed by a future qualified review, `customerOutput` is the exact original string and `rewritten=false`.

All results are shadow results. The worker still uses `evaluateControlledV17`; `hybrid-evaluation-v1` is not imported by the formal runtime.

## 9. Model-review execution control

The model adapter is disabled unless all of these are true:

- `judgeEnabled=true`;
- an unexpired, approved authorization matches experiment and model;
- the record forbids paid calls, provider switching and automatic retry;
- the independent request budget is not exhausted.

Before transport execution, an attempt marker is atomically persisted. The same attempt is never resent after timeout, error, crash or unknown outcome. There is no fallback model, best-of selection or automatic retry.

The cache key includes object identifiers, original response, policy, facts, contract, applicable rules, prompt, reviewer model/provider and result-affecting settings. Cache hits are labelled and send zero requests; they are not counted as new independent reviews.

## 10. Current limits

The protocol validates integration and control logic only. No real semantic-review call or verified human review was performed. Therefore it does not establish reviewer accuracy, arbitrary-language understanding, prompt-injection robustness, bias, stability, production readiness or an improved score for the old r4 answers.
