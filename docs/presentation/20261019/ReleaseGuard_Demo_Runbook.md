# ReleaseGuard demonstration runbook

Prepared 19 October 2026. All times below include explanation and inspection pauses. The pack's automated technical rehearsal is not a five-person 40-minute rehearsal.

## Timing and handoffs

| Clock | Segment | Lead | Slides |
|---|---|---|---|
| 00:00–04:00 | Introduction and project management | A | 1–4 |
| 04:00–09:00 | Architecture and design | B | 5–8 |
| 09:00–12:00 | Testing and repair findings | E then C | 9–10 |
| 12:00–24:00 | CI/CD walkthrough | D | 11–13 |
| 24:00–38:00 | System and evidence demo | A, B, C, E | 14–17 |
| 38:00–40:00 | Close and interruption buffer | A then C | 18 |
| 40:00–45:00 | Q&A | All | Hidden backups 19–24 |

If the older PDF's 40-minute total including Q&A governs, keep 4+5+3 for introduction/design/testing, reduce CI to 9 minutes, system demo to 12, and close to 2. That is 35 minutes plus 5 Q&A. The latest instructor notice takes precedence. The retrieved revised PDF lists Team 13 on 26 October 2026 at 09:45.

## Preconditions and startup

1. Use Node.js 24 and Docker. Start in the verified repository branch. Do not put `.env`, tokens, cookies or secret-bearing terminal output on the projector.
2. Confirm `git status -sb`, `git rev-parse HEAD` and `git remote -v`. Compare the branch SHA with the delivery report.
3. Use the existing local baseline at `http://localhost:5193`. The preparation rehearsal used gateway image `75f247d78f1c…`, which differs from the current source candidate. Display that distinction. Do not describe v3 as deployed in this container.
4. The current runtime already runs. Do not recreate it with another checkout's `.env` or remove volumes. To resume the same stopped stack later, use its own original directory/configuration and `docker compose start`, then check readiness. If the original runtime/configuration is unavailable, use the recorded backups instead of guessing credentials or starting a cloud environment.
5. Keep the browser on localhost and choose **replay** or imported evidence only. Never select `real`. This preparation does not authorize provider requests.
6. Generate local development tokens privately with that runtime's matching signing configuration. Put a contributor token in the password field. Tokens are temporary and not packaged. A 401 is a reason to stop and check the runtime identity, not to print or share the secret.
7. Open the offline `ReleaseGuard_Evidence_Replay.html`, the two videos, `Rehearsal_Result.json`, and the historical Actions bookmarks before presenting. Test the browser video player and keep a second copy of the files locally.

## CI/CD segment  12 minutes

| Step | Time | Action | Expected observation | Backup |
|---|---:|---|---|---|
| C1 | 2 min | Slide 11; open `.github/workflows/ci.yml` and `cd.yml` | Node 24, locked install, tests, Compose, npm audit, Trivy and tested artifact identity; CD manual only | Offline evidence viewer pipeline page |
| C2 | 1 min | Open the preparation branch commit and compare diff | Actual current SHA; feature branch, no main merge | Push verification report |
| C3 | 2 min | Open clean-checkout summary/log | Build succeeds; 776/777 with rejected evaluator test retained; v3 12/12, auxiliary 7/7 | Screenshot and local report |
| C4 | 2 min | Open CI run 38709382103 | Historical success at source `20d258d`; this is not the new candidate's CI | Saved historical CI screenshot |
| C5 | 2 min | Open CI 38148253863 and CD 38148479735 | Both use `362e8dd`; tested image identity matches that historical promotion | CI/CD backup recording |
| C6 | 3 min | Slide 13; show dated failure, rollback and restore reports | Failed build/health precondition preserved; restore scope is same-instance logical DB restore | Evidence viewer and repair process document |

