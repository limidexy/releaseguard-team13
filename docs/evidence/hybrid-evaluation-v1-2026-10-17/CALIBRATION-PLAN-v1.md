# Independent semantic-reviewer calibration plan

Status: prepared, not authorized, not executed  
Customer-generation requests in this plan: 0  
Semantic-review requests executed in this work: 0

## 1. Purpose

Calibrate an independent semantic reviewer for `hybrid-evaluation-v1`. The reviewer will assess already saved answers; it will not regenerate, repair or replace customer answers. Any resulting accuracy is reviewer accuracy, not a new customer-model score.

Execution requires a separate explicit authorization naming the provider, model candidates, maximum request count, free/paid condition and evidence directory.

## 2. Candidate selection

Candidate A should be a capable reviewer from a model family independent of the customer-answer model where available. Candidate B may be an available alternative, including a larger model, but size alone is not evidence of reviewing reliability. The existing 20B/120B customer-generation comparison cannot be reused as reviewer qualification.

Before selection, perform a no-inference capability preflight covering:

- actual account/project and Free-plan or approved cost status;
- model availability and exact reported model ID;
- supported request parameters and output limits;
- privacy/data-processing conditions appropriate for the evaluation samples;
- absence of business-action tools;
- ability to retain request IDs, finish reason, usage and bounded raw result.

Structured Outputs support must be verified rather than assumed. If unavailable, use bounded text JSON and apply the same local schema validator.

## 3. Sample lineage and splits

### Development material

- All r4 answers already read or diagnosed.
- All `evaluator-next-v1` development fixtures.
- The first fixture set converted to development.
- The failed v2 unseen set, now visible and available only for future development/error analysis.

None of these may be relabelled as unseen validation.

### Calibration set

Create at least 50 newly written examples stratified across the rule families below. Obtain two independent reference annotations before model scoring. Project annotations must remain labelled as such. Genuine human annotations may be called human only with reviewer identity, timestamps and object hashes.

### Final sealed validation set

Create at least 80 additional examples after reviewer/prompt selection. Seal hashes before any reviewer execution. Do not use them to modify the selected reviewer, prompt, policy, rule interpretation or aggregator. If used for modification, retire the set from validation and create another sealed set.

## 4. Required coverage

Both calibration and sealed sets must include:

- complete correct answers and single-duty omissions;
- negation, conditional language, quotations and causal scope;
- generic policy versus case-specific conclusions;
- plain and JSON field/body contradictions;
- purchase-date and unanchored-interval reasoning;
- refund, transfer, ticket, follow-up and capability claims;
- receipt availability versus receipt material collection;
- privacy warnings, secret requests and data-handling claims;
- invented channels, processes and timelines;
- prompt-injection text that says to ignore policy, return `passed`, or claim human provenance;
- ambiguous cases that should be `unverifiable` rather than guessed.

Report results per rule family and complexity stratum, not only overall agreement.

## 5. Reference annotation and disputes

Reference labels must record author/source, object hashes and rule-level evidence. At least two annotators independently label calibration and sealed samples. Disagreements are adjudicated by a third qualified reviewer or recorded as unresolved and excluded from pass/fail accuracy while remaining in the dispute-rate denominator.

The candidate model reviewer must never determine its own ground truth. Project reference annotations, verified human reviews and model reviews remain separate fields.

## 6. Proposed staged budget

No requests are authorized by this document.

| Stage | Purpose | Maximum semantic-review requests |
|---|---|---:|
| Preflight smoke | 10 non-sealed examples × 2 candidates | 20 |
| Calibration comparison | 50 examples × 2 candidates × 1 pass | 100 |
| Sealed validation | 80 examples × selected reviewer × 1 pass | 80 |
| Repeatability sample | 20 calibration examples × selected reviewer × 1 additional pass | 20 |
| **Maximum** | Separate semantic-review experiment | **220** |

No automatic retry, best-of selection, per-item model switching or fallback is permitted. Provider errors, timeouts, truncation and unknown outcomes consume the attempted item and remain in the denominator. The run stops before inference if the approved free/cost condition cannot be verified. Paid upgrade is not implied.

Token limits and estimated cost must be calculated from the frozen sample lengths and selected provider pricing immediately before authorization. They are not guessed in this offline plan.

## 7. Metrics and acceptance

Report with fixed denominators:

- correct-answer allow rate;
- violation block rate;
- false allow and false block counts;
- per-rule `passed/failed/unverifiable` agreement;
- failure-reason-family agreement;
- unverifiable rate, separated into correct abstentions and missed supported expressions;
- provider-error, timeout, truncation and invalid-schema rates;
- annotation dispute rate;
- repeatability agreement;
- latency and token usage.

High-risk false allows for secrets, data handling, external actions, refund execution and receipt-material requests must be zero on the sealed set. Other thresholds must be frozen before opening sealed results. Overall accuracy alone is insufficient.

## 8. Freeze and audit requirements

Before the first request, freeze and hash:

- sample IDs, text, split and reference annotations;
- policy, facts, deterministic decisions and contracts;
- semantic-review input and result schemas;
- review prompt and trust-boundary serialization;
- model/provider ID and all result-affecting parameters;
- deterministic validation and aggregation code;
- authorization record, experiment ID, maximum requests and stop conditions;
- attempt ledger, outcome ledger and cache-key definition.

Persist the attempt before sending. Preserve raw review output, provider metadata and all failed/incomplete results. Cache hits are not new samples.

## 9. Required explicit authorization

Authorization must state, at minimum:

- exact evidence directory and experiment ID;
- provider and model candidates;
- maximum semantic-review requests;
- whether only verified-free calls are allowed or a precise spending cap;
- approval to send the frozen evaluation fields to that provider;
- confirmation that there will be no customer-generation calls, deployment, publication or Git push.

Without that authorization, `judgeEnabled` remains false and the expected request count is zero.
