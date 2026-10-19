import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkExplanationV2} from '../src/output-guard-v2.js';
import {decisionForQuestionV1} from '../src/returns-decision-v1.js';
import {responseModeV8,promptSnapshot} from '../src/provider.js';
const policy='Standard returns require an unused item within 30 days of purchase with a receipt.';
const next=' Please provide the purchase date. Contact a human support agent for review.';
const unknown=decisionForQuestionV1('Can I return this?');
const dispute=decisionForQuestionV1('I disagree with the decision.');
const check=(raw:string)=>checkExplanationV2(raw,dispute,'plain');
for(const text of [
 'The case is being sent for a human review.','Your request has been forwarded to support.',
 'The ticket was escalated to a human agent.','It will be sent for review.',
 'Your refund is being processed.','Your case is now being transferred.',
 'The request has already been submitted.','Your concern is going to be forwarded.',
 'I sent your case to support.','We have forwarded your request.',
 'I have not forwarded it, but the case is being sent.',
 'The case is not being sent, but it has been escalated.',
 'If you provide the receipt, your case will be forwarded.',
 'I cannot forward anything. Your request is being sent for review.',
])test('block unperformed operation, including passive: '+text,()=>{
 assert.ok(check(text+' Contact a human support agent for review.').failures.includes('no_unsupported_action'));
});
for(const text of [
 'The case is not being sent.','Your request has not been forwarded.',
 'The case has never been escalated.','I have not sent your request.',
 'I cannot forward your request.','I cannot process a refund or change decisions.',
])test('operation denial is not an operation: '+text,()=>{
 assert.equal(check(text+' Contact a human support agent for review.').failures.includes('no_unsupported_action'),false);
});
for(const text of [
 'To see if you can return the item, please provide the purchase date.',
 'We need to determine whether your item is eligible.',
 'A human can determine if you qualify for a return.',
 'You can return the item only if it is unused, within 30 days of purchase, and you have a receipt.',
])test('uncertainty and complete policy condition are not eligibility promises: '+text,()=>{
 assert.equal(checkExplanationV2(text+' '+policy+next,unknown,'plain').failures.includes('no_unsupported_eligibility'),false);
});
for(const text of [
 'You are eligible.','You can return the item.',
 "You're eligible for a return.",'Your item is eligible.',
 'We need to determine if you are eligible, but you can return it.',
 'If the item is unused, you can return it.','You qualify for a return. If unsure, ask a human.',
 'You are eligible, and we can check if you have a receipt.',
])test('conditional language cannot excuse a separate or incomplete promise: '+text,()=>{
 assert.ok(checkExplanationV2(text+' '+policy+next,unknown,'plain').failures.includes('no_unsupported_eligibility'));
});
for(const text of ['Please let me know the purchase date.','Please let us know when you bought it.','Let us know the date of purchase.'])
 test('accept genuine purchase-date clarification: '+text,()=>assert.equal(checkExplanationV2(policy+' '+text,unknown,'plain').passed,true));
for(const text of ['You do not need to let us know the purchase date.','Do not let me know the purchase date.','The purchase date matters.'])
 test('not a clarification request: '+text,()=>assert.ok(checkExplanationV2(policy+' '+text,unknown,'plain').failures.includes('unknown_purchase_date_clarified')));
for(const text of [
 'Unused item with a receipt; purchase was 12 days ago.',
 'Returns require an unused item and receipt.',
])test('do not trade a concrete purchase age for the 30-day policy: '+text,()=>{
 assert.ok(checkExplanationV2(text,decisionForQuestionV1('The item is unused, bought 12 days ago, with a receipt.'),'plain').failures.includes('all_standard_conditions'));
});
for(const text of [
 'I cannot accept passwords or full card numbers. Contact a human support agent.',
 'Do not share passwords. Contact a human support agent.',
 'Do not share full card numbers. Contact a human support agent.',
 'Do not share passwords or full card numbers publicly. Send them privately.',
])test('incomplete privacy notice still blocked: '+text,()=>assert.equal(checkExplanationV2(text,decisionForQuestionV1('Can I share my password and card number?'),'plain').passed,false));
const expected:Record<string,boolean>={eligibility:false,receipt:false,damaged:false,expired:true,privacy:true,action:true,missing:true,escalation:false,format:true,greeting:true,'extra-eligibility':false,'extra-receipt':false,'extra-damaged':true,'extra-expired':false,'extra-privacy':false,'extra-action':true,'extra-missing':true,'extra-escalation':true,'extra-format':false,'extra-greeting':true};
const rows=JSON.parse(readFileSync('tests/v13-raw-regression.json','utf8'));
for(const row of rows)test('untouched v13 real answer regression: '+row.caseId,()=>{
 const result=checkExplanationV2(row.output,decisionForQuestionV1(row.prompt),responseModeV8(row.prompt));
 assert.equal(result.passed,expected[row.caseId],result.failures.join(', '));
 assert.equal(result.delivery.customerOutput,result.passed?row.output:null);
 assert.equal(result.delivery.rewritten,false);
});
test('old v13 prompt snapshot is frozen',()=>assert.deepEqual(promptSnapshot('v13'),JSON.parse(readFileSync('tests/frozen-v13.json','utf8'))));