Links: [baseline CI](https://github.com/limidexy/releaseguard-team13/actions/runs/38709382103), [matched CI](https://github.com/limidexy/releaseguard-team13/actions/runs/38148253863), [matched CD](https://github.com/limidexy/releaseguard-team13/actions/runs/38148479735).

Normal feature-branch push does not match the current CI push filter. No new hosted run must be claimed unless the report links an observed run for that exact commit. The full current regression's known failure would block promotion. Do not hide it or dispatch deployment for demonstration.

## System segment  14 minutes

| Step | Time | Action | Expected observation | Source and fallback |
|---|---:|---|---|---|
| S1 | 1 min | Slide 14; open local console, English; state runtime/source | Local baseline, replay, no provider | Live local operation; screenshot 01 |
| S2 | 1 min | Reuse rehearsal app and legacy demo suite IDs from Rehearsal_Result; open New evaluation | App and suite fixed. Do not click revised-policy setup and expect the legacy fixtures to pass | Live local; history screenshot |
| S3 | 1.5 min | Select replay, prompt v1, scenario passing, fresh candidate label; submit | Asynchronous job then succeeded with gate passed, original fixture outputs visible | Synthetic replay; screenshot 04 |
| S4 | 1 min | Repeat with failing scenario | Succeeded execution but blocked gate and critical failure | Synthetic replay; screenshot 03 |
| S5 | 0.5 min | Attempt review for blocked job | UI disabled or API 409 | Rehearsal_Result checks |
| S6 | 1 min | Slide 15; open passing job and request review | Pending request captures suite and job evidence | Local test identity |
| S7 | 1 min | Demonstrate owner self-review denial, then switch to separate reviewer test identity | 409 self-review; different test identity may decide | Current HTTP rehearsal; no human UAT claim |
| S8 | 1 min | Show stale version and terminal-state checks | 409 stale version and 409 reopen | Rehearsal report; avoid destructive shared changes |
| S9 | 1 min | Export review evidence or open saved report | Original outputs, suite snapshot and two audit events | Screenshot 05 and current HTTP report |
| S10 | 1 min | Open predecessor tests/records if asked | New records link previous jobs/reviews; existing terminals remain closed | Code/test evidence, not claimed as new browser action |
| S11 | 1 min | Slide 16; switch to offline evidence viewer and select customer A/B | **Historical real running playback** label; original 70/75 and fixed denominators | Saved real calls; no new inference |
| S12 | 1 min | Select separate v3 three-sample and 17-sample pages | Separate experiment IDs, raw response selection, statuses and quotes | Saved real reviews and derived coordinates |
| S13 | 1 min | Slide 17; show dated quality evidence and limits | Replay-only performance, bounded v3 result, shadow/calibration status | Historical report |

The automated preparation rehearsal executed 19 successful HTTP assertions and browser inspection. It created synthetic rehearsal records in a new workspace, without changing existing records. First setup attempts encountered a mismatched local signing identity and then a local output-path error. They did not call a model or change the old experiments. The final run completed all 19 checks.

## Recovery and recording script

- If a local page fails, stop after one short health/identity check and play `backups/ReleaseGuard_System_Demo_Backup.webm`. Say: “This is a recorded local replay rehearsal from 19 October, using synthetic fixtures.”
- If GitHub is unavailable, play `backups/ReleaseGuard_CICD_Backup.webm`. Say: “This recording replays saved and historical pipeline evidence. It does not show a new deployment.”
- The backup clips are short technical walkthroughs, not full 12/14-minute narrated recordings. Pause them to explain a step. The team should record full-length voiced backups during its final timed rehearsal.
- To record a full CI backup: show current branch/diff; clean regression and v3 logs; dated hosted CI source; matching historical CI/CD source; failure and rollback evidence. Never show credentials, repository variables, browser cookies or billing controls.
- To record a full system backup: repeat S1–S13 with replay selected and a fresh synthetic workspace. Capture source labels and original evidence. No real provider or reviewer calls.
- At 38 minutes, move to slide 18 even if optional predecessor/performance details have not been shown. The hidden slides hold technical detail for Q&A.

## Course coverage and remaining items

The deck covers business context and scope; responsibility/actual-milestone records; DDD boundaries, logical and physical views, persistence and patterns; test taxonomy and exact outcomes; source/artifact management and actual historical CI/CD; normal, blocked and evidence paths; bounded quality evidence. It excludes JobPilot content. Actual member hours, a recorded team retrospective, genuine independent approvals, final multi-person UAT, the latest timing confirmation and full-length team recordings remain for the team. No unmeasured performance or production semantic reliability is claimed.
