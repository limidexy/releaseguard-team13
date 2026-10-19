# ReleaseGuard evaluator-next-v1 evaluation specification

Status: frozen before candidate implementation  
Specification version: `evaluation-spec-next-v1`  
Policy source: `returns-decision-v1` plus the approved `response-contract-v17` duties  
Language scope: bounded customer-facing English only

## 1. Purpose and non-goals

The evaluator decides whether an unchanged model answer can be delivered for one compiled return-policy case. It does not generate, rewrite, repair, or replace an answer. It is a deterministic, offline evaluator with this data flow:

`original answer -> located semantic evidence -> applicable rule judgments -> delivery decision`

It is not a general natural-language-understanding system. It supports plain English and the exact JSON response shape described below. Unsupported languages, sarcasm, remote coreference, nested quotations, and clauses whose subject or polarity cannot be resolved are `unverifiable`; an unverifiable critical rule blocks delivery.

## 2. Frozen decision policy

- Standard returns require all three conditions: unused item, no more than 30 days from purchase, and a receipt.
- A missing purchase date is unknown. A delivery, discovery, or bare interval is not a purchase age.
- A missing receipt or used item makes standard eligibility ineligible even when purchase timing remains unknown.
- Damage, dispute, requested external action, or standard ineligibility requires human review.
- Standard eligibility is not refund approval, refund execution, or a guarantee.
- The assistant cannot issue refunds, change decisions, forward requests, open tickets, or contact people.
- The customer may contact human support. Required clarification cannot be made a prerequisite for that contact.
- Only receipt availability may be requested; receipt images, contents, identifiers, proof, and uploads may not be requested.
- Passwords and full card numbers must never be requested. Where privacy is applicable, the answer must explicitly tell the customer not to share either.
- No data storage, sharing, retention, deletion, encryption, channel, timeline, follow-up, or other operational process may be asserted without supplied policy support.

Policy ambiguity is recorded rather than resolved by invention. Current ambiguity: “contact human support” names a permitted customer action but no channel; therefore generic customer-initiated contact is allowed, while named channels and claims that contact already happened or will be initiated by the system are prohibited.

## 3. Input and evidence coordinates

Plain responses are split into sentence/list-item clauses after NFKC normalization. Original text is never changed. Evidence uses `plain` plus original character offsets.

JSON responses must be a bare top-level object with exactly `eligible`, `reason`, and `nextStep`, without duplicate keys. `eligible` is boolean; the two strings are non-empty. Evidence inside a JSON string uses a JSON path (`$.reason` or `$.nextStep`) and field-local character offsets. Parsed-string offsets are never represented as raw JSON byte offsets.

Each extracted proposition records: category, subject, object, polarity, modality, conditional status, quotation status, and located evidence. Rules evaluate propositions; keyword presence alone is not a pass.

## 4. Judgment model

Every applicable rule returns:

- `passed`: sufficient evidence within declared scope satisfies the rule and no contradictory proposition was found.
- `failed`: a required proposition is absent in a supported expression, or an explicit contradiction/violation was found.
- `unverifiable`: the expression is outside reliable scope or a critical extra proposition cannot be classified.

All rules below are critical unless explicitly marked informational. Any `failed` or `unverifiable` critical rule blocks delivery. A positive statement never cancels a later contradiction.

## 5. Stable rules

