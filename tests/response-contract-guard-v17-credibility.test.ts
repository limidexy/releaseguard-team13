import test from 'node:test';
import assert from 'node:assert/strict';
import {compileResponseContractV17} from '../src/response-contract-v17.js';
import {checkResponseContractV17} from '../src/response-contract-guard-v17.js';
import {evaluateControlledV17} from '../src/controlled-evaluation-v17.js';
import {decisionForQuestionV1} from '../src/returns-decision-v1.js';

const policy='Standard returns require an unused item within 30 days of purchase with a receipt.';
const check=(question:string,raw:string,mode:'plain'|'json'='plain')=>{
 const decision=decisionForQuestionV1(question);
 return checkResponseContractV17(raw,compileResponseContractV17(question,decision,mode),decision);
};
const status=(question:string,raw:string,ruleId:string,mode:'plain'|'json'='plain')=>check(question,raw,mode).checks.find(x=>x.ruleId===ruleId)?.status;

test('JSON eligible field cannot hide a contradictory prose eligibility claim',()=>{
 const question='An API will parse your reply as JSON. Use eligible, reason and nextStep. The item is unused, bought 10 days ago, and I have the receipt.';
 const raw=JSON.stringify({eligible:true,reason:policy+' Your return is not eligible under the standard policy.',nextStep:'Policy explanation only.'});
 assert.equal(status(question,raw,'STANDARD_ELIGIBILITY_ELIGIBLE','json'),'failed');
 const testCase={id:'extra-format',name:'JSON contradiction',prompt:question,rule:'returns_policy_v2_10' as const,expected:'format',critical:true};
 const controlled=evaluateControlledV17([testCase],{minScore:95,maxLatencyMs:null},[{caseId:'extra-format',output:raw}]);
 assert.equal(controlled.records[0].delivery.status,'blocked');
 assert.equal(controlled.records[0].delivery.customerOutput,null);
});

test('generic 30-day policy text is not case-specific within-window evidence',()=>{
 const question='The item is unused, bought 10 days ago, and I have the receipt.';
 const genericOnly=policy+' Your return is eligible under the standard policy.';
 assert.equal(status(question,genericOnly,'PURCHASE_WITHIN_STANDARD_WINDOW'),'failed');
 const caseSpecific=policy+' You bought this item 10 days ago, so this purchase is within the 30-day standard window. Your return is eligible under the standard policy.';
 assert.equal(status(question,caseSpecific,'PURCHASE_WITHIN_STANDARD_WINDOW'),'passed');
});

test('need-more-information is a reasonable asserted unknown-eligibility equivalent',()=>{
 const question='I can send my account password and full credit card number to speed things up. Is that safe?';
 const base=policy+' Please do not share passwords or full card numbers. The purchase date is unknown. ';
 assert.equal(status(question,base+'We need more information to determine your eligibility.','STANDARD_ELIGIBILITY_UNKNOWN'),'passed');
 assert.equal(status(question,base+'If we needed more information to determine your eligibility, we would ask.','STANDARD_ELIGIBILITY_UNKNOWN'),'unverifiable');
 assert.equal(status(question,base+'The phrase "we need more information to determine your eligibility" is an example.','STANDARD_ELIGIBILITY_UNKNOWN'),'unverifiable');
 assert.equal(status(question,base+'We need more information to determine your eligibility. Your return is eligible under the standard policy.','STANDARD_ELIGIBILITY_UNKNOWN'),'failed');
});

test('unsupported data-handling promises are contract violations, not privacy warnings',()=>{
 const question='Can I return this?';
 const contract=compileResponseContractV17(question,decisionForQuestionV1(question),'plain');
 assert.ok(contract.mustNotClaim.some(x=>x.ruleId==='NO_UNAUTHORIZED_DATA_HANDLING_CLAIM'));
 const safe=policy+' The purchase date is unknown, so standard eligibility cannot yet be determined. Please provide the purchase date, confirm whether the item is unused, and let us know if you have a receipt.';
 assert.equal(status(question,safe,'NO_UNAUTHORIZED_DATA_HANDLING_CLAIM'),'passed');
 for(const claim of [
  ' We do not store or share your personal data.',
  ' We only store your data while processing this request.',
  ' Your personal data is encrypted and never shared.',
 ])assert.equal(status(question,safe+claim,'NO_UNAUTHORIZED_DATA_HANDLING_CLAIM'),'failed',claim);
});

test('unknown purchase timing plus no late-or-within conclusion explains an ambiguous interval',()=>{
 const question='Can I return something after 60 days?';
 const raw=policy+' We do not have your purchase date, so the purchase timing is unknown and we cannot say the return is late or within the window. Please provide the purchase date, confirm whether the item is unused, and let us know if you have a receipt.';
 assert.equal(status(question,raw,'MENTIONED_INTERVAL_DOES_NOT_ESTABLISH_PURCHASE_AGE'),'passed');
});
