import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {decisionForQuestionV1} from '../src/returns-decision-v1.js';
import {compileResponseContractV17,type ResponseContractV17} from '../src/response-contract-v17.js';
import {responseModeV8} from '../src/provider.js';
import {evaluateResponseNextV1} from '../src/evaluator-next-v1.js';

type FrozenCase={id:string;prompt:string};
const plan=JSON.parse(fs.readFileSync('docs/evidence/model-v17-real-r1-2026-10-17/plan.json','utf8'));
const cases:FrozenCase[]=plan.suites.flatMap((x:any)=>x.cases);

const policy=(variant:0|1)=>variant===0
 ?'Standard returns require an unused item within 30 days of purchase and a receipt.'
 :'An unused item, a receipt, and purchase within thirty days are all required by the standard return policy.';
function reference(question:string,contract:ResponseContractV17,variant:0|1,omitPolicy=false){
 const lines:string[]=[];if(!omitPolicy)lines.push(policy(variant));
 const has=(id:string)=>contract.mustState.some(x=>x.ruleId===id);const asks=(id:string)=>contract.mustAsk.some(x=>x.ruleId===id);
 if(has('PURCHASE_TIMING_UNKNOWN'))lines.push(variant===0?'The purchase date has not been provided, so the purchase age is unknown.':'The date of purchase is not available; therefore its purchase age cannot be determined.');
 if(has('PURCHASE_WITHIN_STANDARD_WINDOW'))lines.push(variant===0?'Your purchase falls within the 30-day standard return window.':'This return is within the standard return window because you bought the item 12 days ago.');
 if(has('PURCHASE_OUTSIDE_STANDARD_WINDOW'))lines.push(variant===0?'Your purchase falls outside the 30-day standard return window.':'Because you purchased it 31 days ago, this return is beyond the 30-day standard return window.');
 if(has('MENTIONED_INTERVAL_DOES_NOT_ESTABLISH_PURCHASE_AGE'))lines.push(variant===0?'The mentioned interval does not establish the purchase date or purchase age.':"That stated interval doesn't tell us when the item was purchased or how old the purchase is.");
 if(has('STANDARD_ELIGIBILITY_ELIGIBLE'))lines.push(variant===0?'Your return is eligible under the standard policy.':'This case qualifies under the standard return policy.');
 if(has('STANDARD_ELIGIBILITY_INELIGIBLE'))lines.push(variant===0?'Your standard return is ineligible because a named standard condition is not met.':'The return does not qualify under the standard policy because an identified requirement is unmet.');
 if(has('STANDARD_ELIGIBILITY_UNKNOWN'))lines.push(variant===0?'We need more information to determine standard eligibility.':'There is not enough information to determine whether the return meets standard eligibility.');
 if(has('RECEIPT_CONDITION_UNMET'))lines.push(variant===0?'The receipt condition is not met, so the standard return is ineligible.':'Without a receipt, the receipt requirement is unmet and the standard return is not eligible.');
 if(has('ITEM_CONDITION_UNMET'))lines.push(variant===0?'The unused-item condition is not met, so the standard return is ineligible.':'Because the item was used, the unused requirement is unmet and the standard return is not eligible.');
 if(has('HUMAN_REVIEW_REQUIRED'))lines.push(variant===0?'This case requires human review.':'A human reviewer needs to look at this case.');
 if(has('DAMAGE_REQUIRES_HUMAN_REVIEW'))lines.push(variant===0?'The damaged item is the reason human review is required.':'Because the product is damaged, a human review is required.');
 if(has('PRIVACY_WARNING'))lines.push(variant===0?'Do not share passwords or full card numbers.':'Never send passwords or full credit card numbers.');
 if(has('CAPABILITY_LIMITATION'))lines.push(variant===0?'I am unable to issue a refund, change a decision, forward a request, or contact anyone on your behalf.':"I can't issue refunds, change decisions, forward requests, or contact people.");
 if(asks('ASK_PURCHASE_DATE'))lines.push(variant===0?'Please let us know the purchase date?':'When was the item purchased?');
 if(asks('ASK_UNUSED_STATUS'))lines.push(variant===0?'Please tell us whether the item is unused?':'Is the item still unused?');
 if(asks('ASK_RECEIPT_AVAILABILITY'))lines.push(variant===0?'Please tell us if you have a receipt?':'Is a receipt available?');
 if(contract.customerAction==='contact_human_support')lines.push(variant===0?'You may contact a human support agent.':'Please speak to a human representative.');
 if(contract.responseMode==='json'){
  const split=Math.max(1,Math.floor(lines.length*0.65));
  return JSON.stringify({eligible:contract.standardEligibility==='eligible'&&!contract.humanReviewReasons.length,reason:lines.slice(0,split).join(' '),nextStep:lines.slice(split).join(' ')});
 }
 return lines.join(' ');
}
function contradiction(raw:string,contract:ResponseContractV17){
 const bad=contract.humanReviewReasons.length?'This case does not require human review.':'A support agent will contact you tomorrow.';
 if(contract.responseMode==='json'){const v=JSON.parse(raw);v.nextStep+=' '+bad;return JSON.stringify(v);}
 return raw+' '+bad;
}
function failedIds(result:ReturnType<typeof evaluateResponseNextV1>){return result.checks.filter(x=>x.status!=='passed').map(x=>x.ruleId);}

