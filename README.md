# ReleaseGuard — SE34FT Team 13

**Current working copy: 11 October 2026.** This repository continues the preserved 7/8 October baseline in a separate directory and Docker project. Start with [DDD decisions](docs/07-DDD-Design.md) and [five-member delivery workflow](docs/08-Team-Workflow.md). Prior dated documents below are historical; they are not fresh verification or the approved Word proposal. The lecturer has approved the revised proposal; implementation/cloud acceptance remains separate.

This edition uses http://localhost:5193, image `releaseguard-team13:local`, and Compose project `releaseguard-team13`. It does not modify the earlier stack on port 5189. Set `RELEASEGUARD_URL` consistently if changing `RG_PORT`.

## First local run (free, no model account)

Use Node.js 24+ and Docker Compose. From this repository:

```sh
npm ci --no-audit --no-fund
node scripts/setup-local.mjs
node scripts/acceptance.mjs
npm run tokens
```

Open http://localhost:5193. Use the developer token to set up the ten-case example and submit a labelled replay. Use the reviewer token for an independent **test identity**. No paid model, cloud resource or verified human UAT is implied. Do not share `.env`, tokens, or the `evidence/private/` folder.

`scripts/acceptance.mjs` runs real local containers, integration/security/outage contracts, worker crash recovery, paired 1/3-worker bursts, two mixed read/write stages and a dependency audit. It produces `evidence/current/acceptance.json` with commit, source hashes, exit codes and logs. It refuses a non-loopback target or enabled real-model configuration. A pass proves only the enumerated local checks. Scaling figures may be worse with more workers; retain them unchanged.

The repository's hosted CI and cloud CD are **disabled by default** using `RG_ENABLE_HOSTED_CI` and `RG_ENABLE_CLOUD_CD`. The owner must confirm included CI minutes/zero-spend limits before enabling CI; cloud requires separate account and budget approval. A skipped hosted workflow is NOT a passed CI run. See [team workflow](docs/08-Team-Workflow.md) for local pre-push verification and PR review.

## Historical baseline instructions (7 October)

The text below describes the imported baseline; replace port 5189 with 5193 in this checkout. Historical result files were deliberately not copied as current evidence.

Current delivery: 7 October 2026, local improvement edition 2.1. Start with `docs/05-Current-Handoff.md`. Historical reports in `evidence/baseline-original/` are from the supplied ZIP, not this machine. Fresh execution is recorded in `evidence/current/acceptance.json`; root-level integration/fault reports are from the latest local verification. No real provider, cloud deployment or hosted CI has been executed in this edition.

The console now has Chinese/English navigation, readable per-case results, same-suite comparisons and paginated job history. Test inputs and original answers remain untranslated to preserve evidence. Browser and scripts consume one fixture catalog.

Full local evidence run: `node scripts/acceptance.mjs`. It includes unit tests, build, startup, integration/security, new regressions, fault recovery, labelled replay comparison, three paired 1/3-worker rounds, and a dependency advisory audit. Run on an idle local machine; it creates test records and temporarily scales workers, restoring the previous count. Set `COMPOSE_PROJECT_NAME` consistently if using an isolated project name.

Prompt comparison: `node scripts/compare-prompts.mjs replay` validates the flow without a provider. To run real calls later, configure private provider secrets and provider-side spending limits, then explicitly set `RG_CONFIRM_REAL_CALLS=20` before `node scripts/compare-prompts.mjs real`. This confirmation is not a monetary cap; crash recovery may repeat requests. Human-review fields in the report are intentionally blank and must not be auto-filled with rule scores.

Revised microservice-oriented baseline for SE34FT Team 13. The original AI-assisted Worker prototype remains untouched in the source archive. This implementation replaces the one-process deployment with three business services, an asynchronous queue and independently scalable workers.

Start with [revised proposal](docs/01-Revised-Proposal.md), [architecture](docs/02-Architecture.md) and [course acceptance](docs/03-Course-Acceptance.md). [Verification status](docs/04-Verification-Status.md) distinguishes observed evidence from planned cloud work.

## Local startup

Prerequisites: Node.js 24, Docker Compose, available port 5189. Commands run from this directory.

```sh
npm ci --no-audit --no-fund
npm test
node scripts/setup-local.mjs
docker compose build gateway postgres
docker compose up -d --no-build --wait
node scripts/verify.mjs --restart
npm run tokens
```

