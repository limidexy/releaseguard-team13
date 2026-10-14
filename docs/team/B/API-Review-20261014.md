# B API and review verification

Date: 14 October 2026. Responsibility: B, ZHU PENGXU. GitHub account: Robinsonson.
Baseline: `e94d4f1c1b438a90551c18f832c7844e1a822df2`, from `feat/local-course-evidence`.
Task branch: `feat/b-api-review`.

Codex read the B handoff, inspected the implementation, ran the commands and prepared these changes at the user's instruction. This is AI-assisted engineering evidence, not a claim that the student independently performed every command, that a teammate approved the work, or that a new cloud/model experiment occurred. Actual student time and personal review remain to be recorded by the student.

## Change and rationale

The existing backend already implements workspace-scoped admission, service-owned databases, immutable job snapshots and independent review. No business implementation was rewritten to generate a contribution. This task extends the existing contract test with four additional groups that verify persistence consequences, and corrects three outdated DDD statements.

The new checks prove that repeated committed submissions keep one job and one outbox record, changed payloads conflict without altering stored evidence, rejected submission attempts create no records, rejected review commands leave pending state and audit unchanged, and competing reviewers commit one matching decision audit. Existing CI already calls `scripts/verify-contracts.mjs`, so these assertions are included without editing the workflow.

Two Windows failures prevented the documented local workflow. The first fresh stack failed while sourcing a CRLF bootstrap script. `.gitattributes` now forces LF for shell scripts and hooks. After normalising the local bootstrap and rebuilding its image, a second fresh Compose project started successfully. The first project's volumes were retained, not erased. The pre-push runner also failed to launch `npm.cmd` directly with `EINVAL`, leaving its unit exit code null. It now invokes a fixed `npm test` command through `cmd.exe` on Windows and retains a launch error when applicable. Linux/macOS still invoke npm directly.

These compatibility files are shared with D. D should review them; E should review the test assertions, and C should review the interpretation of output and scoring contracts. No review has been requested from an unidentified account or represented as complete.

## Backend and DDD findings

Registry owns applications and immutable suite IDs in `rg_registry`. Its parent reference stays within Registry. A version number is a display label, not a global sequence across branches. Evaluation copies the suite and application through the authenticated snapshot API; it does not query Registry tables. Job and outbox creation share one local transaction. Idempotency belongs to the workspace/key pair, and the canonical request hash distinguishes a retry from a conflicting payload.

Workers belong to Evaluation and use `rg_evaluation` for claims, leases and results. They are scalable execution processes, not another bounded context. Replay/imported jobs may execute at most three attempts. A real job permits one attempt; subsequent recovery marks failure instead of calling the runner again. No real job was submitted here. This behaviour was inspected in code; the new HTTP checks do not simulate a real-provider failure. An explicitly resubmitted real job can incur a new call and requires coordinated authorization.

Review owns `rg_governance`. A request first copies completed passing evidence through Evaluation's API. The subsequent decision uses its captured local evidence, allowing it to proceed during an Evaluation outage. The HTTP layer checks roles and workspace; the aggregate checks pending state, passed gate, creator/requester separation and expected version. A row lock serializes competing reviewers. The decision update and corresponding audit insertion share one database transaction. This does not constitute a cross-service transaction or deployment approval.

The scoring contract accepts the five general rules and the versioned `returns_policy_v2` / `returns_policy_v2_1` rules. Execution success is distinct from a passed gate. Empty/error outputs block the gate, and imported data stays caller-supplied. The strict JSON check requires an object with its own configured keys; the returns format criterion additionally checks field types and nonempty values. No prompt, fixture, evaluator version or historical model score was changed. `docs/12-Real-Retest-20261011.md` remains historical team evidence, not a new result from this task.

## Commands actually run

The local environment is Windows with Node 24.19.0 and Docker 29.8.0. The fresh LF-corrected project is `rg-b-api-review-lf-20261014`. The gateway is loopback-only at `http://localhost:5193`; model execution is disabled by the fresh default configuration.

```powershell
npm ci --no-audit --no-fund
npm test
node --test tests/image-identity.test.mjs
node --check public/app.js
node scripts/setup-local.mjs
git config core.hooksPath .githooks

# Use the same project name for all Compose operations in this checkout.
$env:COMPOSE_PROJECT_NAME='rg-b-api-review-lf-20261014'
$env:RELEASEGUARD_URL='http://localhost:5193'
docker compose build gateway postgres
docker compose up -d --no-build --wait
node scripts/verify.mjs --restart
node scripts/verify-contracts.mjs
node scripts/prepush.mjs
```

The initial build used the default Windows CRLF checkout and failed during database bootstrap. The corrected run rebuilt PostgreSQL after fixing LF endings and reused the unchanged application image. Application source was not changed in this task. The two fresh projects had independent volumes; prior project data was not reused to make bootstrap appear successful.

## Results and retained evidence

- Unit and adapter tests: 138 passed, 0 failed; also executed by the corrected pre-push runner.
- Image-identity test: 1 passed. Frontend JavaScript syntax check passed.
- Local integration/security/restart checks: 18 groups passed, 0 failed.
- Extended local DDD/API contracts: 9 groups passed, 0 failed, including four newly added groups.
- Forbidden review commands returned 403/404/409/400 as appropriate and left the entire evidence response unchanged. Concurrent decisions returned one 200 and one 409, with one matching terminal audit.
- Evaluation-owned read-only SQL confirmed one persisted job and one outbox row after repeated submissions and a rejected payload conflict.

See [summary](evidence/2026-10-14/summary.json), [integration results](evidence/2026-10-14/integration-local.json), [contract results](evidence/2026-10-14/ddd-contracts.json) and [corrected pre-push report](evidence/2026-10-14/pre-push-fixed.json). These are new local executions on 14 October, distinct from the repository's older evidence. The pre-push report identifies the baseline HEAD because it ran before committing the tested working changes.

## Limits and next review

No cloud resources, model calls, load/scaling benchmark, independent human scoring or database restore were executed. Development identities simulate roles and are not separate human approvals. No conclusions about complete system security follow from these groups. Backend endpoints and schema remain unchanged.

The local persistence checks use the Evaluation service's own login; production services still obtain other contexts' data through APIs. Recorded evidence contains only fictional fixture data and test identifiers, not tokens or `.env`. Retention policy, release supersession requirements and provider consumption changes still need actual team decisions. GitHub CI results belong to the PR's actual run; local results must not be described as remote CI. The PR base remains `feat/local-course-evidence`, and merging requires a real teammate's review.
