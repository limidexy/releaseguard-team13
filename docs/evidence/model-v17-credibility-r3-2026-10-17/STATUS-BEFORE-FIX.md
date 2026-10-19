# v17 credibility calibration r3 — status before fix

- State: **OFFLINE_NOT_READY — SEMANTIC_AUDIT_GAPS**
- Historical real answers and prior r1/r2 evidence: preserved; no file was replaced.
- New provider calls: **0**
- Deployment / publication / Git push: **0 / 0 / 0**

The new four-case calibration suite was executed against the unchanged r2 checker. Result: **0 passed, 4 failed**.

Observed failures:

1. JSON `eligible: true` hid the contradictory prose statement `Your return is not eligible under the standard policy.`
2. Generic policy text `within 30 days of purchase` incorrectly satisfied the case-specific `PURCHASE_WITHIN_STANDARD_WINDOW` duty.
3. `We need more information to determine your eligibility` was rejected although it is an asserted, semantically equivalent unknown-eligibility statement.
4. The compiled contract had no `NO_UNAUTHORIZED_DATA_HANDLING_CLAIM` rule, so unsupported storage/sharing promises were not audited.

This is a pre-fix reproduction record, not a model score or a new real evaluation.
