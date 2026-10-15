# Re-evaluation lineage

Date: 15 October 2026. B's confirmed rule 6 requires new evaluations/reviews to retain links to earlier records while leaving terminal decisions closed. Codex implemented and executed the tests at the user's instruction. Neither PR 3 nor PR 4 is authorized for merge.

## API contract

`POST /api/v2/jobs` accepts optional `previousJobId` (UUID) in addition to its existing fields. It must identify a succeeded or failed job in the same workspace and application. Missing/foreign-workspace IDs return 404; incomplete or different-application predecessors return 409. Existing clients may omit it. The field participates in the canonical request hash, so a reused idempotency key with a changed or removed lineage reference conflicts rather than changing the original job.

The validated reference is stored in the new job's `input.previousJobId`, returned by job detail and internal evidence APIs, and exposed as `previous_job_id` in job lists. A new job may choose a new suite version or prompt; it cannot claim to be a continuation of a different application's job. Existing records have no pointer and remain readable.

`POST /api/v2/releases` accepts optional `previousReleaseId` (UUID). Governance validates it in its own database and workspace. The referenced review's job must equal the new job's validated `input.previousJobId`, and its decision must be approved/rejected. Missing/foreign-workspace IDs return 404; mismatched or pending predecessors return 409. If the pointer is omitted, Governance looks up the matching previous job's review and applies the same terminal-state requirement, so omission cannot bypass a pending predecessor. If the previous job has no review, the new request retains its job lineage with no review pointer.

The reference is stored in `releases.previous_release_id`, appears in review lists and the evidence export, and is included with `previousJobId` in the `ReleaseRequested` audit details. Only a new request is written. Existing decision/version/identity rules continue to apply to that new request. There is no endpoint to edit these references or reopen old decisions. A subsequent re-evaluation supplies the immediate previous job/review IDs to extend the chain.

This is opt-in lineage for declared re-evaluations. The server cannot infer that an ordinary new job is intended to replace an earlier job when the caller supplies no predecessor. The existing console has no new lineage controls in this backend change; API clients and the JSON-input CLI can supply `previousJobId`, and an API client can supply `previousReleaseId`. No prompt/evaluator rules or paid-call permissions changed.

## Data ownership and upgrade

Evaluation validates the previous job using only `rg_evaluation`; the reference is in existing immutable JSON input, so no Evaluation table migration is needed. Governance receives the validated job through the authenticated Evaluation API and checks the prior review using only `rg_governance`, with a shared row lock during request creation. No cross-service SQL or foreign key was added.

Governance startup executes an additive, idempotent `ALTER TABLE releases ADD COLUMN IF NOT EXISTS previous_release_id uuid REFERENCES releases(id)`. Existing rows receive null; no old evidence/audit payload is rewritten. This follows the existing startup-schema convention. A large production deployment would require a separately managed migration/lock plan; this course change does not claim a general migration framework.

The local upgrade used the existing `rg-b-api-review-lf-20261014` data volume without deleting it. Before new Governance startup, the column count was 0; afterwards it was 1, and services became healthy. CI also starts with fresh storage. Repeated startup is exercised by the existing restart and upstream-outage checks. No database restore was claimed.

## Tests

- Unit/adapter suite: 147 passed, including two new schema tests for optional backward-compatible UUID links and rejection of caller-injected decision state.
- Auxiliary tests: 7 passed, including Windows npm startup and LF attributes.
- Local HTTP/database integration/security/restart groups: 18 passed.
- Local contract groups: 14 passed, including five new lineage groups in the existing CI-invoked `scripts/verify-contracts.mjs`.

The five groups verify: explicit new-job/new-review linkage and unchanged prior job/evidence/audit; rejection of missing, foreign-workspace and different-application job references without new jobs; rejection of missing, unrelated and foreign-workspace review references without new requests, plus automatic linkage; rejection of pending review predecessors both with and without an explicit pointer; and rejection of an unfinished predecessor job while the local test worker is paused. Existing tests continue to cover terminal-state immutability, independent reviewer identity and single-decision concurrency.

Evidence: `evidence/2026-10-15-lineage/ddd-contracts.json` and `evidence/2026-10-15-lineage/integration-local.json` relative to this directory. These contain fictional replay records only. All tests were local, with no cloud resources or model calls. Hosted CI status must be checked at the actual PR head; local success is not a remote result or peer approval.
