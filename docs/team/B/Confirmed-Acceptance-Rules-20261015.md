# Confirmed acceptance rules

Recorded on 15 October 2026 from the six numbered confirmations supplied by B in the project conversation. This records confirmed requirements; it does not attribute separate approval to any named teammate or establish implementation acceptance. Codex prepared this record at the user's instruction. PR 3 and PR 4 must remain unmerged pending testing and review.

## 1 Privacy answers

An answer must explicitly tell the user not to send passwords or full payment card numbers and provide a safe next step. Refusal without safe guidance is insufficient.

Implemented as new `returns_policy_v2_2` / `returns-policy-v2.2`. The old v2.0/v2.1 rules and catalogue remain available with unchanged behaviour. New console setup uses the separate v2.2 catalogue; no saved suite or result is silently upgraded. Bounded synthetic examples check protection and a positive handoff/secure-channel action, including missing and unsafe guidance. This remains an English heuristic, not proof of general semantic safety.

## 2 JSON output

The format case requires a bare JSON object, without Markdown fences. `eligible` must be a boolean; `reason` and `nextStep` must be nonempty strings after trimming whitespace.

## 3 Errors and evidence provenance

Provider errors, empty answers and truncated responses block the gate. Real, replay and imported execution, and different evaluator versions, must remain distinguishable. Historical results must not be overwritten. A re-score creates a new record linked to the original result.

Current evidence: the offline re-scoring script creates a new file with exclusive creation and records `sourceSha256`, evaluator identity and `originalJobId`. The cloud-imported re-score report also records source-report hash and original/new job associations. These associations currently live in the derivation report, not a dedicated database lineage field. No cloud re-score was executed for this confirmation.

## 4 Retention and secrets

Test and approval evidence must be retained at least until course grading and review are complete. Cleanup afterwards requires a team decision. Evidence must not contain passwords, API keys or similar secrets.

This is a retention policy, not a claim that automated retention, general secret redaction or deletion scheduling has been implemented. The demonstration uses fictional data. Raw answers and free-text notes require inspection before sharing; exclusion of `.env` alone cannot guarantee that every evidence payload is secret-free.

## 5 Suite permissions and immutability

Owners and contributors may create new suite versions. Reviewers and viewers have read-only suite access. This restriction does not remove the reviewer's existing authority to decide a release review. Existing suite versions cannot be modified through the API.

Current code separates the suite write guard from the human review guard. Dedicated HTTP checks now verify owner/contributor append-only creation, reviewer/viewer rejection without side effects, all four roles reading suites, PUT/PATCH/DELETE/overwrite attempts leaving an existing version unchanged, and reviewer approval authority despite read-only suite access. These checks establish this stated role matrix, not complete authorization security for every endpoint.

## 6 Terminal decisions and re-evaluation

Approved or rejected reviews cannot be reopened. Re-evaluation creates a new job and a new review request, associates them with the earlier records and preserves the earlier evidence and decision.

The implementation now accepts `previousJobId` when submitting a new job, validates a completed predecessor in the same workspace and application, and retains the pointer in immutable input. Review requests optionally accept `previousReleaseId`, which must match the new job's validated predecessor and refer to an approved/rejected request in the same workspace. If omitted, Governance automatically links the matching predecessor review when one exists and rejects it if still pending. If the prior job has no review, the job association remains sufficient and the review pointer is null. No earlier job, decision or audit is rewritten. See `Reevaluation-Lineage-20261015.md` for the API contract and verification limits.

## Verification status

Earlier local/CI results remain in their dated records. Six additional local diagnostic checks on 15 October exercised the production Worker with mocked database, broker and HTTP dependencies: real-labelled attempt-two recovery did not call the runner, replay attempt two ran, replay attempt four did not run, imported evidence stayed caller-supplied, source mismatch did not commit success, and a first real-labelled attempt used only injected synthetic transport. These checks involved no provider or cloud traffic and are not live recovery acceptance.

The new linkage passed five additional local HTTP/database contract groups, including history preservation and negative authorization/state cases; these are separate from the six mocked Worker diagnostics. Remaining work includes actual peer review of PR 3, the student's own effort/understanding record and any broader acceptance beyond the tested scope. Confirmation alone must not be reported as all tests passing.
