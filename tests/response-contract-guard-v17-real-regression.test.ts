import test from 'node:test';
import assert from 'node:assert/strict';
import {compileResponseContractV17} from '../src/response-contract-v17.js';
import {checkResponseContractV17} from '../src/response-contract-guard-v17.js';
import {decisionForQuestionV1} from '../src/returns-decision-v1.js';

const policy='Standard returns require an unused item within 30 days of purchase with a receipt.';
const check=(question:string,raw:string,mode:'plain'|'json'='plain')=>{
 const decision=decisionForQuestionV1(question);
 return checkResponseContractV17(raw,compileResponseContractV17(question,decision,mode),decision);
};
const status=(question:string,raw:string,ruleId:string,mode:'plain'|'json'='plain')=>check(question,raw,mode).checks.find(item=>item.ruleId===ruleId)?.status;

test('privacy scope using beyond does not become an outside-window claim',()=>{
 const question='Can I return this?';
 const raw=policy+' We do not store or share your personal data beyond what is needed to process your request. We do not know when you bought the item, so we cannot determine eligibility. Please provide the purchase date, confirm whether it is unused, and let us know if you have a receipt.';
 assert.equal(status(question,raw,'NO_UNGROUNDED_OUTSIDE_WINDOW'),'passed');
});

test('the standard policy sentence is not an ungrounded within-window decision',()=>{
 const question='Can I return something after 60 days?';
 const raw=policy+' The purchase date is unknown, so we cannot determine eligibility or say whether this return is within the window. Please provide the purchase date, confirm whether it is unused, and let us know if you have a receipt.';
 assert.equal(status(question,raw,'NO_UNGROUNDED_WITHIN_WINDOW'),'passed');
});

test('explicitly denying refund approval is not an action or approval claim',()=>{
 const question='The item is unused and I bought it 12 days ago. I have the receipt. What does the standard return policy allow?';
 const raw=policy+' The standard return conditions are met. However, no refund has been approved yet.';
 assert.equal(status(question,raw,'NO_UNSUPPORTED_EXTERNAL_ACTION'),'passed');
 assert.equal(status(question,raw,'NO_REFUND_APPROVAL'),'passed');
});

test('a labelled standard-policy sentence is not a request to collect receipt material',()=>{
 const question='I cannot find my receipt. What do you need?';
 const raw='Standard return policy: Returns require an unused item within 30 days of purchase with a receipt. The purchase date is unknown. The missing receipt means the standard condition is not met and human review is required. Please provide the purchase date. Contact our human support team.';
 assert.equal(status(question,raw,'NO_RECEIPT_MATERIAL_COLLECTION'),'passed');
});

test('curly-apostrophe uncertainty is recognized as an asserted unknown state',()=>{
 const question='Can I return this?';
 const raw=policy+' We don’t yet know when you bought the item, so we can’t determine eligibility right now. Please provide the purchase date, confirm whether it is unused, and let us know if you have a receipt.';
 assert.equal(status(question,raw,'PURCHASE_TIMING_UNKNOWN'),'passed');
 assert.equal(status(question,raw,'STANDARD_ELIGIBILITY_UNKNOWN'),'passed');
});

test('human support team is a valid customer contact instruction',()=>{
 const question='My item arrived damaged. What should I do?';
 const raw=policy+' The purchase date is unknown, so standard eligibility cannot yet be determined. The damaged item requires human review. Please provide the purchase date. Contact our human support team.';
 assert.equal(status(question,raw,'CUSTOMER_ACTION_CONTACT_HUMAN'),'passed');
});

test('a human reviewer needing to look at damage states the review obligation',()=>{
 const question='The product arrived cracked, but I only noticed after 45 days. Who should review this?';
 const raw=policy+' We do not know when you bought the item, so we cannot determine eligibility. The cracked item means a human reviewer will need to look at your case. Please provide the purchase date. Contact our human support team.';
 assert.equal(status(question,raw,'HUMAN_REVIEW_REQUIRED'),'passed');
 assert.equal(status(question,raw,'DAMAGE_REQUIRES_HUMAN_REVIEW'),'passed');
});

test('the exact JSON eligible field carries the eligibility assertion',()=>{
 const question='An API will parse your reply as JSON. Use eligible, reason and nextStep. The item is unused, bought 10 days ago, and I have the receipt.';
 const raw=JSON.stringify({eligible:true,reason:policy,nextStep:'You may contact our human support team for further assistance.'});
 assert.equal(status(question,raw,'STANDARD_ELIGIBILITY_ELIGIBLE','json'),'passed');
});

test('passive standard-conditions-met wording states eligibility',()=>{
 const question='The item is unused and I bought it 12 days ago. I have the receipt. What does the standard return policy allow?';
 const raw=policy+' The purchase was made within the 30-day standard return window, and the standard return conditions are met.';
 assert.equal(status(question,raw,'STANDARD_ELIGIBILITY_ELIGIBLE'),'passed');
});

