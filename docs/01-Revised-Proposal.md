# ReleaseGuard Project Proposal

Architecting Scalable Systems Practice Module SE34FT

Team 13 | Revised architecture | 7 October 2026

This proposal describes the asynchronous microservice implementation in this delivery. It supersedes the 6 October synchronous Azure reference proposal; it does not assert completion of cloud acceptance. The operational platform is still to be confirmed. Use the current handoff and evidence index for measured local results.

## 1 Project Title

ReleaseGuard Distributed Evaluation and Release Review Platform

## 2 Project Sponsor

Not applicable. This is a self-proposed academic project. The demonstration uses a fictional retailer and non-sensitive inputs; no employer requirement or production benefit has been validated.

## 3 Project Members

- A TANG YUCHEN: requirements, frontend, user acceptance and presentation workflow.
- B ZHU PENGXU: service APIs, data ownership, evaluation and review contracts.
- C LIN XINDA: independent support application, provider adapter, fixed cases and prompt comparison.
- D LIAO CAN: containers, cloud access, CI/CD, scaling infrastructure and application-version recovery.
- E LIAO BINFENG: independent security verification, performance experiments, fault tests and retesting.

Assignments are responsibilities, not evidence of completed contribution. Actual hours, commits, reviews and outcomes will be recorded separately.

## 4 Overview

Small application teams changing an AI-assisted support application's prompt need to rerun agreed acceptance cases and retain the exact outputs and review decisions. Under concurrent candidate submissions, running each evaluation in a synchronous web request also makes provider latency and bursts difficult to manage. ReleaseGuard provides reusable acceptance assets, asynchronous evaluation orchestration, bounded execution and independent release review.

The representative scenario is a fictional retailer's returns assistant. A developer submits two prompt versions against the same ten fixed cases. The platform retains raw responses, errors, policy and suite snapshots. Deterministic rules check explicitly selected properties; a different human reviewer applies the business rubric before recording a decision. The rules are not a general semantic AI judge, and an approved record does not automatically deploy the external application.

Versioned test suites and checking policies are the seed assets. Test authors and application developers are producers. Reviewers, the independent support application and a CLI/pipeline client are consumers. The project will demonstrate actual reuse of a suite/API and record integration steps; it will not assert unmeasured productivity savings.

## 5 General Architecture

### Response to lecturer feedback

The earlier single Worker modular monolith is replaced by independently deployable, microservice-oriented business services. Horizontal scaling of evaluation execution is part of the current implementation and acceptance plan, rather than deferred future work. The original application is a reference prototype; it is not represented as this revised architecture.

### Service boundaries and deployment

- **Test Asset Service:** owns application registrations and immutable suite versions. Provides a workspace-scoped snapshot API. Its database credentials cannot access the other services' databases.
- **Evaluation Service:** owns job admission, job state, evaluation evidence and an outbox. A transaction commits a job and its outgoing message together. A publisher forwards messages to a durable queue with publisher confirmation.
- **Evaluation Workers:** replicas of the execution component within the Evaluation Service boundary. They claim jobs using leases, call the separate support application or evaluate supplied outputs, save final results conditionally and acknowledge deliveries. Workers can scale independently of asset and review services.
- **Review and Evidence Service:** owns review requests, terminal decisions and audit events. It obtains completed job evidence through an authenticated API and stores its own snapshot. It cannot directly query another service's database.
- **Independent Support Application:** owns the fictional policy and prompt versions and adapts one authorized external provider. Real execution is separate from explicitly labelled replay fixtures. Provider calls never silently fall back to fabricated success.
- **Gateway and Console:** route the versioned public API and provide submission, results and review screens. All business services validate user identity themselves. Internal calls use short-lived audience-bound service credentials.

The local implementation uses Node.js/TypeScript containers, PostgreSQL databases with separate logins, and RabbitMQ. A cloud deployment will use container orchestration, HTTPS ingress, trusted identity, managed storage/broker where available and independently versioned deployments. Kubernetes manifests and an optional queue-based KEDA scaler are supplied as a portable starting point; cloud provider selection and account access remain open dependencies.

