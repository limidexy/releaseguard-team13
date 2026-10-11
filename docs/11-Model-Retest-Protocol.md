# Real-model re-test protocol

This is a corrective experiment, not a claim of business acceptance. The previous raw report in `docs/evidence/cloud-2026-10-11/prompt-comparison-real-1791722840080.json` must remain byte-for-byte unchanged.

## Changes fixed before the next real run

- Keep both original prompt texts, the same ten questions, nine critical flags, and the 95-point gate. Do not train a model or choose answers retrospectively.
- Increase the request's completion budget from 300 to 1,536 tokens, bounded to at most 30,720 generated tokens across twenty requests, plus input tokens. Allow 20 seconds per provider request. The provider may count internal reasoning within its completion budget; do not store reasoning text.
- Space provider starts by at least 20 seconds on the trial's single support replica. This is a local pacing measure, not a distributed quota. Groq Free limits remain authoritative. No automatic provider retries; recovered real jobs fail rather than repeat calls. Run the two jobs sequentially, with no competing real-model experiment.
- Preserve raw bounded answers and available request ID, reported model, finish reason and usage even when content is empty or truncated. Transport failures have explicit errors rather than invented responses. Neither errors nor truncation can pass a gate.
- Add `returns_policy_v2`, evaluator `returns-policy-v2.0`, as a new suite. Legacy generic rules and historical results remain intact. The revised rule checks known paraphrases and multiple requirements, positive secret-protection statements, unperformed refund claims, unsupplied contact details, and typed bare JSON.
- Retain detailed check results. These are bounded English heuristics, not general semantic understanding: there can still be omissions, false positives and false negatives. Independent human policy-accuracy, safety and helpfulness review is mandatory before business approval.
- Keep the current interface and make environment labels come from explicit server configuration. Unknown configuration must display unconfirmed, never silently claim cloud deployment.

## Verification and interpretation

Evaluator tests contain 52 literal positive and negative examples. These are synthetic regression fixtures, NOT 52 live model results. Test coverage does not establish model quality.

Run twenty real calls only after verifying the cloud trial and Groq Free account, passing CI, deploying that exact tested image and completing a cloud smoke check. Preserve the new report under a new filename. Record source commit, image, suite and prompt snapshots, attempts, provider errors, per-case decisions and any unavailable metadata. Do not silently retry to obtain a better score.

Because both output budget and scoring method changed, the old 20/60 scores cannot be directly compared with the new scores. The comparison script also applies the legacy rules to the new answers and the revised rules to old answers, keeping provider errors intact. These secondary calculations are labelled offline re-scoring, not additional model calls. One run per prompt is exploratory; no stable improvement, statistical significance or independent human approval is claimed.

For each failed case, inspect the complete raw answer and the exact check failure. Unknown or misleading cases remain visible for a human reviewer; do not rewrite old scores. Record any future evaluator change as another version.

### Post-run correction, explicitly not pre-registered

Inspection of the 20 retained answers exposed two false negatives in v2.0: asking how long ago the item was purchased, and forwarding a damaged-item case to the returns team. It also exposed a false positive: contracted or intervening-verb refund promises such as “we'll ... process a refund” were missed. These fixes are isolated in new rule `returns_policy_v2_1`, evaluator `returns-policy-v2.1`. `returns_policy_v2` keeps its old behaviour. The same 52 literal regression fixtures are checked against both rules; ten additional tests cover the correction and negative controls. The complete TypeScript suite now has 138 tests, plus a separate image-identity test.

`node scripts/rescore-retained.mjs <raw-report>` creates a separate, hashed offline derivation with zero provider calls. It preserves original job IDs, results, provider errors and raw answer bytes. Because this rule revision used the observed answers, its scores are explanatory re-scoring, not a blind holdout result. The next independent model experiment must freeze a rubric beforehand. Do not overwrite the real jobs or claim another 20 calls occurred.

After capture of raw results, bilingual UI evidence and CI/CD links, stop the two trial compute nodes and verify no compute instances remain. Preserve data volumes. Retained disks, IP, load balancer and images may still consume trial credit; billing reports can lag. Never upgrade to a paid account.

## Team sharing

At the owner's explicit request, the repository was made public on 11 October 2026: `https://github.com/limidexy/releaseguard-team13`. Unauthenticated GitHub API access confirmed HTTP 200 and `private=false`. Lecturers and teammates can read code, commit history and Actions without invitations. The current implementation remains on `feat/local-course-evidence`, with draft PR #1 awaiting genuine team review; publication is not a merge or approval.

Write access remains separate. Invite the four actual teammates only by their confirmed GitHub usernames. No shared password, token or cloud administrator credential. The existing manually dispatched CD has no independent approval gate configured; publication does not itself add one. Public Actions logs and artifacts were included in the publication check. Future submissions must also exclude credentials and private customer data.

For immediate group discussion, distribute a sanitized source-and-evidence archive. Exclude `.env`, `evidence/private/`, credentials, database dumps and kubeconfig. Keep A/B/C/D/E responsibilities unchanged. The website and GitHub repository have separate access controls; a stopped website cannot be made available by sharing a GitHub link.

References: [Groq completion API](https://console.groq.com/docs/api-reference), [Groq rate limits](https://console.groq.com/docs/rate-limits). Account console values were checked for this experiment; no plan upgrades are part of this task.