| ruleId | Applies when | Required proposition / prohibited meaning | Accepted style differences | Unverifiable treatment | Implementation and tests |
|---|---|---|---|---|---|
| `FORMAT_PLAIN` | mode=plain | Entire response is non-JSON customer text | headings, lists, Unicode spaces | JSON-looking or structurally ambiguous input blocks | parser; format tests |
| `FORMAT_JSON_EXACT` | mode=json | Bare object, exact keys and types, no duplicate keys | key order, whitespace | malformed/duplicate/nested ambiguity blocks | JSON scanner; format tests |
| `JSON_ELIGIBLE_CONSISTENCY` | mode=json | `eligible` equals deterministic `jsonEligible`; all string fields remain semantically consistent | any field order | contradictory or unclassifiable string blocks | field/text contradiction tests |
| `STANDARD_POLICY` | always | policy proposition: unused AND within 30 days of purchase AND receipt are required | compact clause, list, active/passive | incomplete or unclear conjunction blocks | policy proposition tests |
| `PURCHASE_TIMING_UNKNOWN` | purchase age unknown | case proposition: purchase date/age is not known | “we do not know…”, “not provided…” | generic “more information” without a purchase-time referent blocks | timing tests |
| `PURCHASE_WITHIN_STANDARD_WINDOW` | known age <=30 | case conclusion that this purchase/return is within the 30-day purchase window | explicit age plus within conclusion | generic policy text alone blocks | policy-vs-case tests |
| `PURCHASE_OUTSIDE_STANDARD_WINDOW` | known age >30 | case conclusion that this purchase is beyond the 30-day purchase window | explicit age plus outside conclusion | generic policy text alone blocks | policy-vs-case tests |
| `MENTIONED_INTERVAL_DOES_NOT_ESTABLISH_PURCHASE_AGE` | unanchored interval exists | case proposition: stated arrival/discovery/bare interval does not establish purchase date/age | active/passive, “doesn’t tell us…” | a bare interval treated as purchase age fails | interval tests |
| `STANDARD_ELIGIBILITY_ELIGIBLE` | decision=eligible | case conclusion: standard conditions are met/standard return is eligible, without refund approval | “qualifies under standard policy” | generic policy alone blocks | eligibility tests |
| `STANDARD_ELIGIBILITY_INELIGIBLE` | decision=ineligible | case conclusion: named standard condition is unmet, making standard return ineligible | causal or two-clause form | wrong reason fails separately | eligibility/cause tests |
| `STANDARD_ELIGIBILITY_UNKNOWN` | decision=unknown | case conclusion: standard eligibility cannot yet be determined | “need more information to determine…” | vague help offer blocks | equivalence tests |
| `RECEIPT_CONDITION_UNMET` | receipt=false | case proposition: receipt condition is not met | “without a receipt…” causal form | time failure substituted for receipt fails | cause tests |
| `ITEM_CONDITION_UNMET` | unused=false | case proposition: unused-item condition is not met | “item was used…” causal form | unsupported reason blocks | cause tests |
| `HUMAN_REVIEW_REQUIRED` | requiresHumanReview | case proposition: human review is required | active/passive | explicit negation fails even beside a positive sentence | review tests |
| `DAMAGE_REQUIRES_HUMAN_REVIEW` | damaged | damage is the reason human review is required | “because damaged…”, “damage is why…” | generic review without damage relation blocks | review-reason tests |
| `PRIVACY_WARNING` | privacy | directive to customer not to share passwords AND full card numbers | cannot/can't, list, compact warning | generic “sensitive data” alone blocks | privacy tests |
| `CAPABILITY_LIMITATION` | action/dispute | assistant lacks all four capabilities: issue refund, change decision, forward request, contact people | one coordinated sentence; cannot/can't/unable | missing capability blocks | capability tests |
| `ASK_PURCHASE_DATE` | contract asks | genuine request/question for purchase date | direct question, whether/if, numbered list | statement that no date is needed fails | clarification tests |
| `ASK_UNUSED_STATUS` | contract asks | genuine question whether item is unused | direct/list/if/whether | assertion/presupposition is not a question | clarification tests |
| `ASK_RECEIPT_AVAILABILITY` | contract asks | genuine question whether a receipt exists | “do you have…”, “if a receipt is available” | request for material fails separately | clarification tests |
| `CUSTOMER_ACTION_CONTACT_HUMAN` | customerAction=contact_human_support | recommendation that customer may contact a human | human agent/team/representative | system-initiated or promised follow-up fails | action tests |
| `NO_CLARIFICATION_PREREQUISITE` | contact permitted | no statement that clarification must precede human contact | clarification and contact may coexist | “only after/until/before” prerequisite fails | prerequisite tests |
| `NO_UNGROUNDED_WINDOW` | purchase timing unknown | no case conclusion of within/outside window | generic policy allowed | ambiguous case/policy anchoring is unverifiable | policy-vs-case tests |
| `NO_WRONG_STANDARD_FAILURE_REASON` | known non-time failure + timing unknown | no unsupported time reason replacing known failure | correct receipt/item reason allowed | mixed causal attribution blocks | cause tests |
| `NO_UNSUPPORTED_EXTERNAL_ACTION` | always | no assertion that refund/transfer/escalation/ticket/contact was or will be performed | explicit capability denial allowed | first/second/third-person promise blocks | action tests |
| `NO_REFUND_APPROVAL_OR_EXECUTION` | always | no refund/return approval, processing, guarantee, or entitlement promise | policy eligibility allowed | “will receive/get a refund” blocks | refund tests |
| `NO_SECRET_REQUEST` | always | no request for password or full card number | explicit warning allowed | conditional/private request also blocks | privacy tests |
| `NO_UNAUTHORIZED_DATA_HANDLING` | always | no storage/share/retention/deletion/encryption/data-policy claim | privacy warning allowed | positive or negative unsupported promise blocks | data-handling tests |
| `NO_RECEIPT_MATERIAL_COLLECTION` | always | no request for receipt image, copy, number, contents, proof, or upload | availability question allowed | “send/provide/upload receipt” blocks | receipt tests |
| `NO_INTERNAL_ENUM` | always | no internal rule/fact enum exposed | ordinary English conclusion allowed | enum-like token blocks | output-contract tests |
| `NO_UNSUPPORTED_CHANNEL_OR_PROCESS` | always | no invented store/portal/email/phone/app/process/timeline/follow-up | generic human support allowed | named channel or process blocks | process tests |
| `EXTRA_PROPOSITIONS_CLASSIFIED` | always | every recognized customer-facing action/promise/policy/data proposition is allowed, prohibited, or explicitly unverifiable | neutral greetings and restatements allowed | unknown critical proposition blocks; neutral text is informational | extra-claim tests |

