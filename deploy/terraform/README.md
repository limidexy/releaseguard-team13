# ReleaseGuard disposable GKE rebuild

Terraform creates a fresh zonal GKE Standard cluster in an approved existing GCP project. The trial preserves the historical Singapore zone, two-node test shape, 30 GiB boot disks, and the in-cluster Postgres, RabbitMQ, identity and edge architecture. It uses a dedicated VPC, private nodes with Cloud NAT, a Kubernetes API restricted to one operator IPv4 address, a regional static edge IP and a separate Artifact Registry repository. These network and identity choices can differ from the historical project. The Kubernetes edge Service creates the load balancer. Cloud SQL is outside this topology.

## Offline verification

From the repository root, with Terraform installed:

```sh
terraform -chdir=deploy/terraform fmt -check -recursive
terraform -chdir=deploy/terraform init -backend=false -input=false
terraform -chdir=deploy/terraform validate
terraform -chdir=deploy/terraform test
```

The tests mock the Google provider and check the default zero-node plan and the two-node test plan. Provider installation requires network access. These checks prove configuration and plan behavior only.

## Approved cloud run

1. Use a new resource name and separate protected state in the approved project. Agree on the spend ceiling, operator CIDR, time window and teardown owner before provisioning. Even with zero workload nodes, the cluster, registry, address, NAT, volumes and load balancer can incur charges. Terraform requires operator application-default credentials and permissions to enable services, manage the declared resources and bind the dedicated node account. Keep project-specific variable files and state private.
2. Provide `project_id`, `operator_cidr` and the fresh `name` through a private variable file. Start with `node_count = 0`. Run an authenticated plan, review its resource changes, then apply only the reviewed saved plan. Retrieve `terraform output -json deployment_inputs`, and pin the application image in the new registry to the digest of the CI-tested build. When the test window begins, review and apply a plan with `node_count = 2`.
3. Get credentials for the **new** cluster and verify the current context, project, zone and two Ready nodes before applying Kubernetes resources. Point an approved TLS hostname at the new `public_ip`. Prepare the infrastructure-renderer input with `publicOrigin`, the Terraform `public_ip` and `pod_cidr` as `publicIP` and `podCIDR`, `storage_class` as `storageClass`, an approved clock-skew bound as `clockSkewBoundMs`, and pinned `postgres`, `rabbitmq`, `identity`, and `edge` image digests in `images`.
4. Render the infrastructure with `node scripts/gcp-render-infra.mjs --offline --config <infra.json> --run-id <new-uuid-v4>`. Prepare **new** identities and secret material with `scripts/gcp-bootstrap.mjs`, using its documented private inputs and `--ack-new-realm-only`. Apply the rendered infrastructure list and the bootstrap's private `secrets-new-realm-only.json` to the verified new context. Use server-side apply for Secrets to avoid storing a client-side copy in last-applied annotations. Never retain or publish Secret manifests as evidence.
5. Use the renderer's `servicesRendererEnv` values and the tested `RG_IMAGE` digest with `node scripts/render-cloud.mjs`, then apply its `deploy/k8s/rendered/services.yaml`. Verify all six application rollouts and the three persistent volumes. Confirm RabbitMQ's runtime permissions in the `releaseguard` vhost for the application queue. Install the approved KEDA 2.21 release in namespace `keda`, then apply [the trial scaler](k8s/worker-autoscale.yaml). It includes the KEDA-only management port policy and the broker CA reference. Check that the ScaledObject is Ready and that the HPA can read the queue metric before running any scaling experiment.
6. Record commit, tested image digest, the sanitized plan summary, cluster/zone and node states, deployment rollouts, PVC binding, HTTPS and an authorized replay smoke result with real model calls disabled. For a claim about scaling, separately record Worker pod placement, queue depth, HPA transitions and task completion. A clean rebuild does not establish performance gains or restore historical data.
7. After the window, scale the new node pool to zero through Terraform and verify the node pool and Compute Engine instance counts. To end the disposable environment, remove its edge Service and Kubernetes volumes after reviewing their data-retention needs, then review a Terraform destroy plan for the new state only. Verify that its forwarding rule, disks, static address, NAT and other billable resources are gone. Never import or destroy the historical trial under this state.

The repository CI has no cloud write permissions. A live reconstruction is recorded only after the new cluster and the application smoke checks have passed.
