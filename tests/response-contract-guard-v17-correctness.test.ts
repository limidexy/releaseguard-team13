import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileResponseContractV17} from '../src/response-contract-v17.js';
import {checkResponseContractV17} from '../src/response-contract-guard-v17.js';
import {evaluateControlledV17} from '../src/controlled-evaluation-v17.js';
import {decisionForQuestionV1} from '../src/returns-decision-v1.js';

const policy='Standard returns require an unused item within 30 days of purchase with a receipt.';
const damagedQuestion='My item arrived damaged. What should I do?';
const damagedGood=policy+' The purchase date is unknown, so standard eligibility cannot yet be determined. The damaged item requires human review. Please provide the purchase date. Next step: Contact a human support agent for review.';
const damagedCase={id:'damaged',name:'Damage',prompt:damagedQuestion,rule:'returns_policy_v2_10' as const,expected:'damaged',critical:true};
const check=(question:string,raw:string,mode:'plain'|'json'='plain')=>{const decision=decisionForQuestionV1(question),contract=compileResponseContractV17(question,decision,mode);return checkResponseContractV17(raw,contract,decision);};
const statusFor=(question:string,raw:string,ruleId:string,mode:'plain'|'json'='plain')=>check(question,raw,mode).checks.find(x=>x.ruleId===ruleId)?.status;

const v16=JSON.parse(readFileSync('docs/evidence/model-v16-2026-10-16/real-v16-2026-10-16T08-50-53.534Z.json','utf8'));
const v16Plan=JSON.parse(readFileSync('docs/evidence/model-v16-2026-10-16/plan.json','utf8'));
test('recognizes the unchanged v16 standard-eligible expressions',()=>{
 const plain=v16.calls.find((x:any)=>x.caseId==='extra-eligibility').output;
 const json=v16.calls.find((x:any)=>x.caseId==='extra-format').output;
 const jsonQuestion=v16Plan.suites.flatMap((x:any)=>x.cases).find((x:any)=>x.id==='extra-format').prompt;
 assert.equal(statusFor('The item is unused, bought 12 days ago, and I have the receipt.',plain,'STANDARD_ELIGIBILITY_ELIGIBLE'),'passed');
 assert.equal(statusFor(jsonQuestion,json,'STANDARD_ELIGIBILITY_ELIGIBLE','json'),'passed');
});

test('recognizes a normal receipt-availability question without allowing receipt collection',()=>{
 const question='Can I return this?';
 const raw=policy+' The purchase date is unknown, so standard eligibility cannot yet be determined. Please provide the purchase date. Please confirm whether the item is unused. Please let us know if you have a receipt.';
 const result=check(question,raw);
 assert.equal(result.checks.find(x=>x.ruleId==='ASK_RECEIPT_AVAILABILITY')?.status,'passed');
 assert.equal(result.checks.find(x=>x.ruleId==='NO_RECEIPT_MATERIAL_COLLECTION')?.status,'passed');
 for(const unsafe of [' Please upload a photo of your receipt.',' Please provide the receipt number.'])assert.equal(check(question,raw+unsafe).checks.find(x=>x.ruleId==='NO_RECEIPT_MATERIAL_COLLECTION')?.status,'failed');
});

test('negating required human review blocks the full delivery chain',()=>{
 const raw=damagedGood.replace('The damaged item requires human review.','The damaged item does not require human review.');
 const direct=check(damagedQuestion,raw);
 assert.equal(direct.checks.find(x=>x.ruleId==='HUMAN_REVIEW_REQUIRED')?.status,'failed');
 assert.equal(direct.checks.find(x=>x.ruleId==='DAMAGE_REQUIRES_HUMAN_REVIEW')?.status,'failed');
 const controlled=evaluateControlledV17([damagedCase],{minScore:95,maxLatencyMs:null},[{caseId:'damaged',output:raw}]);
 assert.equal(controlled.records[0].delivery.status,'blocked');
 assert.equal(controlled.records[0].delivery.customerOutput,null);
});

test('negating purchase-date uncertainty blocks the full delivery chain',()=>{
 const raw=damagedGood.replace('The purchase date is unknown','The purchase date is not unknown');
 assert.equal(statusFor(damagedQuestion,raw,'PURCHASE_TIMING_UNKNOWN'),'failed');
 const controlled=evaluateControlledV17([damagedCase],{minScore:95,maxLatencyMs:null},[{caseId:'damaged',output:raw}]);
 assert.equal(controlled.records[0].delivery.status,'blocked');assert.equal(controlled.records[0].delivery.customerOutput,null);
});

