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

After capture of raw results, bilingual UI evidence and CI/CD links, stop the two trial compute nodes and verify no compute instances remain. Preserve data volumes. Retained disks, IP, load balancer and images may still consume trial credit; billing reports can lag. Never upgrade to a paid account.

## Team sharing

The repository remains private: `https://github.com/limidexy/releaseguard-team13`. Invite the four actual teammates by their confirmed GitHub usernames; they accept invitations using their own accounts. No shared password, token or cloud administrator credential. GitHub Free supports collaborators on private personal repositories ([GitHub documentation](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/inviting-collaborators-to-a-personal-repository)). Personal-repository collaborators receive code collaboration permissions; do not confuse this with cloud administrator access or a read-only public preview.

For immediate group discussion, distribute a sanitized source-and-evidence archive. Exclude `.env`, `evidence/private/`, credentials, database dumps and kubeconfig. Keep A/B/C/D/E responsibilities unchanged. The website and GitHub repository have separate access controls; a stopped website cannot be made available by sharing a GitHub link.

References: [Groq completion API](https://console.groq.com/docs/api-reference), [Groq rate limits](https://console.groq.com/docs/rate-limits). Account console values were checked for this experiment; no plan upgrades are part of this task.
