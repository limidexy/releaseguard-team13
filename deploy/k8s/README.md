# Cloud deployment requirements

These files are templates and a manifest generator, not a record of deployed cloud infrastructure. No cloud platform/account is selected. Use a Kubernetes cluster only if the team can operate it within the course schedule; managed container platforms with queue-based scaling can implement the same boundaries.

## Before deployment

1. Choose approved cloud/registry/cluster, budget, namespace, TLS ingress and a trusted identity provider. Configure issuer-managed `sub`, `workspace`, `role` (owner/contributor/reviewer/viewer), `service` claims and audience `releaseguard`; service identities also require an issuer-bound human `principal` for accountable submission/request. Cloud validation currently supports RS256. No client may assign its own workspace/role/principal.
2. Provision three PostgreSQL databases/non-superuser logins with exclusive CONNECT grants. Use TLS with server certificate verification (e.g. connection-string `sslmode=verify-full` with required CA trust configured). Supply private endpoints; do not expose PostgreSQL/RabbitMQ publicly.
3. Provision a durable RabbitMQ queue accessible by evaluation/worker, TLS AMQP, and an HTTPS management endpoint if using KEDA. Local single-node durability is not broker HA. Establish backups and permitted test limits.
4. Create namespace `releaseguard` and external secrets: `rg-registry`, `rg-evaluation`, `rg-governance` each contain its own `DATABASE_URL`; `rg-broker` contains `AMQP_URL` and `KEDA_MANAGEMENT_URL`; `rg-internal` contains a random >=32-character `INTERNAL_SECRET`. Optional `rg-provider` contains MODEL_API_URL, MODEL_API_KEY, MODEL_ID and ALLOW_REAL_MODEL. Do not store real secrets in repository or workflow logs. For live cloud use, scope broker permissions to the relevant queue/vhost and consider distinct service signing keys.
5. Push the image built and tested by CI; obtain its immutable digest and associated source commit. `RG_IMAGE` must be `registry/repository@sha256:...`.

## Render and apply

Set RG_IMAGE, PUBLIC_ORIGIN, AUTH_ISSUER and OIDC_JWKS_URL through the deployment environment. Then:

```sh
node scripts/render-cloud.mjs
kubectl apply -f deploy/k8s/rendered/services.yaml
kubectl -n releaseguard rollout status deployment/registry
kubectl -n releaseguard rollout status deployment/evaluation
kubectl -n releaseguard rollout status deployment/governance
kubectl -n releaseguard rollout status deployment/worker
kubectl -n releaseguard rollout status deployment/support
kubectl -n releaseguard rollout status deployment/gateway
```

Generated file does not include storage provisioning, secrets or Ingress. Configure HTTPS ingress to `gateway:8080`, exact PUBLIC_ORIGIN and a provider-specific network policy. Internal runner service remains `http://support:8080/execute`; cloud real-provider egress is HTTPS. In-cluster HTTP must remain on private networking and can be hardened to TLS under the chosen platform policy. Network policies must account for DNS, JWKS, provider egress and private DB/broker endpoints; a generic allow-all policy is not shipped as security evidence.

## Horizontal expansion and autoscaling

Manual: `kubectl -n releaseguard scale deployment/worker --replicas=3`. Confirm distribution by worker IDs and measure the same workload. This proves replica operation only.

Automatic: first install an approved stable KEDA release and its CRDs, configure the management URL secret, then apply `worker-autoscale.yaml`. It uses QueueLength including unacknowledged work over the HTTP management API, threshold ten messages per replica, min one/max five, polling five seconds and conservative scale-down. Validate these settings against the installed KEDA version. Do not enable a second HPA targeting worker. Observe queue depth, replicas, pending Pods and completion latency under sustained load; no automatic scaling claim is valid without that actual trace.

The local ten-case deterministic workload is cheap. A short test may drain before an autoscaler reacts. Use legitimate sustained arrivals and realistic workloads, record submission/database limits, and disclose when no worker bottleneck emerges. Do not add artificial sleeps or irrelevant CPU work to force a favorable result.

## Delivery and recovery

Deploy the tested digest after protected-environment approval. Run `scripts/cloud-smoke.mjs` with an authorized token, verify login/roles with a second real identity, and retain commit/digest/rollout/smoke evidence. Cloud smoke creates isolated test records; it is not read-only. It requires an explicit run flag and target allowlist.

Recover the previous application digest through rolling deployment and rerun smoke. Rollback of code does not restore data or prove RPO/RTO. Destructive schema changes require separate versioned migrations; initial CREATE IF NOT EXISTS bootstrap is for a new database. Worker scale-down or node failure may require lease expiry/retry and may repeat external provider calls. Test this with replay before any paid provider workload.

See [KEDA stable RabbitMQ guidance](https://keda.sh/docs/2.21/scalers/rabbitmq-queue/) and [RabbitMQ delivery reliability](https://www.rabbitmq.com/docs/reliability).
