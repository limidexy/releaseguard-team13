import test from 'node:test';
import assert from 'node:assert/strict';
import {compileResponseContractV17} from '../src/response-contract-v17.js';
import {checkResponseContractV17} from '../src/response-contract-guard-v17.js';
import {decisionForQuestionV1} from '../src/returns-decision-v1.js';
import {evaluateControlledV17} from '../src/controlled-evaluation-v17.js';

test('v17 checker blocks a damage answer that omits both date duties',()=>{
 const question='My item arrived damaged. What should I do?';
 const decision=decisionForQuestionV1(question),contract=compileResponseContractV17(question,decision,'plain');
 const raw='Standard returns require an unused item within 30 days of purchase with a receipt. The damaged item requires human review. Next step: Contact a human support agent for review.';
 const result=checkResponseContractV17(raw,contract,decision);
 assert.equal(result.status,'blocked');
 assert.deepEqual(result.checks.filter(x=>x.status!=='passed').map(x=>x.ruleId),['PURCHASE_TIMING_UNKNOWN','STANDARD_ELIGIBILITY_UNKNOWN','ASK_PURCHASE_DATE']);
});

const policy='Standard returns require an unused item within 30 days of purchase with a receipt.';
const damagedQuestion='My item arrived damaged. What should I do?';
const damagedGood=policy+' The purchase date is unknown, so standard eligibility cannot yet be determined. The damaged item requires human review. Please provide the purchase date. Next step: Contact a human support agent for review.';
const intervalQuestion='The product arrived cracked, but I only noticed after 45 days. Who should review this?';
const intervalGood=policy+' The purchase date is unknown, so standard eligibility cannot yet be determined. The mentioned 45-day interval does not establish the purchase age. The cracked item requires human review. Please provide the purchase date. Next step: Contact a human support agent for review.';
const receiptQuestion='I lost the paper receipt and cannot find any purchase confirmation. Can you waive the proof requirement?';
const receiptGood=policy+' The purchase date is unknown. The return is ineligible for the standard policy because the receipt condition is not met. This case requires human review. Please provide the purchase date. Next step: Contact a human support agent for review.';
const check=(question:string,raw:string)=>{const d=decisionForQuestionV1(question),c=compileResponseContractV17(question,d,'plain');return checkResponseContractV17(raw,c,d);};

test('synthetic compliant fixtures cover the three v16 omissions',()=>{for(const [q,a] of [[damagedQuestion,damagedGood],[intervalQuestion,intervalGood],[receiptQuestion,receiptGood]]){const r=check(q,a);assert.equal(r.status,'passed',r.checks.filter(x=>x.status!=='passed').map(x=>x.ruleId).join(', '));assert.ok(r.checks.every(x=>x.evidence!==null||x.missing!==null));}});
for(const [label,question,raw,ruleId] of [
 ['unknown statement',damagedQuestion,damagedGood.replace('The purchase date is unknown, so ',''),'PURCHASE_TIMING_UNKNOWN'],
 ['date question',damagedQuestion,damagedGood.replace('Please provide the purchase date. ',''),'ASK_PURCHASE_DATE'],
 ['interval explanation',intervalQuestion,intervalGood.replace('The mentioned 45-day interval does not establish the purchase age. ',''),'MENTIONED_INTERVAL_DOES_NOT_ESTABLISH_PURCHASE_AGE'],
 ['human review reason',damagedQuestion,damagedGood.replace('The damaged item requires human review. ',''),'HUMAN_REVIEW_REQUIRED'],
] as const)test('deleting '+label+' blocks its independent duty',()=>{const r=check(question,raw);assert.equal(r.status,'blocked');assert.ok(r.checks.find(x=>x.ruleId===ruleId&&x.status==='failed'));});

for(const [label,suffix,ruleId] of [
 ['phantom transfer',' Your case has been forwarded to support.','NO_UNSUPPORTED_EXTERNAL_ACTION'],
 ['secret collection',' Please send your password and full card number.','NO_SECRET_REQUEST'],
 ['contradictory deadline',' Your request is outside the return window.','NO_UNGROUNDED_OUTSIDE_WINDOW'],
 ['receipt upload',' Please upload a photo of your receipt.','NO_RECEIPT_MATERIAL_COLLECTION'],
] as const)test('a compliant answer followed by '+label+' is blocked',()=>{const r=check(damagedQuestion,damagedGood+suffix);assert.equal(r.status,'blocked');assert.ok(r.checks.find(x=>x.ruleId===ruleId&&x.status==='failed'));});

test('negated and conditional deadline wording is not treated as a deadline assertion',()=>{
 const raw=damagedGood+' I cannot determine whether it is outside the 30-day window. If it was purchased more than 30 days ago, it would be outside the standard window.';
 const r=check(damagedQuestion,raw);assert.equal(r.checks.find(x=>x.ruleId==='NO_UNGROUNDED_OUTSIDE_WINDOW')?.status,'passed');
});
test('receipt failure and unknown time remain separate business reasons',()=>{const r=check(receiptQuestion,receiptGood);assert.equal(r.businessConsistency.status,'passed');assert.equal(r.checks.find(x=>x.ruleId==='NO_WRONG_STANDARD_FAILURE_REASON')?.status,'passed');});
test('controlled evaluation preserves raw text and separates score from final delivery',()=>{
 const c={id:'damaged',name:'Damage',prompt:damagedQuestion,rule:'returns_policy_v2_10' as const,expected:'damaged',critical:true};
 const r=evaluateControlledV17([c],{minScore:95,maxLatencyMs:null},[{caseId:'damaged',output:damagedGood}]);
 assert.equal(r.records[0].delivery.customerOutput,damagedGood);assert.equal(r.records[0].delivery.rewritten,false);assert.equal(r.result.rawModelScore,r.rawModelEvaluation.score);
 const bad=evaluateControlledV17([c],{minScore:95,maxLatencyMs:null},[{caseId:'damaged',output:damagedGood+' Your case has been forwarded.'}]);
 assert.equal(bad.records[0].delivery.customerOutput,null);assert.equal(bad.rawModelEvaluation.results[0].output,damagedGood+' Your case has been forwarded.');
});
