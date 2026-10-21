# Semantic review wire v3 candidate: protocol difference

This is an additive candidate. It does not replace the sealed v2 experiment, change its score, or enter the formal worker path.

## Model-visible output

| Area | Sealed wire v2 | Candidate wire v3 |
|---|---|---|
| Rule judgment | `ruleId`, `status`, `reason`, `evidenceFragments`, `missingReason` | `ruleId`, `status`, `reason`, `evidence` |
| Missing content | Split between `reason` and `missingReason` | Explained only in `reason` |
| Evidence | Zero or more exact quotes | Zero or more exact quotes |
| Coordinates/hash/identity | Not model-generated | Not model-generated |
| Observation wording | `description` plus optional missing explanation | One `reason` field |

The provider `json_schema` and the local Zod shape have the same required fields and closed objects. The provider schema contains no `missingReason` or `evidenceFragments` property.

## Explicit local constraints

These checks are intentionally outside the provider structural schema and are exported by `SEMANTIC_REVIEW_LOCAL_CONSTRAINTS_V3`:

1. Every applicable `ruleId` must appear exactly once; missing, duplicate and unknown IDs fail.
2. A path/quote pair cannot repeat within one judgment.
3. Every quote must have exactly one verbatim match in the selected original field.
4. A required rule marked `passed` needs evidence.
5. A required rule marked `failed` may have no evidence when content is missing; `reason` explains the omission.
6. A prohibited rule marked `passed` may have no violating quote; `reason` records the check.
7. A prohibited rule marked `failed` needs violating evidence.
8. An explicit contradiction and an extra claim marked `failed` need evidence.
9. `unverifiable` remains unchanged and cannot be promoted to `passed` by the program.
10. Only a completed review passes protocol validation.
11. Mechanical derivation may add coordinates and compatibility metadata but cannot change model status, reason or quotes.

## Compatibility boundary

The existing v1 internal review record still requires a missing explanation whenever its single evidence slot is null. The candidate adapter therefore copies the v3 `reason` into a compatibility-only `missingReason` field when no quote exists. This field is not sent to the model and does not alter its judgment.

For sealed v2 records, old `missingReason` values are retained in `legacyMissingReasonMetadata`. A record containing both exact evidence and a non-null old `missingReason` is reported as `LEGACY_MISSING_REASON_WITH_EVIDENCE`; it is not silently deleted or treated as a new model result.
