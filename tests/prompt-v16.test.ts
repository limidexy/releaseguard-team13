import test from 'node:test';
import assert from 'node:assert/strict';
import {jobSchema} from '../src/domain.js';
import {providerAnswer,promptSnapshot} from '../src/provider.js';
import {evaluateControlledV14} from '../src/controlled-evaluation-v14.js';

const job={appId:'00000000-0000-4000-8000-000000000001',suiteId:'00000000-0000-4000-8000-000000000002',candidate:'prompt-v16',commitRef:'local-only-v16',source:'real',promptVersion:'v16'};

test('v16 is selectable while an unknown future version remains rejected',()=>{
 assert.equal(jobSchema.safeParse(job).success,true);
 assert.equal(jobSchema.safeParse({...job,promptVersion:'v18'}).success,false);
});

test('v16 sends the explicit bare-duration boundary and preserves one raw answer',async()=>{
 let calls=0,system='';
 const raw='Standard returns require an unused item within 30 days of purchase with a receipt. Please provide the purchase date.';
 const result=await providerAnswer({url:'https://mock.invalid/chat',key:'mock',model:'mock'},'v16','Can I return something after 60 days?',(async(_url:any,init:any)=>{
  calls++;const body=JSON.parse(init.body);system=body.messages[0].content;
  return new Response(JSON.stringify({id:'mock-v16',model:'mock',choices:[{message:{content:raw},finish_reason:'stop'}]}));
 }) as typeof fetch);
 assert.equal(calls,1);assert.equal(result.output,raw);assert.equal(result.metadata.guard?.passed,true);
 assert.match(system,/bare duration.*does not establish.*purchase timing/i);
 assert.match(system,/standardEligibility is "unknown".*must not say.*outside.*expired.*ineligible/i);
 assert.ok(system.startsWith(promptSnapshot('v16').text));
});

test('old unknown-deadline answer remains blocked by unchanged independent guard',()=>{
 const raw='Standard returns require an unused item within 30 days of purchase with a receipt. Your request is outside the standard return window. Please provide the purchase date, confirm whether the item is unused, and confirm whether you have a receipt.';
 const c={id:'expired',name:'Expired ambiguity',prompt:'Can I return something after 60 days?',rule:'returns_policy_v2_10' as const,expected:'expired',critical:true};
 const result=evaluateControlledV14([c],{minScore:95,maxLatencyMs:null},[{caseId:'expired',output:raw}]);
 assert.equal(result.result.gate,'blocked');
 assert.ok(result.records[0].validation.failures.includes('no_unknown_deadline_decision'));
 assert.equal(result.records[0].delivery.customerOutput,null);
});