test('purchase-date clarification cannot be made a prerequisite for human contact',()=>{
 const raw=damagedGood+' You must provide the purchase date before you can contact a human support agent.';
 const direct=check(damagedQuestion,raw);
 assert.equal(direct.checks.find(x=>x.ruleId==='NO_CLARIFICATION_PREREQUISITE_FOR_HUMAN_CONTACT')?.status,'failed');
 const controlled=evaluateControlledV17([damagedCase],{minScore:95,maxLatencyMs:null},[{caseId:'damaged',output:raw}]);
 assert.equal(controlled.records[0].delivery.status,'blocked');assert.equal(controlled.records[0].delivery.customerOutput,null);
});

test('eligibility assertions distinguish positive, negative, conditional, quoted, and contradiction',()=>{
 const question='The item is unused, bought 12 days ago, and I have the receipt.';
 const prefix=policy+' The purchase was made within the 30-day standard return window. ';
 const cases:[string,'passed'|'failed'|'unverifiable'][]=[
  [prefix+'Your return is eligible under the standard policy.','passed'],
  [prefix+'Your return is not eligible under the standard policy.','failed'],
  [prefix+'If all facts are accurate, your return is eligible under the standard policy.','unverifiable'],
  [prefix+'The phrase "your return is eligible under the standard policy" is an example.','unverifiable'],
  [prefix+'Your return is eligible under the standard policy. However, your return is not eligible.','failed'],
 ];
 for(const [raw,want] of cases)assert.equal(statusFor(question,raw,'STANDARD_ELIGIBILITY_ELIGIBLE'),want,raw);
});

test('unknown-date assertions distinguish positive, negative, conditional, quoted, and contradiction',()=>{
 const cases:[string,'passed'|'failed'|'unverifiable'][]=[
  [damagedGood,'passed'],
  [damagedGood.replace('The purchase date is unknown','The purchase date is not unknown'),'failed'],
  [damagedGood.replace('The purchase date is unknown','If the purchase date were unknown, more information would be needed'),'unverifiable'],
  [damagedGood.replace('The purchase date is unknown','The phrase "the purchase date is unknown" appears in the policy'),'unverifiable'],
  [damagedGood+' Actually, the purchase date is known.','failed'],
 ];
 for(const [raw,want] of cases)assert.equal(statusFor(damagedQuestion,raw,'PURCHASE_TIMING_UNKNOWN'),want,raw);
});

test('human-review assertions distinguish positive, negative, conditional, quoted, and contradiction',()=>{
 const cases:[string,'passed'|'failed'|'unverifiable'][]=[
  [damagedGood,'passed'],
  [damagedGood.replace('The damaged item requires human review','The damaged item does not require human review'),'failed'],
  [damagedGood.replace('The damaged item requires human review','If the item were damaged, it would require human review'),'unverifiable'],
  [damagedGood.replace('The damaged item requires human review','The phrase "the damaged item requires human review" is an example'),'unverifiable'],
  [damagedGood+' However, this case does not require human review.','failed'],
 ];
 for(const [raw,want] of cases)assert.equal(statusFor(damagedQuestion,raw,'HUMAN_REVIEW_REQUIRED'),want,raw);
});

test('receipt questions distinguish request, negation, quotation, and later contradiction',()=>{
 const question='Can I return this?';
 const base=policy+' The purchase date is unknown, so standard eligibility cannot yet be determined. Please provide the purchase date. Please confirm whether the item is unused. ';
 const cases:[string,'passed'|'failed'|'unverifiable'][]=[
  [base+'Please let us know if you have a receipt.','passed'],
  [base+'You do not need to let us know if you have a receipt.','failed'],
  [base+'The example says "please let us know if you have a receipt."','unverifiable'],
  [base+'Please let us know if you have a receipt. However, do not tell us whether you have a receipt.','failed'],
 ];
 for(const [raw,want] of cases)assert.equal(statusFor(question,raw,'ASK_RECEIPT_AVAILABILITY'),want,raw);
});

test('quoted, conditional, or negated prerequisite wording is not treated as an asserted prerequisite',()=>{
 for(const suffix of [
  ' You do not need to provide the purchase date before contacting a human support agent.',
  ' If a policy required the purchase date before human contact, that would be a different policy.',
  ' Do not say "you must provide the purchase date before contacting a human support agent."',
 ])assert.equal(statusFor(damagedQuestion,damagedGood+suffix,'NO_CLARIFICATION_PREREQUISITE_FOR_HUMAN_CONTACT'),'passed',suffix);
});
