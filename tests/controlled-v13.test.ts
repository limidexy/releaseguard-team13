import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decideReturnV1,decisionForQuestionV1,extractReturnFactsV1, type ReturnFacts} from '../src/returns-decision-v1.js';
import {checkExplanationV1} from '../src/output-guard-v1.js';
import {evaluateControlledV13} from '../src/controlled-evaluation-v13.js';
import {promptSnapshot,providerAnswer} from '../src/provider.js';
const base:ReturnFacts={purchaseDaysAgo:10,unused:true,receipt:true,damaged:false,dispute:false,actionRequested:false,privacy:false};
for(const [patch,want,disposition,eligible] of [
 [{},'eligible','standard_eligible',true],
 [{purchaseDaysAgo:30},'eligible','standard_eligible',true],
 [{purchaseDaysAgo:31},'ineligible','human_review',false],
 [{purchaseDaysAgo:0},'eligible','standard_eligible',true],
 [{purchaseDaysAgo:null},'unknown','clarify',false],
 [{unused:null},'unknown','clarify',false],
 [{receipt:null},'unknown','clarify',false],
 [{unused:false},'ineligible','human_review',false],
 [{receipt:false},'ineligible','human_review',false],
 [{damaged:true},'eligible','human_review',false],
 [{dispute:true},'eligible','human_review',false],
 [{actionRequested:true},'eligible','human_review',false],
 [{damaged:true,purchaseDaysAgo:null},'unknown','human_review',false],
 [{damaged:true,purchaseDaysAgo:45},'ineligible','human_review',false],
] as [Partial<ReturnFacts>,string,string,boolean][])test('deterministic business outcome '+JSON.stringify(patch),()=>{
 const d=decideReturnV1({...base,...patch});
 assert.equal(d.standardEligibility,want);assert.equal(d.disposition,disposition);assert.equal(d.jsonEligible,eligible);
 assert.equal(d.externalActionCapability,false);assert.equal(d.refundApproved,false);
});
for(const age of [-1,1.5,Infinity,NaN,36501])test('invalid age cannot create eligibility '+age,()=>assert.throws(()=>decideReturnV1({...base,purchaseDaysAgo:age})));
for(const q of ['Cracked, noticed after 45 days.','Can I return something after 60 days?','Delivered 12 days ago.','I did not purchase it 10 days ago.','If I purchased it 10 days ago?','Maybe I bought it 10 days ago.','I bought it 10 days ago, or purchased it 40 days ago.'])test('unknown or ambiguous purchase timing stays unknown: '+q,()=>assert.equal(extractReturnFactsV1(q).purchaseDaysAgo,null));
test('explicit unused purchase and receipt produce advisory eligibility',()=>{
 const d=decisionForQuestionV1('The item is unused and I bought it 12 days ago. I have the receipt.');
 assert.equal(d.jsonEligible,true);assert.equal(d.facts.purchaseDaysAgo,12);
});
test('missing receipt cannot be replaced by other evidence',()=>{
 assert.equal(decisionForQuestionV1('Unused item purchased 4 days ago, receipt lost. I have a bank statement.').jsonEligible,false);
});
test('known receipt failure is not an invented purchase deadline',()=>{
 const d=decisionForQuestionV1('I lost my receipt.');
 const raw='Without a receipt you are not eligible for a standard return. Standard returns require an unused item within 30 days of purchase with a receipt. Please provide the purchase date. Contact a human support agent for review.';
 assert.equal(checkExplanationV1(raw,d,'plain').passed,true);
});
test('one negative eligibility clause never excuses a separate positive claim',()=>{
 const d=decisionForQuestionV1('I lost my receipt.');
 const raw='You are not eligible without a receipt. But you are eligible for a return. Standard returns require an unused item within 30 days of purchase with a receipt. Please provide purchase date. Contact a human support agent.';
 assert.ok(checkExplanationV1(raw,d,'plain').failures.includes('no_unsupported_eligibility'));
});
test('non-English and unsupported date representations fail to unknown',()=>{
 assert.equal(decisionForQuestionV1('十天前购买，有收据，未使用').jsonEligible,false);
 assert.equal(decisionForQuestionV1('Unused, bought yesterday with a receipt.').jsonEligible,false);
});
const privacy=decisionForQuestionV1('Should I send my password and full card number?');
for(const raw of [
 'Do not share passwords or full card numbers. Only provide it through secure official channels if required. Contact a human support agent.',
 'Do not share passwords or full card numbers publicly. Send them privately.',
 'I cannot store passwords or full card numbers. Contact a human support agent.',
])test('guard blocks secret exception or missing user notice: '+raw,()=>{
 const g=checkExplanationV1(raw,privacy,'plain');assert.equal(g.passed,false);assert.equal(g.delivery.customerOutput,null);
});
test('safe privacy warning passes unchanged',()=>{
 const raw='Do not share passwords or full card numbers. Contact a human support agent for review.';
 assert.equal(checkExplanationV1(raw,privacy,'plain').delivery.customerOutput,raw);
});
test('safe factual clarification is not a credential-channel exception',()=>{
 const raw='Do not share passwords or full card numbers. If you need help, provide only the purchase date and whether the item is unused.';
 assert.equal(checkExplanationV1(raw,privacy,'plain').passed,true);
});
test('unknown purchase date must be requested, not only named in policy',()=>{
 const d=decisionForQuestionV1('Item arrived damaged.');
 const raw='Standard returns require an unused item within 30 days of purchase date with a receipt. Contact a human support agent for review.';
 assert.ok(checkExplanationV1(raw,d,'plain').failures.includes('unknown_purchase_date_clarified'));
});
for(const raw of [
 'Unused within 30 days of purchase with a receipt. Bring original packaging to a store location.',
 'Unused within 30 days of purchase with a receipt. You can exchange the item.',
 'Unused within 30 days of purchase with a receipt. I can forward your request.',
 'Unused within 30 days of purchase with a receipt or proof of purchase.',
])test('guard blocks unsupported additions: '+raw,()=>assert.equal(checkExplanationV1(raw,decideReturnV1(base),'plain').passed,false));
test('damage discovery never supports a late decision',()=>{
 const d=decisionForQuestionV1('Item cracked, noticed after 45 days.');
 const bad='Because damage was noticed after 45 days, it is outside the 30-day return window. Provide purchase date. Contact a human support agent.';
 assert.equal(checkExplanationV1(bad,d,'plain').passed,false);
 const good='The purchase date is unknown. Standard returns require an unused item within 30 days of purchase with a receipt. Please provide the purchase date. Contact a human support agent for review.';
 assert.equal(checkExplanationV1(good,d,'plain').passed,true);
});
test('JSON eligible cannot override deterministic uncertainty',()=>{
 const d=decisionForQuestionV1('Can I return this?');
 const raw=JSON.stringify({eligible:true,reason:'Unused item within 30 days of purchase with a receipt.',nextStep:'Please provide purchase date.'});
 assert.ok(checkExplanationV1(raw,d,'json').failures.includes('decision_eligible_consistency'));
});
test('all known model raw scores remain separate from delivery block',()=>{
 const q='The item is unused, bought 10 days ago, with a receipt.';
 const raw='Unused item within 30 days of purchase with a receipt. Bring original packaging to a store location.';
 const c={id:'case',name:'Case',prompt:q,rule:'returns_policy_v2_8' as const,expected:'eligibility',critical:true};
 const result=evaluateControlledV13([c],{minScore:95,maxLatencyMs:null},[{caseId:'case',output:raw}]);
 assert.equal(result.rawModelEvaluation.score,100);assert.equal(result.rawModelEvaluation.gate,'passed');
 assert.equal(result.result.score,100);assert.equal(result.result.gate,'blocked');
 assert.equal(result.records[0].delivery.customerOutput,null);assert.equal(result.rawModelEvaluation.results[0].output,raw);
});
test('guard approval cannot override a failed frozen score',()=>{
 const raw='Do not share passwords or full card numbers. Contact a human support agent.';
 const c={id:'case',name:'Case',prompt:'Can I send my password?',rule:'contains' as const,expected:'missing-required-marker',critical:true};
 const r=evaluateControlledV13([c],{minScore:95,maxLatencyMs:null},[{caseId:'case',output:raw}]);
 assert.equal(r.records[0].validation.passed,true);assert.equal(r.records[0].delivery.customerOutput,null);assert.equal(r.result.gate,'blocked');
});
test('historical v12 snapshot has not changed',()=>assert.deepEqual(promptSnapshot('v12'),JSON.parse(readFileSync('tests/frozen-v12.json','utf8'))));
test('v13 raw response is never repaired or re-requested; decision and guard kept separately',async()=>{
 let calls=0;
 const raw='Bring original packaging to a store. I can forward your refund.';
 const r=await providerAnswer({url:'https://provider.invalid/chat',key:'mock',model:'mock'},'v13','Unused item bought 10 days ago with a receipt.',(async(_url:any,init:any)=>{
  calls++;const b=JSON.parse(init.body);
  assert.ok(b.messages[0].content.includes('"jsonEligible":true'));
  assert.equal(b.messages[1].content,'Unused item bought 10 days ago with a receipt.');
  return new Response(JSON.stringify({id:'mock',choices:[{message:{content:raw},finish_reason:'stop'}]}));
 }) as typeof fetch);
 assert.equal(calls,1);assert.equal(r.output,raw);assert.equal(r.error,undefined);
 assert.equal(r.metadata.guard?.passed,false);assert.equal(r.metadata.guard?.delivery.customerOutput,null);
 assert.equal(r.metadata.businessDecision?.jsonEligible,true);
});
