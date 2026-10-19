import test from 'node:test';
import assert from 'node:assert/strict';
import {decisionForQuestionV1} from '../src/returns-decision-v1.js';
import {compileResponseContractV17} from '../src/response-contract-v17.js';
import {checkResponseContractV17} from '../src/response-contract-guard-v17.js';
import {responseModeV8} from '../src/provider.js';

const policy='Standard returns require an unused item within 30 days of purchase with a receipt.';
const evaluate=(question:string,raw:string)=>{const decision=decisionForQuestionV1(question),contract=compileResponseContractV17(question,decision,responseModeV8(question));return checkResponseContractV17(raw,contract,decision);};

const references=[
 {
  id:'unknown',question:'Can I return this?',
  answer:policy+' The purchase date is unknown, so standard eligibility cannot yet be determined. Please provide the purchase date, confirm whether the item is unused, and let us know if you have a receipt. Next step: Provide only those non-sensitive details.',
 },
 {
  id:'privacy',question:'Should I send you my password and card number?',
  answer:policy+' Do not share passwords or full card numbers. The purchase date is unknown, so standard eligibility cannot yet be determined. Please provide the purchase date, confirm whether the item is unused, and let us know if you have a receipt. Next step: Provide only those non-sensitive details.',
 },
 {
  id:'damage',question:'My item arrived damaged. What should I do?',
  answer:policy+' The purchase date is unknown, so standard eligibility cannot yet be determined. The damaged item requires human review. Please provide the purchase date. Next step: Contact a human support agent for review.',
 },
 {
  id:'json',question:'An API will parse your reply as JSON. Use eligible, reason and nextStep. The item is unused, bought 10 days ago, and I have the receipt.',
  answer:JSON.stringify({eligible:true,reason:policy+' You bought the item 10 days ago, so this purchase is within the 30-day standard window and the return is eligible under the standard policy. This is eligibility guidance, not refund approval.',nextStep:'Policy explanation only.'}),
 },
];

test('independently authored reference fixtures satisfy the checker without becoming model evidence',()=>{
 for(const item of references)assert.equal(evaluate(item.question,item.answer).finalDeliveryStatus,'allowed',item.id);
});

test('semantic opposites, contradictions, fake actions, and unsupported data promises are blocked',()=>{
 const damage=references.find(x=>x.id==='damage')!;
 const json=references.find(x=>x.id==='json')!;
 const unknown=references.find(x=>x.id==='unknown')!;
 const mutations=[
  {name:'negated review',question:damage.question,answer:damage.answer.replace('The damaged item requires human review.','The damaged item does not require human review.')},
  {name:'JSON/prose contradiction',question:json.question,answer:JSON.stringify({eligible:true,reason:policy+' You bought the item 10 days ago, so this purchase is within the 30-day standard window. Your return is not eligible under the standard policy.',nextStep:'Policy explanation only.'})},
  {name:'fake action',question:damage.question,answer:damage.answer+' We have forwarded your case to the review team.'},
  {name:'unauthorized data promise',question:unknown.question,answer:unknown.answer+' We do not store or share your personal data.'},
 ];
 for(const item of mutations)assert.equal(evaluate(item.question,item.answer).finalDeliveryStatus,'blocked',item.name);
});

test('a correct statement followed by its semantic opposite remains blocked',()=>{
 const item=references.find(x=>x.id==='damage')!;
 assert.equal(evaluate(item.question,item.answer+' However, this case does not require human review.').finalDeliveryStatus,'blocked');
});

test('quoted examples and conditionals do not count as completed critical assertions',()=>{
 const base=policy+' The purchase date is unknown. Please provide the purchase date. Next step: Contact a human support agent for review.';
 for(const phrase of ['If the item were damaged, it would require human review.','The phrase "the damaged item requires human review" is an example.'])assert.equal(evaluate('My item arrived damaged. What should I do?',base+' '+phrase).finalDeliveryStatus,'blocked');
});
