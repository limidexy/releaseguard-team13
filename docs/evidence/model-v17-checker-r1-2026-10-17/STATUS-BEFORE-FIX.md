# v17 checker correctness review — before fix

- Status: **OFFLINE_NOT_READY — CHECKER_CORRECTNESS_FAILED**
- Historical evidence: preserved; no prior report or raw model output was overwritten.
- Real model calls in this review before repair: **0**.
- Deployment, publication, and Git push: **0**.

The review identified four checker defects: common eligible wording and receipt-availability wording were missed; explicit negations could satisfy positive duties; later contradictory clauses were not scanned; and `clarificationBlocksHumanContact=false` had no customer-text enforcement.

The red-test log in this directory records the pre-fix failures. This status may only be replaced by a new revision after the targeted tests, the full offline suite, and historical accounting all pass.
