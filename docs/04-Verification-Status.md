# Verification status on 7 October 2026

For the later cloud deployment and its actual limitations, read [Cloud acceptance on 11 October](10-Cloud-Acceptance-20261011.md). The statements below are historical, not the current account/deployment status. Lecturer acceptance of the revised proposal was subsequently supplied by the student; it does not establish implementation acceptance.

## Historical baseline notice

The Windows results below describe the supplied ZIP before the current improvements. They are retained for traceability, not presented as fresh verification. Original raw reports are now in `evidence/baseline-original/`. For current Mac results, see `05-Current-Handoff.md`, `evidence/current/acceptance.json`, and `evidence/current/scaling-repeated.json`. Do not compare cross-machine throughput as a software speedup. The delivery now has 16 unit/adapter tests and 4 additional integration regression groups, plus the original 18 groups.

This is a revised implementation baseline. It does not yet establish completion of the practice module. Results below were actually produced on this Windows host using Docker Linux containers. They are separate from the earlier handoff's 122-check records.

## Observed local checks

- Clean locked installation succeeded both locally and inside the container build.
- TypeScript compiled; nine domain tests passed. They cover fail-closed evidence, critical failures, provider errors, latency boundaries, duplicate/unknown outputs, JSON own-key checking, strict contracts and independent review.
- Eighteen integration/security scenario groups passed. Real HTTP requests crossed gateway/business services with actual PostgreSQL and RabbitMQ, using signed local development identities. Checks include anonymous/tampered identity rejection, unauthenticated internal request denial, separate-database credential isolation, viewer restrictions, strict inputs, concurrent idempotency, immutable old suite evidence, cross-tenant records, critical/missing/error gates, duplicate release denial, self/service/issuer review denial, stale/competing review, evidence audits, CLI exit behavior and persistence after service restart.
- Worker fault recovery passed. The independent support container was deliberately paused to keep a replay job in progress; worker was killed; support resumed and worker restarted. The same job finished after a second attempt with one final result. Approximate elapsed time 15 seconds, matching the local lease configuration. This is process recovery, not database restoration or node/region HA.
- Dependency advisory audit of the locked package graph reported zero advisories at the time of checking. This does not establish absence of all security vulnerabilities. Container image scanning is configured in CI and not claimed as locally completed.
- Local console opening/layout was inspected in the browser. API flow verification is automated; a full multi-person cloud browser UAT remains outstanding.

Raw reports: `evidence/integration-local.json`, `fault-local.json`, `scaling-local.json`, `dependency-audit.json`, and delivery manifest. Reports use non-sensitive fictional data, and contain no access tokens.

## Latest local replica comparison

Same ten-case static replay workload, 120 jobs per stage, eight submitting clients, same host, each application container limited to 0.5 CPU and 384 MB. Warm-up excluded; no paid calls and no artificial evaluation delay. One PostgreSQL and one RabbitMQ remain shared dependencies.

- One worker: 120 succeeded, zero blocked/failed; about 50.33 completed jobs/s; job-completion p95 1,005 ms; queue-wait p95 997 ms. One worker ID observed.
- Three workers: 120 succeeded, zero blocked/failed; about 47.04 completed jobs/s; job-completion p95 476 ms; queue-wait p95 461 ms. Three different worker IDs observed.

Interpretation: replicas distributed jobs and the latest stage had lower completion/queue p95, but overall throughput did not improve. This short sequential-stage comparison is not a controlled repeated performance study; submission p95 also changed, and API/publisher/database/shared-host effects can dominate the cheap rules. It establishes local multi-instance execution, not proportional scalability, sustained cloud capacity, automatic scaling or model-provider throughput. Preserve this unfavorable throughput finding. A cloud experiment needs sustained/repeated workloads, endpoint/queue/broker/database observations and the autoscaler trace.

## Supplied but not executed on a cloud account

- Kubernetes manifest generator, separate Deployments/Services and optional KEDA queue-based scaler.
- GitHub CI definition for clean build, tests, dependency/image checks and tested image artifact.
- Protected-environment CD definition checking successful CI/source identity and the pulled Docker image identity, followed by rollout and authenticated replay smoke.
- HTTPS provider adapter with two prompt versions and ten fixed cases; real calls are disabled until authorized/configured.
- Fixed-case human rubric and member effort record headers. They contain no invented judgements/hours.

## Required before claiming course completion

1. Choose cloud, budget and identities; deploy the services and validate HTTPS/OIDC/tenant roles with actual accounts.
2. Run a real provider experiment for two prompts on the same suite, retain unedited outputs/errors and independent human rubric.
3. Run hosted CI/CD and obtain run URLs, exact commit/image digest, approval, successful smoke and a failing-pipeline demonstration.
4. Collect cloud manual-replica and automatic scale-up/down evidence, sustained workload measurements, bottleneck analysis and retest.
5. Complete independent cloud UAT and recovery checks; distinguish code rollback from database restore and disclose untested HA/DR.
6. Record actual member contribution and progress reports; complete the formal report/presentation against the course template.

The project theme remains ReleaseGuard and the original A–E responsibilities remain intact. The revised four-page proposal is for team review before submission. Lecturer acceptance of the revised design has not been obtained, and no submission/email was sent.
