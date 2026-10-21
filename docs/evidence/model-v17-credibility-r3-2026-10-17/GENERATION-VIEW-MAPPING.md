# Concise generation view and full-contract mapping

The full `response-contract-v17` object remains the audit and validation authority. It is not sent to the model in the prepared A/B experiment. The model receives `generation-view-v17-r3`, which contains facts, the deterministic conclusion, required expression order, permitted clarification questions, applicable boundaries, and output mode.

| Full contract audit area | Concise generation-view field | Information retained |
|---|---|---|
| `standardEligibility`, time status, failure/review reasons | `businessConclusion` | Deterministic conclusion and only the supplied reasons |
| `mustState` policy, timing, eligibility, review, privacy, capability duties | `requiredExpressionOrder` | Natural-language obligations without rule IDs or `appliesBecause` metadata |
| `mustAsk` | `permittedClarifications` | Only purchase date, unused status, and receipt availability when applicable |
| `mustNotClaim` | `applicableBoundaries` | No unsupported actions, approval, receipt material, secrets, invented policy, remedies, channels, or data practices |
| `clarificationBlocksHumanContact=false` and customer action | `applicableBoundaries` | Clarification never blocks immediate human contact; the customer performs the contact |
| response mode | `responseMode` | Same business duties for plain and JSON; only serialization changes |

The generated view deliberately excludes `ruleId`, `appliesBecause`, `mustState`, `mustAsk`, `mustNotClaim`, checker diagnostics, scores, and historical evidence. It does not contain a full reference answer. The runner sends one user question plus this concise view, preserves the raw response, and performs no post-generation insertion, rewriting, JSON repair, retry, or answer replacement.

Automated mapping tests verify that every currently compiled contract duty has a destination in the concise view. This mapping evidence does not claim that every possible natural-language realization is semantically decidable by the bounded checker.
