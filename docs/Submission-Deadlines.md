# Submission deadlines and cancellation

The public submission entry point remains `POST /api/v2/jobs` through Gateway.
Gateway issues a signed, request-bound ten-second deadline and replaces incoming
internal-context headers. Evaluation carries the original deadline into Registry
snapshot reads. Direct Evaluation submissions and internal snapshots require the
corresponding signed context; there is no unsigned fallback.

## Clock configuration

Evaluation and Registry require `SUBMISSION_CLOCK_SKEW_BOUND_MS`: an integer from
0 through 9999 giving a justified maximum wall-clock difference from Gateway.
The receiver deducts that bound before using its local monotonic clock for the
remaining budget. Missing or invalid configuration fails service initialization.

Local `compose.yaml` sets 0 because these containers share the same host clock.
For a deployment on different hosts, establish and configure an appropriate bound
on both services before rollout. The existing cloud manifests and rendering
script do not supply it; do not copy the local zero into a distributed deployment.

## Admission and uncertain outcomes

Cancellation is checked before borrowing a PostgreSQL client and again before
dispatching SQL. After dispatch, disconnecting does not prove a transaction was
rolled back. A lost response therefore reports `submissionState: "unknown"`
and `automaticRetry: false`; Gateway never resends the POST automatically.
`GET /api/v2/jobs/submissions/:key` is an authenticated, workspace-scoped read.
A missing record has `definitive: false` and does not authorize resubmission.

One PostgreSQL statement reserves the existing principal/workspace quota and
inserts both job and outbox intent. An insert error rolls back the whole
statement. `MAX_JOBS_PER_MINUTE=0` continues to disable admission with HTTP 429.
This change does not establish a throughput improvement or a cloud clock bound.

## Verification

`npm test` builds and runs unit and route tests, including controlled loopback
HTTP and database/broker substitutes. It does not start external services.

For real PostgreSQL and RabbitMQ integration, start a disposable local Compose
project with `COMPOSE_PROJECT_NAME` set, generate its private `.env` with
`node scripts/setup-local.mjs`, then run:

```sh
RG_SUBMISSION_INTEGRATION=1 RELEASEGUARD_URL=http://127.0.0.1:5189 node scripts/verify-submission.mjs
node scripts/verify.mjs --restart
```

Keep the same project, Compose-file settings and endpoint for both commands.
The submission check creates synthetic applications, suites and imported jobs.
It checks HTTP idempotency, signed deadlines, tenant isolation, concurrent quotas,
and actual database rollback after duplicate-key and outbox failures. It does not
call a model, deploy to a cloud, or reproduce a real network failure after commit.
