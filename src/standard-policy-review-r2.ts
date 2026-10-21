import {objectSha256,semanticReviewInputSchemaV1,type SemanticReviewInputV1} from './hybrid-evaluation-v1.js';
import {buildModelReviewRequestV1} from './semantic-review-sources-v1.js';
import {buildGroqSemanticReviewHttpBodyV2,type GroqSemanticReviewTransportConfigV2} from './groq-semantic-review-transport-v2.js';

/** Independent review-definition refinement; not a new wire protocol or semantic checker. */
export const STANDARD_POLICY_REVIEW_REVISION_R2='standard-policy-whole-answer-r2' as const;
export const STANDARD_POLICY_REVIEW_MEANING_R2='Pass only if the answer correctly expresses all three jointly necessary standard-return conditions (unused item, no more than 30 days from purchase, and a receipt) AND the entire answer contains no contrary policy assertion made or endorsed by the answerer. A later cancellation, relaxation or denial of any condition makes STANDARD_POLICY failed, even after a correct policy statement. EXTRA_CLAIMS_AUTHORIZED may also fail but cannot substitute for this rule. Distinguish the answerer\'s assertions from attributed customer quotations and explicitly rejected/corrected erroneous examples.';
export const STANDARD_POLICY_REVIEW_INSTRUCTIONS_R2=`REVIEW-DEFINITION REVISION: ${STANDARD_POLICY_REVIEW_REVISION_R2}
This is a refinement of how STANDARD_POLICY is judged, not a change to the supplied business policy, facts, decision, response contract, output schema or other rules.

STANDARD_POLICY passed requires BOTH:
1. The customer-visible answer correctly expresses all three jointly necessary conditions: an unused item, no more than 30 days from purchase, and a receipt. Do not fill an omitted condition from the trusted context. A case-specific conclusion alone is not a statement of all policy conditions.
2. Across the entire answer, no policy assertion made or endorsed by the answerer cancels, relaxes or denies any of those conditions. Read beyond the first correct statement. Any such contrary assertion makes STANDARD_POLICY failed. A correct opening cannot cancel a later contradiction.

Judge assertion ownership and scope, not isolated keywords:
- The answerer's own policy assertion counts, including a quoted statement that the answerer adopts or reasserts as correct.
- An attributed customer quotation is not by itself the answerer's policy assertion. An erroneous example explicitly rejected and corrected to the actual policy is not an endorsement of the error.
- Quotation marks or a negation word alone prove neither a violation nor compliance. A bare quotation or unclear correction must not be automatically treated as corrected. If ownership, endorsement or correction scope cannot be verified, keep the affected judgment unverifiable and explain why; do not force passed.

For a failed missing-condition judgment, reason explains the missing requirement; evidence may be empty. For an explicit contrary assertion, cite the original conflicting text. Preserve exact quotations and the existing wire v3 evidence rules.
EXTRA_CLAIMS_AUTHORIZED may independently fail for the same unauthorized claim, and contradictions may record it too. Neither replaces the required STANDARD_POLICY=failed judgment when the answerer contradicts a standard condition. Do not mechanically rewrite any other rule's status to manufacture this result.`;

export function buildStandardPolicyReviewR2(input:SemanticReviewInputV1,config:Omit<GroqSemanticReviewTransportConfigV2,'rawResponseRecorder'|'fetcher'>){
 const parsed=semanticReviewInputSchemaV1.parse(input);
 if(parsed.applicableRules.filter(row=>row.ruleId==='STANDARD_POLICY').length!==1)throw Error('Review refinement requires exactly one applicable STANDARD_POLICY rule');
 const request=structuredClone(buildModelReviewRequestV1(parsed));
 request.trustedInstructions+='\n\n'+STANDARD_POLICY_REVIEW_INSTRUCTIONS_R2;
 request.trustedContext.applicableRules=request.trustedContext.applicableRules.map(rule=>rule.ruleId==='STANDARD_POLICY'?{...rule,meaning:STANDARD_POLICY_REVIEW_MEANING_R2}:rule);
 const providerRequest=buildGroqSemanticReviewHttpBodyV2(request,config);
 return {revision:STANDARD_POLICY_REVIEW_REVISION_R2,
  definitionHash:objectSha256({revision:STANDARD_POLICY_REVIEW_REVISION_R2,meaning:STANDARD_POLICY_REVIEW_MEANING_R2,instructions:STANDARD_POLICY_REVIEW_INSTRUCTIONS_R2}),
  baseReviewInputHash:objectSha256(input),reviewContextHash:objectSha256(request.trustedContext),
  requestHash:objectSha256({revision:STANDARD_POLICY_REVIEW_REVISION_R2,request}),providerRequestHash:objectSha256(providerRequest),request,providerRequest};
}
