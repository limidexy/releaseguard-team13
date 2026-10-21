# ReleaseGuard: 21 October local resilience update

[Updated editable presentation](ReleaseGuard_Presentation_v3_20261021.pptx) · [Local lab instructions](../../../deploy/observability/README.md)

本次是功能分支的代码与演示资料更新，不是云端部署或生产发布。保留原有五人分工，没有生成组员独立提交、审核或贡献的记录。实现、测试与资料整理使用 Codex 辅助；这不是独立人工评审证明。

## What changed

- Shared provider circuit breaker: closed/open/half-open, PostgreSQL admission across adapter instances, a bounded recovery probe and stale-completion protection. Without the Support database configuration, the fallback is process-local.
- Explicit OpenTelemetry tracing across HTTP and RabbitMQ publisher/consumer boundaries, with job/outbox trace context retained for recovery.
- Structured logs collected by Alloy into Loki, with a local Grafana dashboard and log-to-trace navigation. No alert notification is claimed.
- Slides 17–19 explain these additions in the supplied presentation style. The deck has 22 main slides and 5 hidden backups; plan 35 minutes of content and 5 minutes of questions, within the supplied 40-minute course slot.

## Evidence and limits

| Check | Recorded result | Evidence |
| --- | --- | --- |
| Focused circuit/tracing tests | 6/6 passed | [Test log](evidence/targeted-tests.log) |
| Full regression | 782/783; retained evaluator acceptance failure | [Redacted full log](evidence/full-regression-public.txt) |
| Isolated local integration | 19/19 checks; 5 services, 9 spans; correlated logs | [Verification](evidence/verification.json), [trace](evidence/trace.json), [logs](evidence/aggregated-logs-public.json) |
| Shared circuit recovery | 3 fixture failures; 20 calls rejected without HTTP; one recovery probe; 5 total fixture HTTP requests | [Verification](evidence/verification.json) |
| Clean incremental patch | Locked install, build and 6 focused tests passed | [Patch verification](evidence/patch-verification.json) |
| Dependency audit | Zero known findings at the recorded execution | [Audit](evidence/npm-audit.json) |
| Browser pages | No page errors in the bounded check | [Browser check](evidence/browser-check.json) |

The full-regression failure is `evaluator-next-v1-holdout-v2`. It remains a failed acceptance check; the production Dockerfile still requires the full test gate. This update does not claim a green CI or release readiness. The complete test suite was not rerun just for publication: the 22 delivered implementation/configuration files were compared with the tested package and all hashes matched before the two README publication notes were updated.

The first Loki run failed because the default directory was unwritable. Its [redacted failure record](evidence/local-lab-first-failure-public.txt) is retained; the subsequent local query succeeded with the configured directory. Log field selection, path redaction and removal of trailing spaces affect only publication copies, not source records or test outcomes. [Jaeger screenshot](evidence/trace-ui.png) and [Grafana screenshot](evidence/logs-ui.png) are captured local UI evidence.

These are actual **local technical checks using synthetic replay and a local HTTP failure fixture**. They are not new Groq calls, a real-provider outage test, historical real-model playback, or cloud scalability validation. No model/reviewer inference or cloud deployment was performed for this update.

Historical customer scores 70/75, unavailable originals and old experimental results are unchanged. The reviewer remains `shadowOnly=true`, `calibration_pending`; it is not enabled for customer release decisions.

## Publication scope

Base: `429b83ffd240f97cc7e352b916c5d84d6154178a`. Target: `feat/c-review-v3-handoff-20261019`. This update includes implementation, focused tests, the editable PPT and the selected evidence here. It excludes private lab credentials, local runtime state, unrelated untracked handoff archives and dependency/build directories.

[History preservation](evidence/history-preservation.json) describes the **pre-publication** snapshot; its `noCommitOrPush` field is a historical observation, not the later branch publication status. The earlier ZIP/manifest also remains the unchanged pre-publication package. The commit containing this directory records the published source revision.

The workflow configuration is unchanged: push CI targets `main`, PR events and manual dispatch; cloud deployment is manual only. Uploading a feature branch must not be presented as successful hosted CI. No automatic merge, deployment or workflow dispatch is part of this update.