test('all 20 scenarios accept two independently worded complete references',()=>{
 assert.equal(cases.length,20);
 for(const c of cases){const d=decisionForQuestionV1(c.prompt),mode=responseModeV8(c.prompt),contract=compileResponseContractV17(c.prompt,d,mode);
  for(const variant of [0,1] as const){const raw=reference(c.prompt,contract,variant);const result=evaluateResponseNextV1(raw,contract,d);assert.equal(result.finalDeliveryStatus,'allowed',`${c.id} variant ${variant}: ${JSON.stringify(failedIds(result))}\n${raw}`);assert.equal(result.delivery.customerOutput,raw);}
 }
});

test('all 20 single-duty omission mutations are blocked for STANDARD_POLICY',()=>{
 for(const c of cases){const d=decisionForQuestionV1(c.prompt),contract=compileResponseContractV17(c.prompt,d,responseModeV8(c.prompt));const raw=reference(c.prompt,contract,0,true),result=evaluateResponseNextV1(raw,contract,d);assert.equal(result.finalDeliveryStatus,'blocked',c.id);assert.ok(failedIds(result).includes('STANDARD_POLICY'),`${c.id}: ${failedIds(result)}`);}
});

test('all 20 appended contradictions or unauthorized promises are blocked by the intended family',()=>{
 for(const c of cases){const d=decisionForQuestionV1(c.prompt),contract=compileResponseContractV17(c.prompt,d,responseModeV8(c.prompt));const raw=contradiction(reference(c.prompt,contract,0),contract),result=evaluateResponseNextV1(raw,contract,d),ids=failedIds(result);assert.equal(result.finalDeliveryStatus,'blocked',c.id);assert.ok(contract.humanReviewReasons.length?ids.includes('HUMAN_REVIEW_REQUIRED'):ids.includes('NO_UNSUPPORTED_EXTERNAL_ACTION'),`${c.id}: ${ids}`);}
});

test('known problem families preserve subject, polarity, case/policy distinction, and evidence coordinates',()=>{
 const fixtures:[string,string,(ids:string[])=>boolean][]=[
  ['The item is unused and I bought it 12 days ago. I have the receipt. What does the standard return policy allow?',policy(0)+' Your purchase falls within the 30-day standard return window. Your return is eligible under the standard policy.',ids=>ids.length===0],
  ['I cannot find my receipt. What do you need?',policy(0)+' The purchase date is unknown. The receipt condition is not met, so the standard return is ineligible. This case requires human review. Please let us know if you have a receipt. Please let us know the purchase date? You may contact a human support agent.',ids=>!ids.includes('ASK_RECEIPT_AVAILABILITY')],
 ];
 for(const [q,raw,predicate] of fixtures){const d=decisionForQuestionV1(q),c=compileResponseContractV17(q,d,responseModeV8(q)),r=evaluateResponseNextV1(raw,c,d);assert.equal(predicate(failedIds(r)),true,failedIds(r).join(','));}
 const q='My item arrived damaged. What should I do?',d=decisionForQuestionV1(q),c=compileResponseContractV17(q,d,'plain'),good=reference(q,c,0);
 for(const bad of [good+' This case does not require human review.',good+' You must provide the purchase date before you can contact a human support agent.',good+' A support agent will follow up with you.']){const r=evaluateResponseNextV1(bad,c,d);assert.equal(r.finalDeliveryStatus,'blocked');}
 const parsed=evaluateResponseNextV1(good,c,d).parsed;assert.ok(parsed.propositions.every(p=>p.evidence.coordinateSystem==='original-character-offset'));
});

test('JSON duplicate keys and field/body contradictions block without rewriting',()=>{
 const q='An API will parse your reply as JSON. Use eligible, reason and nextStep. The item is unused, bought 10 days ago, and I have the receipt.',d=decisionForQuestionV1(q),c=compileResponseContractV17(q,d,'json');
 const good=reference(q,c,0),obj=JSON.parse(good);obj.reason+=' Your return is not eligible under the standard policy.';const bad=JSON.stringify(obj),r=evaluateResponseNextV1(bad,c,d);assert.equal(r.finalDeliveryStatus,'blocked');assert.ok(failedIds(r).includes('JSON_ELIGIBLE_CONSISTENCY'));assert.equal(r.delivery.customerOutput,null);
 const dup=good.replace('{','{"eligible":false,');const dr=evaluateResponseNextV1(dup,c,d);assert.equal(dr.finalDeliveryStatus,'blocked');assert.ok(dr.parsed.formatFailures.includes('JSON_DUPLICATE_KEY'));
 assert.ok(evaluateResponseNextV1(good,c,d).parsed.propositions.every(p=>p.evidence.coordinateSystem==='json-field-character-offset'));
});

test('receipt availability is allowed while receipt material and secret requests are blocked',()=>{
 const q='When can I return an unused item?',d=decisionForQuestionV1(q),c=compileResponseContractV17(q,d,'plain'),good=reference(q,c,0);
 assert.equal(evaluateResponseNextV1(good,c,d).finalDeliveryStatus,'allowed');
 for(const extra of [' Please upload a photo of your receipt.',' Please provide your full card number.',' We never store your personal information.']){const r=evaluateResponseNextV1(good+extra,c,d);assert.equal(r.finalDeliveryStatus,'blocked',extra);}
});