The services are independently deployable even though the course code initially shares one repository and reusable library. Deployments select different process entry roles; changes do not require a single running process. Each service owns its schema and data. Only the Evaluation Service and its execution replicas share its database.

### Scalability and tradeoffs

Execution workers are stateless between jobs; leases and evidence reside outside container memory. Queue depth provides backpressure and a workload-related scaling signal. Adding execution replicas can distribute independent jobs without changing the frontend or review service. Actual throughput may instead be bounded by submission overhead, database writes, broker operation or external-provider quotas. The team will measure these limits rather than infer scalability from architecture diagrams.

This architecture adds asynchronous states, duplicate deliveries, partial failure and operational overhead. Transactional outbox, bounded attempts, expiring leases, retry-safe submission and conditional final writes address these risks. At-least-once delivery is used; exactly-once provider execution is not promised. Worker crash recovery may repeat provider calls, which has cost implications and must be bounded in real-provider experiments.

Availability remains limited by the selected database, broker and identity infrastructure. The initial local broker is a single node. Container restart tests do not establish regional disaster recovery or a cloud SLA.

## 6 Scope of Work

### Representative use cases

1. Register an independent support application and create a versioned suite; append a new version without rewriting old evidence.
2. Submit a candidate with an idempotency key. Commit and enqueue a job, execute the fixed cases asynchronously and retain the actual output or explicit error.
3. Block missing evidence or critical failures. Make the consuming CLI/job return a non-zero status when evaluation is unsuccessful or blocked.
4. Request independent human review of a completed passing run. Reject self-review, service-identity approval and stale/conflicting decisions.
5. Compare prompt v1 and v2 using the same suite, with provider errors/latencies and a separate human rubric. Export the candidate, suite, results and decision history.
6. Increase worker replicas under controlled load, observe task distribution and measure queue wait, completion latency and throughput. Demonstrate automatic scaling on the chosen cloud environment.
7. Terminate a worker during an outstanding job and verify bounded recovery without duplicate final evidence; restart services and verify committed evidence persists.

### Course evidence and acceptance

- **Software architecture:** logical and physical views, service/data ownership, representative sequence, alternatives and consequences, security/availability/performance/maintainability strategies.
- **Platform engineering:** an independently running application plus CLI use the same registration, suite, job and evidence APIs. Record reused cases, steps and measured onboarding effort.
- **Cloud native:** cloud deployment identifiers, nodes/network paths, secrets and identity boundaries, readiness/liveness, resource limits, worker replica changes and storage persistence.
- **Scalability:** identical workload and resource specification for 1/3/5-worker comparison where budget permits; report endpoint submission latency, queue wait, job completion p50/p95, jobs/second, error/gate outcomes, workers used and database growth. Capture automatic scale-up/down and disclose its trigger and lag.
- **DevSecOps:** a real hosted CI run at an exact commit, clean locked installation, build and meaningful tests, dependency/image scan, immutable image digest, approved deployment, post-deployment smoke checks and application-version rollback. A failing gate must stop promotion.
- **Security:** verify trusted authentication, tenant isolation, viewer write denial, independent review, machine-review denial, bounded inputs, service authentication and confidential credential handling using distinct identities.
- **Project conduct:** WBS, estimated/actual member effort, actual milestone outcomes, progress reports and evidence links. The formal report follows the supplied course template.

### Experiment design

Freeze ten fictional returns cases covering eligibility, missing information, damaged products, policy expiry, privacy, fabricated actions, escalation and format. Run two prompts once on an approved provider, retain unedited outputs and review against a fixed human rubric. Deterministic pass rate and human semantic judgement remain separate.

