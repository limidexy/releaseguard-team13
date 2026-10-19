# Generation view r4 mapping

| Full contract source | Concise generation field | Execution meaning |
|---|---|---|
| `mustState` | `requiredExpressionOrder` | Every applicable business statement remains mandatory |
| `mustAsk` | `requiredClarifications` | Every listed question must be asked; human review does not replace it |
| `mustNotClaim` | `applicableBoundaries` | Unsupported policy, action, receipt material, secret and data-handling claims remain forbidden |
| `intervalEvidence.kind = bare_interval` | origin-neutral interval instruction | Says only “mentioned interval”; does not invent delivery, discovery or purchase origin |
| `intervalEvidence.kind = arrival_or_discovery_interval` | supported arrival/discovery instruction | Uses arrival/discovery wording only because the source evidence supports it |
| `responseMode` | `responseMode` plus the unchanged response-mode instruction | Plain and JSON receive the same business obligations |

The full contract remains the audit object. Only this concise view is sent for generation. No reference answer or post-generation repair is used.
