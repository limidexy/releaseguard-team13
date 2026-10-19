# ReleaseGuard presentation handoff — 19 October 2026

Start with `ReleaseGuard_Presentation.pptx` and `ReleaseGuard_Speaker_Notes.docx`. The editable deck contains 18 main slides and 6 hidden backup slides. The notes include English spoken text, Chinese rehearsal cues, named leads and transitions.

## Open and rehearse

1. Read `ReleaseGuard_Project_Status.md` for the whole-project status and honest gaps.
2. Follow `ReleaseGuard_Demo_Runbook.md`: 40 minutes of content, then 5 minutes Q&A. Confirm the latest instructor notice; an older retrieved PDF instead includes Q&A inside a 40-minute slot.
3. Open `ReleaseGuard_Evidence_Replay.html` in a browser. It is an offline, derived viewer of saved evidence, not a new model execution. It needs no credentials or network.
4. Use the two named WebM files in `backups/` if the local application or GitHub is unavailable. They are short recorded technical walkthroughs, not full-length narrated presentation videos.
5. Read `Git_Push_and_Verification_Report.md` and `Verification_Summary.json` before describing any candidate as verified.

## Recommended leads

| Segment | Minutes | Lead |
|---|---:|---|
| Introduction / project management | 4 | A — TANG YUCHEN |
| Architecture / design | 5 | B — ZHU PENGXU |
| Testing / repair findings | 3 | E — LIAO BINFENG, then C — LIN XINDA |
| CI/CD evidence walkthrough | 12 | D — LIAO CAN |
| System / evidence demo | 14 | A, B, C, E in that order |
| Close / interruption buffer | 2 | A and C |
| Q&A | 5 additional | All |

These are presentation responsibilities, not evidence that each person independently authored all code in that area. Actual effort, team retrospective, independent approvals and final multi-person UAT remain to be confirmed by the team.

## Evidence boundaries

- The 3-sample real v3 protocol experiment and separate 17-sample development experiment remain separate. They are not a single 20/20 experiment.
- Reviewer remains `calibration_pending`, `shadowOnly=true`. Customer scores 70/75, old incomplete pilot and 16 unavailable originals are unchanged.
- Current clean source build succeeds, but the full regression retains one rejected evaluator holdout failure (776/777). v3 targeted checks are 12/12; auxiliary checks 7/7.
- The actual local technical rehearsal passed 19 HTTP assertions with zero new inference. The running local image is an older baseline, not the current v3 source candidate.
- Historical CI/CD applies to its recorded exact source. Feature-branch push does not match the current push-to-main CI filter. No new deployment or production qualification is claimed.

## Pack contents and source

The fix narrative, Q&A, runbook, compact derived evidence and redacted log excerpts accompany the deck. `File_Manifest.json` identifies packaged bytes. Private build folders, original response archives, credentials, dependency folders and duplicate recordings are excluded. No new generation or semantic-review requests were made for this delivery.

Implementation, analysis and presentation preparation used Codex assistance. The team must check the material and declare tool use according to course requirements.
