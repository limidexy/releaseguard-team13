# Admission slot candidate — 28 October 2026

This candidate is not a production release and has not passed the original GCP 897-request acceptance probe. It replaces the unfinished local slot implementation, not historical experiment results.

## Correctness changes

The unfinished query could take a free slot from a different rate key. It could also reject a concurrent cold request after waiting for an initializer, because sibling data-modifying CTEs share one statement snapshot. It ignored already recorded legacy usage when creating a new quota window.

`claim_admission_slot_v1` uses a VOLATILE PostgreSQL function with separate statements at the service's READ COMMITTED isolation level. The key is checked when selecting and updating a slot. Existing legacy usage is marked as already claimed. The function, new job and outbox entry execute in one outer transaction: a job/outbox error rolls back the claim and any new window. No HTTP retry or early 202 is introduced.

A new window performs only bounded expired-window cleanup. Existing windows do not update a shared counter row for every accepted job. Available slots are locked with SKIP LOCKED. A fully reserved window may reject a new request while other claims are still in flight; it never exceeds the exact configured cap.

The active business limit stays 1000/minute. Configuration outside 0..10000 is rejected rather than materializing an unbounded number of rows. Zero still admits nothing.

## Mandatory activation and rollback boundary

**Do not use a mixed rolling deployment of the old counter writer and the slot writer.** Observed legacy-count drift is rejected, but this check is not a proof of atomic coordination with unmodified legacy processes.

Before activation: stop new submissions, drain in-flight requests, ensure all old Evaluation writers have exited, retain the original image/config, verify READ COMMITTED, and then admit traffic to the verified new version. Retained legacy counts for that minute are not reset.

Before rollback: stop new submissions, drain/resolve in-flight writes, and do not reopen the old counter writer in the same minute as new slot claims. Wait for a fresh minute/quiet window, or leave compute stopped. Keep all jobs, outbox entries and historical quota records. Do not drop these tables to manufacture a clean pass.

A schema/function check, source-linked image build and fresh bounded cloud authorization/free-trial verification are required before the next cloud probe. The unsafe prebuilt r13 image must not be reused. No model calls, threshold changes or automatic semantic-review activation are part of this candidate.

## Reproduction

Use Node 24 and locked dependencies. Run `npm test` for the default TypeScript suite. Run `npm run test:admission-db` for the real PostgreSQL checks; this uses only a uniquely labelled disposable loopback Docker container and a locally available `postgres:16-alpine` image (`--pull=never`). `RG_ADMISSION_EVIDENCE_DIR` optionally selects a local results directory. The runner preserves the result and removes only its own verified container.

The real checks cover workspace/principal/minute isolation, cold concurrency, legacy accounting, atomic rollback, a locked-slot bypass, zero limits, changed configuration, cancellation and 1100 one-shot requests against an exact cap of 1000. The separate local HTTP burst checks 897 admissions, not task-completion latency or automatic scaling.

References: PostgreSQL WITH/data-modifying statement snapshot rules and VOLATILE function visibility. Local raw red/green results are retained in the admission-isolation-repair evidence directory; earlier cloud results are unchanged.