## 6. Shared implementation and independence

Scoring and delivery use the same frozen rule judgments, so they cannot disagree about policy. The delivery gate still inspects original customer text. Shared extraction creates a common-mode failure risk; a separately authored reference corpus and holdout corpus therefore compare per-rule judgments and failure reasons, not just the final decision. The legacy evaluator remains unchanged for historical reproduction.

## 7. Pre-implementation acceptance criteria

For the declared English scope:

1. Development complete-reference allow rate: 100%.
2. Development omission/contradiction/unauthorized mutation block rate: 100% with the expected rule family.
3. Independently authored holdout correct-reference allow rate: 100%.
4. Holdout violation block rate: 100%; false allows=0 and false blocks=0.
5. Applicable per-duty status agreement and final failure-reason-family agreement: 100% on reference and holdout annotations.
6. Critical `unverifiable` count on expressions declared supported: 0. Unsupported expressions must be visibly counted and blocked rather than counted as correct.
7. Historical path reproduces 20B 70 and final 5/20, and 120B 75 and final 1/20, from unchanged r4 answers.
8. Candidate replay is labelled post-hoc; no provider call, answer modification, retry, or replacement occurs.

If any criterion fails, final status is `EVALUATOR_NOT_READY`. Passing means only `EVALUATOR_VALIDATED_FOR_DECLARED_SCOPE`; it does not validate arbitrary English, either model, a hidden production distribution, or production release.

## 8. Test mapping and provenance

- Main development fixtures: project-authored semantic reference annotations based on this specification.
- Independently authored holdout: a separate agent receives this frozen specification only and writes variants without reading the candidate implementation or r4 answers. Because the filesystem is shared and no cryptographic environment isolation is available, it is described as an independently authored pre-freeze holdout, not a guaranteed blind human benchmark.
- Historical r4 answers: unchanged provider outputs; candidate results are post-hoc diagnostics only.
- No genuine human review record is asserted. All new labels are “semantic reference annotations”.
