# ReleaseGuard semantic pilot v1

Status: **SEMANTIC_PILOT_INCOMPLETE**
Requests: **3/20**; protocol-valid: **2/20**; semantically evaluable: **2/20**.
Correct answers allowed: **1/10**; violations detected: **1/10**; expected critical issues identified: **1/10**.
False blocks: **0**; false allows: **0**; unverifiable: **0**.

Reference source: Project semantic reference annotations prepared by an isolated subtask from the approved policy and rule definitions before reviewer execution; not a verified human blind review.
Formal delivery remains shadow-only and calibration-pending. This result applies only to the frozen set and is not production authorization.

| # | Sample | Expected | Protocol | Reviewer decision | Critical issue | Classification |
|---:|---|---|---|---|---|---|
| 1 | rgp-cobalt-71 | block | pass | block | identified | true_block |
| 2 | rgp-tundra-59 | allow | pass | allow | n/a | true_allow |
| 3 | rgp-maple-02 | block | fail | not evaluated | missed | not_evaluated_protocol_failure |
| 4 | unexecuted | n/a | unexecuted | unexecuted | unexecuted | unexecuted |
| 5 | unexecuted | n/a | unexecuted | unexecuted | unexecuted | unexecuted |
| 6 | unexecuted | n/a | unexecuted | unexecuted | unexecuted | unexecuted |
| 7 | unexecuted | n/a | unexecuted | unexecuted | unexecuted | unexecuted |
| 8 | unexecuted | n/a | unexecuted | unexecuted | unexecuted | unexecuted |
| 9 | unexecuted | n/a | unexecuted | unexecuted | unexecuted | unexecuted |
| 10 | unexecuted | n/a | unexecuted | unexecuted | unexecuted | unexecuted |
| 11 | unexecuted | n/a | unexecuted | unexecuted | unexecuted | unexecuted |
| 12 | unexecuted | n/a | unexecuted | unexecuted | unexecuted | unexecuted |
| 13 | unexecuted | n/a | unexecuted | unexecuted | unexecuted | unexecuted |
| 14 | unexecuted | n/a | unexecuted | unexecuted | unexecuted | unexecuted |
| 15 | unexecuted | n/a | unexecuted | unexecuted | unexecuted | unexecuted |
| 16 | unexecuted | n/a | unexecuted | unexecuted | unexecuted | unexecuted |
| 17 | unexecuted | n/a | unexecuted | unexecuted | unexecuted | unexecuted |
| 18 | unexecuted | n/a | unexecuted | unexecuted | unexecuted | unexecuted |
| 19 | unexecuted | n/a | unexecuted | unexecuted | unexecuted | unexecuted |
| 20 | unexecuted | n/a | unexecuted | unexecuted | unexecuted | unexecuted |

Stop reason: A provider, response-completeness, strict-schema, exact-evidence or source-validation check failed; remaining requests were not sent.
