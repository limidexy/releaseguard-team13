# Local resilience and observability verification

Added 21 October 2026. This is a separate, localhost-only course lab. It does not update localhost:5193, deploy to GKE, call a model, dispatch CI/CD or qualify the semantic reviewer.

## Implementation

- `src/circuit-breaker.ts`: closed/open/half-open state, bounded probe lease, stale-completion protection and fail-closed store access. PostgreSQL row locks serialise admission across independent adapter instances. Support uses this shared, Support-owned store when `SUPPORT_DATABASE_URL` is set. The memory fallback protects only one process. Neither is a distributed rate limiter or model-quality classifier.
- `src/observability.ts`: explicit OpenTelemetry HTTP, publisher and consumer spans. W3C context is persisted with job/outbox metadata and carried in AMQP headers, including recovery publications. Prompts, response bodies, bearer tokens and query strings are not span attributes. Business evidence is separate from request tracing.
- Structured application logs include service, event, traceId and spanId. HTTP completion events record route patterns rather than raw URLs. Alloy reads only the lab log directory and forwards to Loki. Grafana offers a local read-only dashboard, failure counts and log-to-trace links. No Docker socket is mounted.

## Launch

Use Node.js 24 and Docker Compose, from the repository root:

```sh
npm ci
npm run build
node scripts/observability-lab.mjs pull
node scripts/observability-lab.mjs start
node scripts/observability-lab.mjs verify
```

Private random credentials live in ignored `.local/observability-lab/private.json`. Never share or project it. The launcher runs six current-build Node processes and isolated PostgreSQL/RabbitMQ/Jaeger/Loki/Alloy/Grafana containers. Real-model configuration is empty/disabled. The contexts use separate database roles/databases. Existing application volumes and cloud resources are not reused.

- Application: `http://localhost:54993`
- Jaeger: `http://localhost:54686/trace/<traceId>` (ID in result)
- Grafana: `http://localhost:54300/d/releaseguard-local`
- Results: `.local/observability-lab/verification.json`

Application tokens require the matching local identity, generated privately and never packaged. Jaeger/Grafana need no model key. Do not expose their anonymous read-only views publicly. For class, open the saved evidence first. `verify` creates a new synthetic replay job and local HTTP fault fixture. It sends no inference request, but it must not be described as historical real-model playback.

```sh
node scripts/observability-lab.mjs stop
```

This stops only the isolated lab. Never use `down -v` or alter existing course containers. After a partial start failure, stop this lab and inspect its named logs before deliberately restarting. The lab has no production restart/HA/retention policy. Jaeger storage is transient; Loki data lives in its lab container. Saved delivery evidence survives stopping the lab.

## Actual results, 21 October

- Focused tests 6/6. Full regression 782/783, with the same rejected `evaluator-next-v1-holdout-v2` failure. It was not deleted, skipped or weakened. The production Dockerfile still stops on the full test gate.
- Local rehearsal 19/19. One replay job produced 9 spans across Gateway, Evaluation, Registry, Worker and Support; publisher and consumer share its trace. A Loki query returned records from all five services.
- Two independent adapters with separate PostgreSQL pools and a shared key: 3 local HTTP 503 responses opened the circuit. Twenty concurrent calls sent zero HTTP requests. Two recovery contenders admitted one probe; its success closed the circuit. The next call succeeded. Total fixture HTTP requests: 5, not Groq requests.
- Fixture settings: threshold 3, cooldown 300 ms, probe lease 2 s. Support defaults: threshold 3, cooldown 30 s, probe lease 25 s. Unit tests include abandoned probes and late completion. Provider limits remain authoritative.
- Auth/cookie/query canaries were absent from the six application log files. This is a bounded check, not a guarantee against every possible secret.
- Dependency audit had zero known findings at execution. OpenTelemetry is pinned/locked. The SDK v2 package names have upstream deprecation notices. No container-image security certification is claimed.

The first aggregation run failed on an unwritable default Loki directory. Its failure log is retained. The config now uses `/tmp/rg-loki`; the subsequent end-to-end query passed. This does not rewrite any model experiment.

## Presentation and limits

New PPT slides 17–19 show these mechanisms in the supplied style. Say: “actual local technical verification using synthetic replay and a local failure fixture.” Inspect the saved Jaeger publisher/consumer timeline and matching Loki trace query. The browser recording is short backup footage, not a full narrated presentation.

No new GKE/production test, real-provider outage test, alert notification, sustained load/retention test or SQL instrumentation is claimed. Normal Compose/cloud environments still need their telemetry endpoint and Support database configured explicitly. This feature-branch candidate is not a cloud deployment or release. The [presentation pack](../../docs/presentation/20261021/) records the selected local evidence and publication scope. Historical customer scores 70/75, unavailable originals and reviewer `calibration_pending` / `shadowOnly=true` remain unchanged.

References: [OpenTelemetry exporters](https://opentelemetry.io/docs/languages/js/exporters/), [Jaeger setup](https://www.jaegertracing.io/docs/2.22/getting-started/), [Alloy file collection](https://grafana.com/docs/alloy/latest/reference/components/loki/loki.source.file/).
