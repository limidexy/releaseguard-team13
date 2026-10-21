# ReleaseGuard Git and verification report

Prepared 19 October 2026. Repository: `https://github.com/limidexy/releaseguard-team13.git`. Target feature branch: `feat/c-review-v3-handoff-20261019`. No main merge, force push or deployment is part of this handoff.

## Source and publication

At the start of this preparation, local HEAD and the remote branch already matched `917ce1c8ac430cab3b26064da6147504a73c6b25`. That cumulative code/test/evidence commit preserves the prior B baseline and v3 work. The presentation follow-up adds the editable deck, notes, status, repair narrative, runbook, Q&A, portable evidence selections and verification records. It does not change the model protocol or business policy.

The final delivery copy of this report records the follow-up commit and remote verification after push. The repository copy accompanies that commit and cannot contain its own self-referential SHA. Identify it with `git log -1 -- docs/presentation/20261019` and compare it to the remote branch.

## Clean checkout and tests

The code commit was exported to an isolated directory, followed by a fresh lockfile install using Node.js 24.19.0. No `.env` or model credentials were copied. A small Git repository was initialised so the Windows LF-attribute test could use `git check-attr`. No application source was changed in that projection.

| Check | Observed outcome |
|---|---|
| Locked dependency install | Success |
| TypeScript build | Success |
| Full regression | 777 tests, 776 pass, 1 retained failure; exit 1 |
| Failure identity | Rejected `evaluator-next-v1-holdout-v2` acceptance test |
| v3 protocol and transport tests | 12/12 pass |
| Auxiliary image/Windows tests | 7/7 pass |
| Local baseline HTTP rehearsal | 19/19 pass, zero new inference |
| Browser inspection | Zero page errors |

The initially selected system Node 22 produced an engine warning. Verification was repeated under the required Node 24 before reporting the outcomes above. The archive projection initially lacked Git metadata for one attribute check; initialising Git resolved that environmental issue without editing or dropping the test. Retained local raw logs stay in the private build directory; public log excerpts remove host paths and are labelled as redacted derivatives.

## Workflow behaviour and hosted evidence

`ci.yml` triggers on pushes to `main`, pull requests and manual dispatch. An ordinary push of this feature branch does not automatically run CI. At the initial `917ce1c` inspection, GitHub returned no associated workflow runs or status checks. This is not a passed CI. No workflow filters or security gates were disabled to produce a green badge.

Historical hosted records were refreshed through GitHub's read-only API:

| Run | Exact source | Observed result | Use in presentation |
|---|---|---|---|
| CI 38709382103 | `20d258d` | completed / success | Older API baseline |
| CI 38148253863 | `362e8dd` | completed / success | Matched historical tested artifact |
| CD 38148479735 | `362e8dd` | completed / success | Historical manual promotion of that source |

The new candidate's complete test command retains a failure and is not release qualified. No cloud CD was dispatched, and no model or semantic-review request was sent. Historical scans and deployments apply to their exact source versions only.

## Included and excluded content

Included: required implementation dependencies already in the cumulative commit, portable tests and lockfile, presentation files, compact derived evidence, source hashes, runbook and explicit limitations. Excluded from the new commit: `.env`, provider credentials, tokens, cookies, private backups, local Compose overrides, duplicate handoff archives, `node_modules`, all `dist`, raw videos and private build artefacts. Videos are in the local delivery package, not committed by default. The current untracked historical directories are preserved unchanged.

## Presentation and evidence checks

The PPTX uses native editable tables and architecture/process objects, 18 main slides and 6 hidden backup slides. Every slide contains notes with owner, target time, English script, Chinese prompt and switching cue. The English script totals approximately 2,150 words, with most demo time allocated to actual inspection and pauses. Main timing is 40 minutes with 5 additional Q&A; a 35+5 alternative covers the older PDF.

The speaker document is rendered and inspected. The two short backup clips and screenshots identify local synthetic replay or saved historical evidence. The 19-check rehearsal is technical execution, not a claimed five-person timed rehearsal. Full-length voiced recordings, actual effort records, team retrospective and latest course timing remain for the team.