Open http://localhost:5189. Paste a locally generated developer token, register the support app and suite, submit passing/failing replay jobs. Switch to the reviewer token to decide a passing release. Identities are signed local test identities, not verified cloud users. Tokens live only in the current page memory. The local secret file is generated per installation and excluded from Git; never share it or include it in a delivery zip.

```sh
node scripts/benchmark.mjs
docker compose up -d --no-deps --scale worker=3 worker
docker compose logs --tail 100 evaluation worker
docker compose stop
```

Benchmark performs a bounded 1/3-worker local comparison and restores one worker. No paid calls. Results in `evidence/scaling-local.json` describe only the tested environment. Increasing replicas does not promise a performance gain. `docker compose stop` preserves data. Existing local PostgreSQL volume passwords belong to its original `.env`; keep that file with the volume. Database reset/deletion is an explicit separate operation, not part of startup.

## Real application execution

The independent support application implements a constrained chat-completions-compatible HTTPS adapter. Confirm provider permission and budget before enabling it. Add MODEL_API_URL, MODEL_API_KEY and MODEL_ID to your private local `.env`/cloud secret, and ALLOW_REAL_MODEL=true, then recreate support. No keys are in source. In the UI select `real`. Use the exact same suite for prompt v1 and v2. Retain raw job evidence and independent human rubric results.

Replay mode uses a fixed fictional policy fixture by case ID; no model is called. Imported mode evaluates caller-supplied outputs. Real mode refuses absent provider configuration and has no synthetic fallback. Provider latency is independent of platform admission latency. The capacity suite defaults to no provider-latency gate; set a justified latency policy separately for real-provider tests.

## API and consuming CLI

Public base `/api/v2`: POST/GET applications; POST/GET suites; POST/GET jobs; GET jobs/:id; POST/GET releases; POST releases/:id/review; GET evidence/:releaseId. Body contracts are authoritative in `src/domain.ts`, `registry.ts` and `governance.ts`. `Idempotency-Key` is required for job submission.

Job response is asynchronous: 202 with ID, then queued/running/succeeded/failed. Only `succeeded` plus `result.gate=passed` is eligible for review. Candidate identity, source, commit reference and immutable suite snapshot accompany evidence. Review request `{jobId,note}`; review decision `{decision,note,version}`. Machine identities cannot decide; creator/requester cannot decide their own request.

Set RELEASEGUARD_URL and RELEASEGUARD_TOKEN privately, then:

```sh
node scripts/releaseguard-cli.mjs evaluate input.json
node scripts/releaseguard-cli.mjs list
node scripts/releaseguard-cli.mjs evidence release-id
```

Exit 0: rule-eligible, not human-approved; 3: execution failed or gate blocked; 1: API/timeout/runtime error; 2: usage/configuration. All non-zero outcomes must stop a consuming pipeline. Use RELEASEGUARD_IDEMPOTENCY_KEY to bind retries to a candidate job. Approval is a record, not an external deployment action.

## Cloud path

`deploy/k8s` supplies separate Deployments/Services, resource limits, probes, rollout settings and optional KEDA scaling. Cloud platform is intentionally not selected. Provide managed PostgreSQL and RabbitMQ endpoints (TLS), trusted OIDC issuer/JWKS/claims, cluster secrets, pushed immutable images, HTTPS ingress and budgets before applying the manifests. See deployment notes. Do not apply local development JWT settings on public hosting.

`.github/workflows/ci.yml` defines clean install, unit tests, Compose integration tests, dependency scan and build. `.github/workflows/cd.yml` defines a manually approved deployment using an existing tested digest and a protected environment. Neither definition alone is evidence of a hosted run.

## Code responsibilities

- A: `public/index.html`, UAT and course/demo records. Original styled UI remains a reference; the smaller console exercises the revised contracts.
- B: `src/registry.ts`, `evaluation.ts`, `governance.ts`, `domain.ts`, shared contracts and schema behavior.
- C: `src/support.ts`, fixtures and real provider/prompt/rubric evidence.
- D: Dockerfile, Compose, `deploy/`, hosted pipelines, secret/identity and recovery setup.
- E: tests, verify/benchmark/fault scripts and raw evidence.

Own changes should be made through individual commits and reviewed PRs. Shared source/generated evidence is not member contribution. Scope is an implementation baseline, not a claim that all course evidence is already complete.
