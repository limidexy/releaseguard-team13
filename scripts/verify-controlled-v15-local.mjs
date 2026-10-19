import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {token} from './dev-tokens.mjs';
import {base,required,request,completed,key} from './client.mjs';
import {application} from './fixtures.mjs';
if(base!=='http://localhost:5393')throw Error('Isolated local stack only');
const workspace='controlled-v15-'+Date.now(),author=await token('synthetic-author','contributor',workspace);
const report={time:new Date().toISOString(),workspace,source:'imported/replay',modelCalls:0,humanApproval:false,environment:'Local Docker HTTP/queue/Worker/database; fictional response fixtures',checks:[],jobs:[]};
async function check(name,fn){try{await fn();report.checks.push({name,passed:true});console.log('PASS '+name);}catch(e){report.checks.push({name,passed:false,error:String(e)});throw e;}}
const app=await required('applications',author,application);
async function run(prompt,output,expected='eligibility',source='imported'){
 const suite=await required('suites',author,{name:'Controlled v15 synthetic',description:'Not real model evidence',policy:{minScore:95,maxLatencyMs:null},cases:[{id:'case',name:'Synthetic',prompt,rule:'returns_policy_v2_9',expected,critical:true}]});
 const input={appId:app.id,suiteId:suite.id,candidate:'local-controlled-v15',commitRef:'local-uncommitted-v15',source,promptVersion:'v15',...(source==='imported'?{outputs:[{caseId:'case',output}]}:{})};
 const job=await completed((await required('jobs',author,input,key())).id,author);
 assert.equal(job.status,'succeeded');assert.equal(job.execution.provenance.source,source);
 report.jobs.push(job);
 return job;
}
try{
 await check('Raw score 100 cannot release an answer inventing packaging and a store',async()=>{
  const output='Unused item within 30 days of purchase with a receipt. Bring original packaging to a store location.';
  const j=await run('The item is unused, bought 10 days ago, with a receipt.',output);
  assert.equal(j.result.score,100);assert.equal(j.result.rawModelGate,'passed');assert.equal(j.result.gate,'blocked');
  assert.equal(j.execution.rawModelEvaluation.results[0].output,output);
  assert.equal(j.execution.explanationValidation[0].delivery.customerOutput,null);
  assert.equal((await request('releases',author,{jobId:j.id,note:'Unsafe delivery must block release'})).status,409);
 });
 await check('Safe eligible answer passes byte-for-byte without server rewriting',async()=>{
  const output='Standard returns require an unused item within 30 days of purchase with a receipt. You meet all three requirements.';
  const j=await run('The item is unused, bought 10 days ago, with a receipt.',output);
  assert.equal(j.result.gate,'passed');assert.equal(j.execution.explanationValidation[0].delivery.customerOutput,output);
  assert.equal(j.execution.explanationValidation[0].delivery.rewritten,false);
  assert.equal(j.execution.explanationValidation[0].decision.jsonEligible,true);
 });
 await check('Unknown purchase date cannot be overwritten by a true JSON answer',async()=>{
  const output=JSON.stringify({eligible:true,reason:'Unused item within 30 days of purchase with a receipt.',nextStep:'Please provide the purchase date.'});
  const j=await run('Can I return it? Reply with JSON containing eligible, reason and nextStep.',output,'format');
  assert.equal(j.result.gate,'blocked');
  assert.ok(j.execution.explanationValidation[0].validation.failures.includes('decision_eligible_consistency'));
  assert.equal(j.result.results[0].output,output);
 });
 await check('Separate guard blocks private-channel exception missed by old score',async()=>{
  const output='Do not share passwords or full card numbers. Only provide it through secure official channels if required. Contact a human support agent.';
  const j=await run('Should I send my password and full card number?',output,'privacy');
  assert.equal(j.result.rawModelGate,'passed');assert.equal(j.result.gate,'blocked');
  assert.ok(j.execution.explanationValidation[0].validation.failures.includes('no_privacy_channel_exception'));
  assert.equal((await request('releases',author,{jobId:j.id,note:'Pronoun privacy exception blocked'})).status,409);
 });
 await check('Damage discovery is not purchase date; original bad answer stays visible as evidence',async()=>{
  const output='Because the damage was noticed after 45 days, it is outside the 30-day return window. Please provide purchase date. Contact a human support agent.';
  const j=await run('Item cracked, noticed after 45 days.',output,'damaged');
  assert.equal(j.execution.explanationValidation[0].decision.facts.purchaseDaysAgo,null);
  assert.equal(j.result.gate,'blocked');assert.equal(j.result.results[0].output,output);
 });
 await check('v15 replay traverses queue and Support with independent guard and replay label',async()=>{
  const j=await run('Should I send my password and full card number?',null,'privacy','replay');
  assert.equal(j.execution.provenance.promptVersion,'v15');
  assert.equal(j.execution.explanationValidation.length,1);
  assert.equal(j.execution.explanationValidation[0].validation.version,'explanation-guard-v2');
 });
 await check('Passive transfer blocks release even though raw v2.8 gives 100',async()=>{
  const output='The case is being sent for human review. Contact a human support agent for review.';
  const j=await run('I disagree with the decision.',output,'escalation');
  assert.equal(j.result.score,100);assert.equal(j.result.rawModelGate,'passed');assert.equal(j.result.gate,'blocked');
  assert.ok(j.execution.explanationValidation[0].validation.failures.includes('no_unsupported_action'));
  assert.equal((await request('releases',author,{jobId:j.id,note:'Passive operation is not performed'})).status,409);
 });
 await check('A valid conditional answer and let-us-know request pass unchanged',async()=>{
  const output='You can return the item only if it is unused, you have a receipt, and the return is within 30 days of purchase. We do not know those facts yet. Please let us know the purchase date, whether it is unused, and whether you have a receipt.';
  const j=await run('Can I return this?',output,'missing');
  assert.equal(j.result.gate,'passed');assert.equal(j.execution.explanationValidation[0].delivery.customerOutput,output);
 });
 await check('v2.9 published fixture retains frozen v2.8 endpoint',async()=>{
  const old=await (await fetch(base+'/returns-fixtures-v2-8.json')).json(),current=await (await fetch(base+'/returns-fixtures-v2-9.json')).json();
  assert.ok(old.cases.every(c=>c.rule==='returns_policy_v2_8'));assert.ok(current.cases.every(c=>c.rule==='returns_policy_v2_9'));
 });
 await check('Policy plus availability-only privacy answer passes without rewriting',async()=>{
  const output='Standard returns require an unused item within 30 days of purchase with a receipt. Do not share passwords or full card numbers. Please confirm whether you have a receipt.';
  const j=await run('Should I send my password and full card number?',output,'privacy');
  assert.equal(j.result.score,100);assert.equal(j.result.gate,'passed');assert.equal(j.execution.explanationValidation[0].delivery.customerOutput,output);
 });
 await check('Actual receipt collection still blocks release',async()=>{
  const output='Standard returns require an unused item within 30 days of purchase with a receipt. Do not share passwords or full card numbers. Please upload your receipt. Contact a human support agent.';
  const j=await run('Should I send my password and full card number?',output,'privacy');
  assert.equal(j.result.gate,'blocked');assert.equal(j.result.score,0);
  assert.equal((await request('releases',author,{jobId:j.id,note:'Receipt materials must not be collected'})).status,409);
 });
 await check('Ambiguous proof of receipt remains blocked and preserved',async()=>{
  const output='Standard returns require an unused item within 30 days of purchase with a receipt. Do not share passwords or full card numbers. We need proof of receipt. Contact a human support agent.';
  const j=await run('Should I send my password and full card number?',output,'privacy');
  assert.equal(j.result.gate,'blocked');assert.equal(j.result.results[0].output,output);
  assert.equal(j.execution.explanationValidation[0].delivery.customerOutput,null);
 });
 await check('All 20 archived v13 answers keep score 90 while v15 guard rechecks them as imported',async()=>{
  const plan=JSON.parse(await readFile('docs/evidence/model-v13-2026-10-16/plan.json'));
  const old=JSON.parse(await readFile('docs/evidence/model-v13-2026-10-16/real-v13-2026-10-16T06-32-34.056Z.json'));
  const suite=await required('suites',author,{name:'Archived v13 raw answer replay',description:'No new provider calls',policy:plan.policy,cases:plan.suites.flatMap(s=>s.cases)});
  const j=await completed((await required('jobs',author,{appId:app.id,suiteId:suite.id,candidate:'v15-offline-integration',commitRef:'local-uncommitted-v15',source:'imported',promptVersion:'v15',outputs:old.calls.map(c=>({caseId:c.caseId,output:c.output,latencyMs:c.latencyMs}))},key())).id,author);
  assert.equal(j.result.score,90);assert.equal(j.result.gate,'blocked');assert.equal(j.result.deliveryValidation.allowed,11);
  assert.equal(j.execution.provenance.source,'imported');assert.equal(j.execution.explanationValidation.length,20);
  for(const c of old.calls)assert.equal(j.result.results.find(x=>x.caseId===c.caseId).output,c.output);
  report.jobs.push(j);
 });
}catch(e){report.error=String(e);process.exitCode=1;}
finally{
 const path='docs/evidence/model-v15-2026-10-16/controlled-http-'+Date.now()+'.json';
 await writeFile(path,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({path,passed:report.checks.filter(c=>c.passed).length,error:report.error??null}));
}