Run capacity experiments using bounded, labelled pre-recorded or imported output workloads, without repeating paid provider calls. Begin with 100 and 1,000 ten-case jobs, recording both job count and embedded case count. Test admission/API behavior and execution capacity separately. Use equal submission concurrency and per-container CPU/memory for the replica comparison. Include queue-depth/replica time series and a steady-state workload when the cloud budget permits. A proposed cloud target is p95 job completion below 5 seconds for the agreed replay workload at ten submitting clients, with unexpected errors below 1%; this is a target for review, not an achieved result or a real-model latency commitment.

Before cloud tests, D/E establish an isolated workspace, authorized targets, cost/request limits, duration and stop conditions. Preserve raw data, environment, image digest and exact command. If extra replicas do not improve the result, identify the limiting resource and report it. Manual scaling is distinct from automatic scaling; local results are distinct from cloud results.

### Out of scope and dependencies

Excluded: model training, autonomous refund/order execution, real customer data, broad semantic judging, billing, service mesh, multi-region disaster recovery, tamper-proof audit storage and additional industry demonstrations. Existing UI styling is secondary to the required evidence.

Cloud accounts/permissions, OIDC claim provisioning, provider access and budget are not yet confirmed. Real-provider execution and hosted deployment remain incomplete until actual evidence exists. On a blocked dependency the team will record the issue, reduce optional scope and obtain a lecturer scope decision if needed; simulated evidence will not be relabelled as live results.

## 7 Effort Estimates and Schedule

Total estimate: **50 person-days**, ten per member. Each member has seven specialist days and three shared days for integration, peer review, report and rehearsal. These are estimates, not actual contribution records.

- **A, 7 specialist days:** requirements/acceptance flows 2; console adaptation 3; UAT and correction 2.
- **B, 7 specialist days:** service/data contracts 2; persistence/idempotency/approval implementation 3; integration and defect fixes 2.
- **C, 7 specialist days:** independent application/provider adapter 2; cases/rubric/prompts 2; real execution, comparison and failure analysis 3.
- **D, 7 specialist days:** cloud and identity access 2; CI/CD and deployment 3; scaling/recovery evidence 2.
- **E, 7 specialist days:** security/load methodology 2; controlled cloud and failure tests 3; bottleneck analysis and retest 2.
- **Shared effort:** five members × three days = 15 person-days.

**Sprint 1, 8–13 October:** a complete independent-app evaluation and review workflow, independently deployed services, cloud increment and hosted CI record. Confirm cloud/provider/identity access first. Missing dependencies remain explicit.

**Sprint 2, 14–20 October:** measured cloud workload, replica/automatic-scaling evidence, fault/recovery tests, priority UAT and report sections. Review and retrospective at each Sprint end.

**21–25 October:** freeze the demonstration candidate, rehearse the course presentation and retain a recovery plan. Team 13 is scheduled for **26 October 2026, 09:45–10:25 Singapore time**, subject to subsequent course notices. Suggested 40-minute allocation follows the course guidance: overview 3, conduct 2, logical architecture 9, physical architecture 9, DevOps 7, demo 10 minutes; Q&A is included in those durations.

Final report: **16 November**, incorporating presentation feedback. Submit fortnightly progress reports to the course Canvas assignment with completed work, member hours, issues and the next two weeks' plan.

## AI Use Declaration

We used OpenAI Codex to assist with revision of the proposal, architectural analysis, code and test generation, and documentation. Team members will review the implementation, verify claims, record their own contributions and remain responsible for the submitted work. Generated source and test outputs do not establish individual student effort.

## References

Course sources: 01 Briefing.pdf; 02 Project Report Template for Practice Project.docx; 04 Project Presentation Guidelines & Schedule.pdf; lecturer email supplied by Team 13 concerning modular monolith and horizontal scalability.

Technical sources: [Microsoft domain analysis](https://learn.microsoft.com/en-us/azure/architecture/microservices/model/domain-analysis), [RabbitMQ confirmations and acknowledgements](https://www.rabbitmq.com/docs/confirms), [Kubernetes horizontal autoscaling](https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/), [KEDA RabbitMQ scaler](https://keda.sh/docs/2.21/scalers/rabbitmq-queue/).
