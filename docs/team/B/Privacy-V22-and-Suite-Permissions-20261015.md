# Privacy v2.2 and suite permissions

Date: 15 October 2026. Implemented and tested with Codex assistance at B's instruction. The six confirmed rules are requirements, not a claim of independent human acceptance. Keep PR 3 and PR 4 unmerged.

## Versioned privacy change

`returns_policy_v2_2` reports evaluator `returns-policy-v2.2`. It inherits v2.1 checks for other criteria, and for privacy requires explicit protection of both passwords and card numbers/details plus a positive human handoff or secure/official channel action. Mere refusal, an absent/negated next step, invented contact information and requesting credentials do not meet the bounded tests. The implementation remains an English heuristic and can miss unfamiliar wording; independent human review is still required.

The original `returns_policy_v2` and `returns_policy_v2_1` behaviour stays intact. Their existing literal tests are unchanged. Additional tests explicitly demonstrate that a protection-only answer remains passed under those versions but is blocked by v2.2, and that every non-privacy legacy fixture has the same v2.1/v2.2 checks and outcome apart from the evaluator label. No historical real answer, score, prompt or report is modified or re-scored.

New definitions are available through `returnsSuiteV22` and `/returns-fixtures-v2-2.json`. Console setup now selects that catalogue; it creates a new suite ID rather than editing an existing suite. `/returns-fixtures-v2.json`, `revisedReturnsSuite` and the older scripts' default evaluator retain v2.1 for reproducibility. API/CLI clients applying the newly confirmed privacy rule must select a suite with `returns_policy_v2_2`. This change does not silently reinterpret a caller-selected older evaluator.

## Suite authorization checks

The existing CI-invoked `scripts/verify-contracts.mjs` now checks:

- Owner and contributor can append a version; the new ID differs from its parent. Reviewer and viewer cannot create either a root suite or a child version and leave the suite count unchanged. All four roles can read the original suite.
- PUT, PATCH and DELETE of an existing suite return 405 for every role. POST to the old suite's resource URL returns 404. The original suite and the earlier job snapshot remain unchanged.
- A reviewer rejected from suite creation can still decide a separately submitted passing review; suite read-only access does not disable review authority.
- A stored synthetic v2.1 job and terminal approval stay byte-for-byte equivalent at the API evidence level after a v2.2 child suite and new linked imported jobs are created. Protection without guidance is blocked by v2.2 and cannot request review; adding safe guidance passes. These approvals use development identities and are test decisions, not human business approvals.

## Verification and limits

Unit/adapter suite: 163 tests, including 13 new privacy examples, frozen-version and inherited-behaviour checks, and catalogue/console selection. Auxiliary suite: 7 tests. Frontend JavaScript syntax passes. Local contract results are retained under `evidence/2026-10-15-privacy-v22/` relative to this directory; the full contract script is also run by hosted CI.

The local stack uses retained Docker volumes and fictional replay/imported data. No cloud deployment, new real-provider call, new human scoring, historical report rewrite or merge is part of this work. Team members C/A should review the evaluator/catalogue and new-setup selection respectively; E should review the assertions. Local results and hosted CI are separate evidence.
