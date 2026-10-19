# Presentation and demo runbook — 40 + 5 minutes

This is a rehearsal plan, not evidence of a new live demo. Prepared 19 October 2026.

## Safe environment

Use the existing local course stack only after the team has checked the correct Compose project, port and volumes. The current README entry uses localhost:5193; old 5189 instructions are historical. Never delete volumes for rehearsal. Do not expose tokens in slides or recordings. No new model inference, cloud startup or deployment is needed to replay saved evidence.

## CI/CD — 11 minutes

1. 1.5 minutes: explain `.github/workflows/ci.yml` and `cd.yml`: locked dependencies, tests, container contracts, dependency/image scan, tested artifact identity, manual deployment with matching CI/SHA.
2. 7 minutes: show source branch/diff, verified baseline CI 38709382103 at 20d258d and the fresh local 776/777 result. For image/source deployment binding, switch to the separate matched CI 38148253863 / CD 38148479735 pair at 362e8dd, followed by a historical failed-promotion example. Do not link the B-baseline CI to a deployment of another commit.
3. 2.5 minutes: show dated image rollback and separate same-instance logical database restore. Manual dispatch is not evidence of independent human deployment approval.

Current feature publication is not a successful CI/CD run. Do not remove the retained holdout test or claim that an unexecuted/skipped workflow passed.

## System demonstration — 14 minutes

1. 1 minute: announce source labels: replay, imported and historical real-provider evidence.
2. 4 minutes: register the app, create a suite version, submit labelled replay, inspect asynchronous status and gate result. Execution completed does not mean rules passed.
3. 3 minutes: passing review request, different local test identity, stale decision conflict, evidence export and predecessor link. These identities are not verified human UAT. Contributor permission denial alone does not prove the owner self-review invariant.
4. 2 minutes: inspect original r4 model answers and the frozen 70/75 scores; no hidden retry or post-generation rewriting.
5. 3 minutes: inspect the two separate v3 experiments, one correct answer and one violation, rule status, quote and derived position. Shadow allow does not authorise formal customer delivery.
6. 1 minute: historical replay scaling data and caveats. Queue-driven scaling control under fault stimulus is not evidence of sustained model throughput.

## Backups and rehearsal

Before presentation, record and test two backup videos: CI/CD and system demo. Suggested names: `ReleaseGuard_CICD_Backup.mp4` and `ReleaseGuard_System_Demo_Backup.mp4`. These videos were not produced in this handoff. If switching to a recording, state its date/source; do not pass it off as a new live call.

Rehearse 38 minutes of content plus 2 minutes interruption/switching buffer; reserve 5 additional minutes for Q&A. Confirm the latest course timing notice. A/B/C/D/E should each explain their own responsibilities, evidence and limitations. Actual work hours and final review decisions require genuine member records.
