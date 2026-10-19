import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateControlledV14} from '../src/controlled-evaluation-v14.js';
import {providerAnswer} from '../src/provider.js';
test('v14 blocks phantom passive transfer even when frozen raw score is 100',()=>{
 const raw='The case is being sent for human review. Contact a human support agent for review.';
 const c={id:'case',name:'Dispute',prompt:'I disagree with the decision.',rule:'returns_policy_v2_8' as const,expected:'escalation',critical:true};
 const r=evaluateControlledV14([c],{minScore:95,maxLatencyMs:null},[{caseId:'case',output:raw}]);
 assert.equal(r.rawModelEvaluation.score,100);assert.equal(r.result.gate,'blocked');
 assert.equal(r.rawModelEvaluation.results[0].output,raw);assert.equal(r.records[0].delivery.customerOutput,null);
});
test('v14 never repairs a missing policy statement or makes a second request',async()=>{
 let calls=0;const raw='You qualify because the item is unused and was purchased 12 days ago with a receipt.';
 const r=await providerAnswer({url:'https://mock.invalid/chat',key:'mock',model:'mock'},'v14','The item is unused, bought 12 days ago, with a receipt.',(async()=>{
  calls++;return new Response(JSON.stringify({id:'mock',choices:[{message:{content:raw},finish_reason:'stop'}]}));
 }) as typeof fetch);
 assert.equal(calls,1);assert.equal(r.output,raw);assert.equal(r.metadata.guard?.passed,false);
 assert.ok(r.metadata.guard?.failures.includes('all_standard_conditions'));assert.equal(r.metadata.guard?.version,'explanation-guard-v2');
});
