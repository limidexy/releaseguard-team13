import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateResponseNextV2} from '../src/evaluator-next-v2.js';
import {decisionForQuestionV1} from '../src/returns-decision-v1.js';
import {compileResponseContractV17} from '../src/response-contract-v17.js';
const policy='Standard returns require an unused item within 30 days of purchase and a receipt. ';
const clarify='The purchase date is unknown. Standard eligibility cannot yet be determined. What was the purchase date? Is the item unused? Do you have a receipt?';
const damage=policy+'The purchase date is unknown. Standard eligibility cannot yet be determined. The damaged item requires human review. What was the purchase date? You may contact human support.';
const action=policy+'The purchase date is unknown. Standard eligibility cannot yet be determined. Human review is required. I cannot issue refunds, change decisions, forward requests, or contact people. What was the purchase date? You may contact human support.';
function evaluate(raw:string,question='Hello. Can you help with a return?',mode:'plain'|'json'='plain'){
 const d=decisionForQuestionV1(question),c=compileResponseContractV17(question,d,mode);return evaluateResponseNextV2(raw,c,d);
}
function blocked(raw:string,id:string,q?:string,mode:'plain'|'json'='plain'){
 const r=evaluate(raw,q,mode);assert.equal(r.finalDeliveryStatus,'blocked');assert.equal(r.delivery.customerOutput,null);assert.ok(r.checks.some(x=>x.ruleId===id&&x.status!=='passed'),JSON.stringify(r.checks.filter(x=>x.status!=='passed')));
}
test('v2: explicit date-unknown negation is not satisfied by the word unknown',()=>{
 blocked((policy+clarify).replace('is unknown','is not unknown'),'PURCHASE_TIMING_UNKNOWN');
});
test('v2: a correct review statement cannot cancel a later denial',()=>{
 blocked(damage+' This damaged case does not require human review.','HUMAN_REVIEW_REQUIRED','My item arrived damaged. What should I do?');
});
test('v2: conditional or quoted review is not a case-specific requirement',()=>{
 for(const replacement of ['If damage is confirmed, the item requires human review.','“The damaged item requires human review.”'])blocked(damage.replace('The damaged item requires human review.',replacement),'HUMAN_REVIEW_REQUIRED','My item arrived damaged. What should I do?');
});
test('v2: an unrelated eligibility negation does not negate mandatory human review',()=>{
 const r=evaluate(damage.replace('The damaged item requires human review.','The return does not qualify, and a human must review the damaged item.'),'My item arrived damaged. What should I do?');
 assert.equal(r.checks.find(x=>x.ruleId==='HUMAN_REVIEW_REQUIRED')?.status,'passed');
});
test('v2: a warning does not excuse a separate secret request in the same sentence',()=>{
 blocked(policy+clarify+' Do not share your password, and provide your full card number.','NO_SECRET_REQUEST');
});
test('v2: denial of one capability cannot excuse a separately offered capability',()=>{
 blocked(action+' I cannot issue refunds, and I can forward this request.','NO_UNSUPPORTED_EXTERNAL_ACTION','Please process my refund now.');
});
test('v2: unsupported negative data-handling claims are still policy inventions',()=>{
 blocked(policy+clarify+' We never store passwords or full card numbers.','NO_UNAUTHORIZED_DATA_HANDLING');
});
test('v2: customer contact does not excuse a later system-initiated promise',()=>{
 blocked(action+' Human support can be contacted by you, and we will contact another person.','NO_UNSUPPORTED_EXTERNAL_ACTION','Please process my refund now.');
});
test('v2: JSON boolean cannot cancel a contradictory string field',()=>{
 const raw=JSON.stringify({eligible:true,reason:policy+'Your purchase is within the 30-day window. Your return is eligible under the standard policy.',nextStep:'Your return is not eligible under the standard policy.'});
 blocked(raw,'JSON_ELIGIBLE_CONSISTENCY','The item is unused, bought 12 days ago, and I have a receipt.','json');
});
test('v2: Unicode and decoded JSON evidence points exactly to original field text',()=>{
 const raw=JSON.stringify({eligible:false,reason:'Hello 👋. '+policy+clarify,nextStep:'Use this as a policy explanation.'}),r=evaluate(raw,undefined,'json');
 assert.equal(r.finalDeliveryStatus,'allowed');
 for(const p of r.parsed.propositions){const field=p.evidence.path==='$.reason'?JSON.parse(raw).reason:JSON.parse(raw).nextStep;assert.equal(field.slice(p.evidence.start,p.evidence.end),p.evidence.text);}
 assert.equal(r.delivery.customerOutput,raw);
});
test('v2: provider error always blocks without changing the raw response',()=>{
 const d=decisionForQuestionV1('Hello. Can you help with a return?'),c=compileResponseContractV17('Hello. Can you help with a return?',d,'plain'),raw=policy+clarify;
 const r=evaluateResponseNextV2(raw,c,d,'Provider HTTP 429');assert.equal(r.delivery.customerOutput,null);assert.equal(r.parsed.original,raw);
});
test('v2: listing an age and the generic policy does not state a case-window conclusion',()=>{
 blocked(policy+'You bought the item 12 days ago. Your return is eligible under the standard policy.','PURCHASE_WITHIN_STANDARD_WINDOW','The item is unused, bought 12 days ago, and I have a receipt.');
});
test('v2: known-case timing contradictions and invented ages remain blocked',()=>{
 const q='The item is unused, bought 12 days ago, and I have a receipt.';
 const good=policy+'Your purchase is within the 30-day window. Your return is eligible under the standard policy.';
 blocked(good+' Your purchase is outside the window.','BUSINESS_WINDOW_CONSISTENCY',q);
 blocked(good+' You purchased it 29 days ago.','FACT_PURCHASE_AGE_CONSISTENCY',q);
});
test('v2: disjunctive or contradicted policy does not satisfy the required conjunction',()=>{
 blocked((policy+clarify).replace('an unused item within 30 days of purchase and a receipt','an unused item within 30 days of purchase or a receipt'),'STANDARD_POLICY');
 blocked(policy+clarify+' The receipt is not required under the standard policy.','STANDARD_POLICY');
});
test('v2: critical double negation is visibly unverifiable, not forced to pass',()=>{
 const r=evaluate((policy+clarify).replace('is unknown','is not not unknown'));
 assert.equal(r.finalDeliveryStatus,'blocked');assert.ok(r.checks.some(x=>x.status==='unverifiable'));
});
