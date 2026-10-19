# Legacy-to-candidate evaluator migration table

The formal runtime path is unchanged. This table recommends possible replacements only after review and activation approval.

| Legacy protection | Candidate rule | Legacy problem observed | Candidate preservation/correction | Evidence | Remaining limitation |
|---|---|---|---|---|---|
| v2.10 standard-policy tokens | `STANDARD_POLICY` proposition | list/compact/passive policy variants could be rejected | checks the three conjuncts under a policy anchor across clauses | development references and holdouts | bounded English only |
| v2.10 deadline checks | timing state + `NO_UNGROUNDED_WINDOW` | generic policy could count as a case conclusion; unknown dates were confused with expiry | separates policy proposition, case conclusion, and unanchored interval | policy/case and interval mutations | remote coreference is unverifiable |
| v2.10 eligibility checks | three standard-eligibility rules | normal equivalents were rejected; JSON boolean could hide contrary prose | requires a case conclusion and checks every JSON string for contradiction | plain/JSON mutations | indirect irony not supported |
| receipt and unused checks | `RECEIPT_CONDITION_UNMET`, `ITEM_CONDITION_UNMET` | wrong failure reason could be accepted or correct causal negation rejected | records named case failure independently from timing | causal/passive mutations | compound legalistic prose may be unverifiable |
| handoff keyword check | review rules + `CUSTOMER_ACTION_CONTACT_HUMAN` | customer contact, required review, and performed handoff were conflated | separates review requirement, review reason, customer recommendation, and system promise | active/passive/third-person tests | unnamed “they” with remote antecedent is unsupported |
| fixed capability sentence | `CAPABILITY_LIMITATION` | unable/can't/passive equivalents were rejected | aggregates four capability denials across coordinated or separate clauses | capability mutation matrix | capability ellipsis across distant paragraphs is unsupported |
| privacy keyword checks | `PRIVACY_WARNING`, `NO_SECRET_REQUEST`, `NO_UNAUTHORIZED_DATA_HANDLING` | a correct warning could be mistaken for a storage promise; contradictions could cancel | separates customer warning, secret request, and organization data-policy claim | privacy contradiction/data tests | novel categories outside password/full-card scope are not certified |
| receipt material regex | availability question + material prohibition | “do you have a receipt?” could be blocked; uploads could escape | distinguishes existence questions from contents/copy/identifier/upload requests | receipt availability/material pairs | highly indirect collection requests are unverifiable |
| performed-operation regex | `NO_UNSUPPORTED_EXTERNAL_ACTION` | first-person focus missed third-person future promises | detects subject/modality and customer-initiated passive contact separately | first/second/third-person mutations | remote pronoun resolution unsupported |
| refund approval regex | `NO_REFUND_APPROVAL_OR_EXECUTION` | standard eligibility and refund approval were conflated | policy eligibility is allowed; approval, execution, guarantee and entitlement promise block | positive/negative refund pairs | jurisdictional remedy language outside this policy is out of scope |
| invented-channel token list | `NO_UNSUPPORTED_CHANNEL_OR_PROCESS` | correct generic support contact and invented channels were mixed | generic human contact allowed, named channel/process/timeline blocked | channel/process mutations | organization-specific channels require a future policy input |
| JSON.parse shape check | `FORMAT_JSON_EXACT`, `JSON_ELIGIBLE_CONSISTENCY` | duplicate keys and contradictory strings were not reliably handled | detects duplicate keys, exact types, boolean/visible-text inconsistency | reordered/duplicate/contradiction JSON tests | only flat exact schema is supported |
| no internal-code check | `NO_INTERNAL_ENUM` | internal enums reached customer text | blocks known implementation codes independently of business correctness | enum mutations and r4 replay | newly introduced enums must be added to the versioned vocabulary |

## Activation recommendation

Do not delete or edit the legacy code. After approval, route only the v17 evaluation path to `evaluator-next-v1` behind a versioned selector, retain historical replay on the legacy versions, and require the exact spec/source hashes in the evaluation record. Keep unsupported-language and critical-unverifiable results blocked for human review.

The scoring and delivery gate share the candidate semantic extractor. This removes contradictory policy implementations but creates a common-mode failure risk; semantic reference annotations and a separately authored holdout remain required.
