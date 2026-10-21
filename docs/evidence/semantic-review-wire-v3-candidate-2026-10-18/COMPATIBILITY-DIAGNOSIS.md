# Semantic review wire v3 compatibility diagnosis

- Mode: offline diagnostic only
- Network/model calls: 0
- Historical score changed: no
- Historical pilot state: `SEMANTIC_PILOT_INCOMPLETE` (unchanged)
- Records diagnosed: 3
- Candidate derivations structurally/evidence valid: 3/3
- Preserved legacy `missingReason` values: 1
- Explicit legacy content conflicts: 1

| # | Saved review | v3 candidate derivation | preserved missingReason | conflict |
|---:|---|---|---:|---|
| 1 | `rgp-cobalt-71` | passed | 0 | none |
| 2 | `rgp-tundra-59` | passed | 0 | none |
| 3 | `rgp-maple-02` | passed | 1 | ruleResults[2].missingReason: LEGACY_MISSING_REASON_WITH_EVIDENCE |

The v3 candidate result is not a new model score. It is a read-only adaptation of sealed v2 output. Every legacy `missingReason` value remains in compatibility metadata. The Maple record contains evidence and a separate missing explanation for the same rule; that conflict is reported rather than erased.