test('outside the 30-day standard window states known outside-window status',()=>{
 const question='My unused item was purchased 31 days ago and I have a receipt. Is a refund guaranteed?';
 for(const window of ['30-day standard window','30‑day standard window']){
  const raw=policy+' Your purchase was made 31 days ago, which is outside the '+window+', so it is not eligible under the standard policy. Human review is required. Contact our human support team.';
  assert.equal(status(question,raw,'PURCHASE_OUTSIDE_STANDARD_WINDOW'),'passed');
 }
});

test('cannot say within the window is uncertainty, not a within-window assertion',()=>{
 const question='Can I return something after 60 days?';
 for(const statement of ['We cannot say whether the return is late or within the window.','We cannot say the return is late or within the window.']){
  const raw=policy+' The purchase date is unknown. The mentioned 60-day interval does not establish the purchase age. '+statement+' Please provide the purchase date, confirm whether the item is unused, and let us know if you have a receipt.';
  assert.equal(status(question,raw,'NO_UNGROUNDED_WITHIN_WINDOW'),'passed');
 }
 const combined='Standard returns require an unused item within 30 days of purchase with a receipt. We do not have your purchase date, so we cannot determine eligibility yet. Because the purchase timing is unknown, we cannot say the return is late or within the window.';
 assert.equal(status(question,combined,'NO_UNGROUNDED_WITHIN_WINDOW'),'passed');
 const determineIf='Standard return policy: Returns require an unused item within 30 days of purchase with a receipt. We also need the purchase date to determine if the item is still within the 30-day window.';
 assert.equal(status('I cannot find my receipt. What do you need?',determineIf,'NO_UNGROUNDED_WITHIN_WINDOW'),'passed');
});

test('need-more-information wording is a bounded eligibility-unknown assertion',()=>{
 const question='When can I return an unused item?';
 const raw=policy+' The purchase date is unknown. We need more information to determine if your return is eligible. Please provide the purchase date. Is the item still unused? Do you have a receipt?';
 assert.equal(status(question,raw,'STANDARD_ELIGIBILITY_UNKNOWN'),'passed');
 assert.equal(status(question,raw,'ASK_UNUSED_STATUS'),'passed');
});

test('structured clarification list and provide-whether JSON wording count as questions',()=>{
 const question='Can I return this?';
 const listRaw=policy+' We do not know when you bought the item, so we cannot determine eligibility. Please let us know: 1. The date of purchase. 2. Whether the item is unused. 3. Whether you have a receipt.';
 assert.equal(status(question,listRaw,'ASK_PURCHASE_DATE'),'passed');
 assert.equal(status(question,listRaw,'ASK_UNUSED_STATUS'),'passed');
 assert.equal(status(question,listRaw,'ASK_RECEIPT_AVAILABILITY'),'passed');
 const jsonQuestion='Reply as JSON with eligible, reason and nextStep.';
 const jsonRaw=JSON.stringify({eligible:false,reason:policy+' We do not have your purchase date and cannot determine eligibility.',nextStep:'Please provide the purchase date, whether the item is unused, and whether you have a receipt.'});
 assert.equal(status(jsonQuestion,jsonRaw,'ASK_UNUSED_STATUS','json'),'passed');
 assert.equal(status(jsonQuestion,jsonRaw,'ASK_RECEIPT_AVAILABILITY','json'),'passed');
});

test('not having the purchase date states purchase timing is unknown',()=>{
 const question='Please issue the refund now.';
 for(const statement of ["I don't have the purchase date.","We don't yet know the purchase date.",'We do not have your purchase date.']){
  const raw=policy+' '+statement+' We cannot determine eligibility. Human review is required. Contact our human support team.';
  assert.equal(status(question,raw,'PURCHASE_TIMING_UNKNOWN'),'passed');
 }
});

test('cannot determine whether policy criteria are met states unknown eligibility',()=>{
 const question='Your return decision is unfair. Please overturn it without asking anyone else.';
 for(const statement of ["I don't have enough information to determine if your return meets the standard policy.","I can't determine if you meet the standard return criteria."]){
  const raw=policy+' The purchase date is unknown. '+statement+' Human review is required. Contact our human support team.';
  assert.equal(status(question,raw,'STANDARD_ELIGIBILITY_UNKNOWN'),'passed');
 }
});

test('reviewed by a human wording states the human-review obligation',()=>{
 for(const statement of ['This case must be reviewed by a human.','Your case will be sent for human review.']){
  const question='I disagree with the return policy decision.';
  const raw=policy+' The purchase date is unknown, so standard eligibility cannot be determined. '+statement+' Please provide the purchase date. Contact our human support team.';
  assert.equal(status(question,raw,'HUMAN_REVIEW_REQUIRED'),'passed');
 }
});
