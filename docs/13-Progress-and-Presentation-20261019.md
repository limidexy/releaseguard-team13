# ReleaseGuard progress and presentation handoff — 19 October 2026

This is a whole-project status record, not a claim that the semantic-review extension is production-ready. Prepared with ChatGPT assistance; member effort and independent approval must be supplied by the actual participants.

## Current handoff

The dedicated branch `feat/c-review-v3-handoff-20261019` starts from B's `20d258d891935b2d5bee3375ebf81b2872adf76f`. It preserves A/B history and adds the accumulated C-side evaluation/semantic-review implementation, tests and dated evidence. It does not merge into `main`, update B's branch, activate the Hybrid path, deploy the application, or authorise more provider calls.

The core platform contains versioned test assets, asynchronous evaluation, independent human release review and evidence export. The semantic reviewer v3 has passed a three-sample real protocol experiment and a **separate** seventeen-sample cross-scenario development experiment. Formal reviewer status remains `calibration_pending`, `shadowOnly=true`.

## Fresh local verification for this handoff

- `npm test`: TypeScript build completed; **777 tests, 776 passed, 1 failed**, exit code 1.
- Retained failure: `tests/evaluator-next-v1-holdout-v2.test.ts`, the rejected regex evaluator's unseen-set acceptance test. It was not deleted, skipped, or relabelled as passing.
- `node --test tests/*.test.mjs`: **7/7 passed**.
- Logs: `docs/evidence/git-handoff-2026-10-19/`.
- No new customer-model or reviewer-model calls. No deployment.

This feature branch is a review/evidence snapshot, **not an all-green release candidate**. Existing hosted CI runs apply to their exact older commits. A push is not a passing CI run or deployment.

## Whole-project progress

| Area | Evidence already available | Remaining boundary / action |
|---|---|---|
| Test Assets | Application registration, immutable suite IDs/versions, scoped snapshot API | Final team acceptance and documentation review |
| Evaluation | Job/outbox transaction, RabbitMQ, worker leases, conditional terminal writes | At-least-once delivery is not exactly-once provider execution |
| Review & Evidence | Independent identities, terminal review invariant, audit/export, predecessor links | Local test identities are not verified multi-person UAT; approval record is not deployment |
| UI / UAT | A's dated 25-item record and PR #4 fixes | Record distinguishes 20 full passes, 3 limited/adjusted cases and 2 repaired cases; not 25 fully independent human passes |
| Customer models | Frozen r4 A/B, 20 calls per model, 70/75 original scores | Final old-chain intersections 5/20 and 1/20; not calibrated semantic accuracy |
| Semantic reviewer | v3 protocol 3/3; separate cross-scenario 17/17, 9 compliant and 8 violating | Development validation only; no production qualification or Worker activation |
| CI/CD | Successful hosted CI at baseline 20d258d, dated tested-image deployment and rollback | Current candidate has a retained local test failure; no new hosted-CI success claimed |
| Cloud / performance | Dated GKE API/security, replay scaling, recovery and restore evidence | Not revalidated today; no sustained throughput, multi-region DR or HA claim |
| Course delivery | English slides, bilingual rehearsal handbook, timeline and demo runbook prepared in this conversation | Actual member hours, peer review, final UAT, backup videos and timed rehearsal |

## People and contribution records

| Member | Documented responsibility | Evidence / next action |
|---|---|---|
| A — TANG YUCHEN | Requirements, UI, UAT, presentation organisation | `docs/team/A/uat-20261014.md`; PR #4; final demo flow and actual hours |
| B — ZHU PENGXU | APIs, data ownership, domain/review invariants | PR #3; confirmed acceptance and predecessor-link records; peer review |
| C — LIN XINDA | Independent support app, provider, model and reviewer experiments | Dated evidence through v3; this cumulative AI-assisted handoff |
| D — LIAO CAN | Containers, cloud, CI/CD, recovery | Historical CI/CD and GKE records; verify environment and record backup demo |
| E — LIAO BINFENG | Security, performance, faults and retesting | PR #2; quality evidence; final validation and limitations |

At inspection, PR #2 and PR #3 remain open and unmerged. `docs/team-effort.csv` contains only its header. Do not derive student hours from commits, tool runtime or AI activity. The proposal's 50 person-days / 10 per member are estimates, not actual effort. This cumulative commit does not invent individual contributions or approvals.

## Planned sprints and observed milestones

- Sprint 1 plan: 8–13 October. Historical cloud/CI/CD/provider evidence exists from 11 October; A/E produced subsequent UAT/quality records.
- Sprint 2 plan: 14–20 October. A/B fixes and API-lineage/privacy evidence were recorded; C's 15–19 October work progressed through failed evaluators, Hybrid integration and v3 development validation.
- 21–25 October was the proposal's rehearsal/freeze window. Prioritise factual contribution records, peer review, two backup videos and timed rehearsal.
- The proposal recorded a 26 October presentation and 16 November final report. Confirm the actual latest timetable with the course notice; this handoff does not attest to unchanged schedule details.

## Presentation structure

Timing follows the screenshot supplied on 19 October: 40 minutes plus 5 minutes Q&A. The original lecturer email was not retrieved here. The JobPilot-specific paragraph and Python toolchain in that screenshot do not describe ReleaseGuard.

| Segment | Minutes | Proposed lead |
|---|---:|---|
| Introduction + project management | 4 | A |
| Architecture + design | 5 | B |
| Testing | 3 | E + C |
| CI/CD demo | 12 | D |
| System demo | 14 | A / B / C / E |
| Close + interruption/switching buffer | 2 | A / C |
| Q&A | 5 additional | All |

The slide deck has English content and Chinese rehearsal notes. Speaking ownership is a proposal for team confirmation. The presentation follow-up includes short actual-browser backup clips and a 19-check local replay rehearsal. Full-length narrated team recordings and the five-person timed rehearsal remain outstanding. See `docs/presentation/20261019/` for the current pack and precise source labels.

## Evidence navigation

- Architecture and DDD: `docs/07-DDD-Design.md` and current service source.
- Historical cloud/scaling: `docs/10-Cloud-Acceptance-20261011.md`.
- Historical real models, CI/CD and power state: `docs/12-Real-Retest-20261011.md`.
- Customer A/B: `docs/evidence/model-v17-ab-r4-2026-10-17/ab-real-v17-r4-final.json`.
- Three-sample protocol: `docs/evidence/semantic-review-wire-v3-real-2026-10-19/FINAL-RESULT.json`.
- Separate seventeen-sample development validation: `docs/evidence/semantic-review-wire-v3-cross-scenario-dev-2026-10-19/FINAL-RESULT.json`.
- Verified baseline CI: https://github.com/limidexy/releaseguard-team13/actions/runs/38709382103 at `20d258d`.
- Historical CD: https://github.com/limidexy/releaseguard-team13/actions/runs/38148479735 at `362e8dd`.

The current cloud environment was not restarted or checked. Use dated evidence or a separately rehearsed local environment. Do not expose tokens, `.env`, backups or credentials in Git or recordings.
