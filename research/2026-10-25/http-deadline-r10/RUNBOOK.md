# Offline archive: r10 HTTP deadline boundary candidate

## Status

Source TypeScript and four harness files are byte-identical to the original local r10 files. The r9 comparison source is archived separately. This publication is not a deployed image or a complete runnable website. No tests, dependency installation, Docker start, cloud probe or model request were executed in this new package location. Historical evidence is copied as path-redacted JSON derivatives; source provenance is in PUBLICATION-ALLOWLIST.json.

## Historical checks

- r9 comparison: 4/7 real HTTP scenarios passed, 3 failed.
- r10: 72/72 deadline checks (71 no-HTTP pure/helper plus one Gateway inject-to-local-upstream), 7/7 real three-service scenarios.
- Separate active Registry-close diagnostic: 1/1; the original seven were deliberately skipped, not counted as repeated passes.
- A prior supplementary startup failed before any job POST; that infrastructure failure is preserved.
- SQL already dispatched may commit after a response disconnect. The result remains unknown at the wire, never automatically rewritten as success or retried.
- No cloud root cause, original 897-request acceptance, maximum capacity or scaling benefit is proven.

## Dependency and layout limitations

Node >=24 is required. Both candidate package manifests and the dependency lock were checked for identical dependencies/devDependencies; no node_modules or compiled dist is included. The lock is a byte-identical copy from the existing classroom source tree whose package dependencies match the candidate manifest. The newer experimental tree lock has additional dependencies and was deliberately not substituted. This establishes manifest compatibility only, not that this archived lock exactly reconstructs every installed module from the historical r10 test run. The unchanged package scripts also name general project scripts/tests not present in this archive; do not use npm test/start/tokens/verify as claims of archive completeness.

The four archived harnesses intentionally retain their original relative imports. They reference a sibling releaseguard-v23-v6-20261015.41NMNE/ReleaseGuard tree for pg/jose and demo-fixtures, and a sibling releaseguard-admission-rootcause-offline-20261025-r9 tree for RED/baseline. Those exact names/layouts are not recreated by this public archive. Therefore this archive is NOT download-and-run and no fresh-path test pass is claimed. reference-input/demo-fixtures.json is the byte-identical test input for review only.

For an explicitly authorized reproduction in an isolated scratch location: install the checked lock without changing versions, build candidate/source with its TypeScript compiler, recreate the original sibling layout or make separately hash-recorded path-only harness wrappers, and use new unique evidence directories/once markers. Review imports first. No candidate source logic may be altered. The original sequence was deadline-wire green, HTTP green with a unique run label, then the separate registry-close-only diagnostic and independent cleanup readback. The HTTP harness requires pre-existing postgres:16-alpine and rabbitmq:4-management-alpine images and uses --pull=never, unique labels, random loopback ports and tmpfs. It creates synthetic identities only, imports no Worker/Support, and removes only its own ID/label-verified test containers. Do not access a real application database or port5193.

No command in this runbook authorizes a new test. No cloud/deployment runner is published.

## Candidate boundaries

Full close propagation is checked across Gateway→Evaluation→Registry. A signed request-bound remaining budget is propagated from Gateway and converted to a monotonic local deadline with an explicitly configured cross-node clock-skew bound. Local same-host tests use zero; no GKE clock-skew bound is established. Missing/invalid clock configuration fails closed. A shared internal HMAC secret is shared-service trust, not independent human identity. No production secret is included.

No admission limit, Worker/model/rule/resource/HPA threshold is changed. Do not infer that a generic timeout extension or additional retry fixes upstream waiting. The future 897-request probe requires separate authorization, fresh trial/billing/cost/clock checks, three-service deployment scope and hard shutdown/rollback planning; it was not performed.
