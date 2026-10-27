import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runComparison,validateComparison } from '../scripts/comparison-core.mjs';
import { selectComparisonSuite,legacyRevision,comparisonReport,validateBaseline } from '../scripts/comparison-report.mjs';
import { boundary,config,fixture,runtime,outputs,credential } from './fixtures/comparison-data.mjs';
globalThis.fetch=()=>{throw Error('Native fetch forbidden');};
for(const revision of ['legacy','v2.1','v2.2'])test('complete two-prompt '+revision+' workflow retains original jobs and separate rule derivations',async()=>{
 const b=boundary(config({suiteRevision:revision})),r=await runComparison(b.c,b.io,runtime);
 assert.equal(r.status,'completed');assert.equal(r.requests,6);assert.equal(r.modelRequestsReserved,0);assert.equal(b.api.jobs.length,2);
 assert.deepEqual(b.api.requests.filter(q=>q.route==='/jobs').map(q=>q.body.promptVersion),['v1','v2']);
 assert.deepEqual(r.report.runs,b.api.jobs);assert.equal(r.report.schemaVersion,'2.2');assert.equal(r.report.evaluatorVersion,revision==='legacy'?'legacy-literal-v1':'returns-policy-'+revision);
 assert.equal(r.report.policy.minScore,95);assert.equal(r.report.cases.length,10);assert.match(r.report.scope,/NO evidence of prompt improvement/);
 for(const row of r.report.caseComparison){assert.deepEqual(row.humanReview,{reviewer:null,policyAccuracy:null,safety:null,helpfulness:null,reason:null});
  assert.deepEqual(row.versions.map(v=>v.caseResult.output),[outputs().find(o=>o.caseId===row.caseId).output,outputs().find(o=>o.caseId===row.caseId).output]);}
 if(revision!=='legacy'){assert.equal(r.report.legacyRulesOnNewAnswers.length,2);assert.deepEqual(r.report.legacyRulesOnNewAnswers[0].originalResult,b.api.jobs[0].result);}
 assert.equal(b.events.some(e=>e.intent?.route?.includes('release')),false);assert.equal(b.retained['terminal.json'].providerCallsIndependentlyMeasured,false);
});
test('source v2 selector means policy v2.1, independently of schema2.2',()=>{
 assert.equal(legacyRevision('v2'),'v2.1');assert.equal(runtime.policy.returnsEvaluatorVersion,'returns-policy-v2.1');
 assert.equal(selectComparisonSuite(fixture,'v2.1',runtime).suite.cases[0].rule,'returns_policy_v2_1');
 assert.equal(selectComparisonSuite(fixture,'v2.2',runtime).suite.cases[0].rule,'returns_policy_v2_2');
});
for(const [label,patch]of [
 ['zero budget real',{source:'real'}],['larger real budget',{source:'real',modelRequestBudget:21}],['incomplete commit',{commit:'abcdefg'}],['mutable image',{image:'latest'}],
 ['classroom',{origin:'http://127.0.0.1:5193',allowedOrigins:['http://127.0.0.1:5193'],targetKind:'local'}],
 ['implicit local default',{origin:'http://127.0.0.1:5189',allowedOrigins:['http://127.0.0.1:5189'],targetKind:'local'}],
 ['non-loopback local',{origin:'http://localhost:34567',allowedOrigins:['http://localhost:34567'],targetKind:'local'}],
 ['workspace drift',{workspace:'team13'}],['unknown rule revision',{suiteRevision:'v2'}],['extra option',{retry:true}],['cloud dev credential',{authMode:'development'}],
 ['unapproved origin',{allowedOrigins:['https://other.example.test']}],['invalid deadline',{deadlineMs:NaN}],
])test('explicit guard refuses '+label+' before reservation/auth/network',async()=>{
 const b=boundary(config(patch));await assert.rejects(runComparison(b.c,b.io,runtime));assert.equal(b.events.length,0);assert.equal(b.api.requests.length,0);
});
for(const fault of ['http503','unknown-post','wrong-workspace','wrong-prompt','wrong-snapshot','wrong-score','duplicate-case','failed-job','wrong-source'])test(fault+' stops without resending or sending v2',async()=>{
 const b=boundary(config(),{fault}),r=await runComparison(b.c,b.io,runtime);assert.equal(r.status,'failed_or_unknown');
 assert.ok(b.api.requests.filter(q=>q.route==='/jobs').length<=1);assert.equal(r.states[1].state,'not_executed');
 assert.equal(b.retained['terminal.json'].automaticRetry,false);assert.equal(JSON.stringify(r).includes(credential),false);
 if(fault==='wrong-score'){assert.equal(r.report.runs[0].result.score,99);assert.equal(r.report.error.code,'failed_or_unknown');assert.equal(r.report.caseComparison.every(c=>c.versions.every(v=>v.caseResult===null)),true);}
});
test('real-mode capability reserves exactly10 per job before send, no model in test; blocked semantics do not become protocol failure',async()=>{
 const b=boundary(config({source:'real',modelRequestBudget:20,suiteRevision:'v2.2'}),{outputsFor:()=>outputs().map((v,i)=>i===0?{...v,output:'Returns are accepted forever.'}:v)});
 const r=await runComparison(b.c,b.io,runtime);assert.equal(r.status,'completed');assert.equal(r.modelRequestsReserved,20);assert.equal(r.report.runs.every(j=>j.result.gate==='blocked'),true);
 assert.deepEqual(r.states.map(s=>s.modelRequestsReserved),[10,10]);assert.equal(r.report.semanticConclusion.startsWith('NOT_ASSESSED'),true);
});
test('real recovery attempts above1 stop; source guard is not a guarantee about independently measured provider consumption',async()=>{
 const b=boundary(config({source:'real',modelRequestBudget:20}),{fault:'real-recovery'}),r=await runComparison(b.c,b.io,runtime);
 assert.equal(r.status,'failed_or_unknown');assert.equal(r.modelRequestsReserved,10);assert.equal(b.api.jobs.length,1);
});
test('provider errors preserve original text and stop before second prompt',async()=>{
 const b=boundary(config({source:'real',modelRequestBudget:20}),{outputsFor:()=>outputs().map((r,i)=>i===0?{...r,error:'Provider HTTP 400'}:r)}),r=await runComparison(b.c,b.io,runtime);
 assert.equal(r.status,'failed_or_unknown');assert.equal(r.report.runs[0].result.results[0].reason,'Provider HTTP 400');assert.equal(r.report.runs[0].result.results[0].output,outputs()[0].output);
 assert.equal(r.report.runs[0].result.total,10);assert.equal(r.report.runs.length,1);
});
test('deadline in queued observation stops with unknown job and never repeats the POST',async()=>{
 const b=boundary(config({deadlineMs:1000}),{fault:'queued'}),r=await runComparison(b.c,b.io,runtime);
 assert.equal(r.status,'failed_or_unknown');assert.equal(r.report.runs[0].status,'queued');assert.equal(b.api.requests.filter(r=>r.route==='/jobs').length,1);assert.equal(r.states[1].state,'not_executed');
});
for(const fail of ['intent','observed','result','retain','terminal'])test('failed '+fail+' persistence cannot produce successful workflow',async()=>{
 const b=boundary();b.io[fail]=async()=>{throw Error('INSECURE_SYNTHETIC_PRIVATE_ERROR');};const r=await runComparison(b.c,b.io,runtime);
 assert.notEqual(r.status,'completed');assert.equal(b.api.jobs.length<=(fail==='terminal'?2:1),true);assert.doesNotMatch(JSON.stringify(r),/INSECURE_SYNTHETIC_PRIVATE_ERROR/);
});
test('authentication failure and cancellation cause zero target requests, no fallback or retry',async()=>{
 for(const cancel of [false,true]){const b=boundary();b.io.authenticate=async()=>{if(cancel)b.controller.abort();throw Error('INSECURE_PRIVATE_AUTH');};
  const r=await runComparison(b.c,b.io,runtime);assert.equal(r.status,'failed_or_unknown');assert.equal(b.api.requests.length,0);assert.doesNotMatch(JSON.stringify(r),/INSECURE_PRIVATE_AUTH/);}
});
test('a regressing clock and cancellation after persistence never start a late operation',async()=>{
 for(const cancelled of [false,true]){const b=boundary(),intent=b.io.intent;b.io.intent=async(n,v)=>{await intent(n,v);if(cancelled)b.controller.abort();else b.advance(-1);};
  const r=await runComparison(b.c,b.io,runtime);assert.equal(r.status,'failed_or_unknown');assert.equal(b.api.requests.length,0);}
});
test('retained legacy baseline stays byte-identical; old results and new same-answer derivations are distinct',async()=>{
 const old=boundary(),original=await runComparison(old.c,old.io,runtime),bytes=Buffer.from(JSON.stringify(original.report)),baseline=JSON.parse(bytes),hash=createHash('sha256').update(bytes).digest('hex');
 const b=boundary(config({suiteRevision:'v2.2'}));b.io.baseline=async()=>({value:baseline,sha256:hash});const r=await runComparison(b.c,b.io,runtime);
 assert.equal(r.status,'completed');assert.deepEqual(Buffer.from(JSON.stringify(baseline)),bytes);assert.deepEqual(r.report.baseline.original,original.report);
 assert.equal(r.report.baseline.sha256,hash);assert.equal(r.report.baseline.directScoreComparisonPermitted,false);assert.equal(r.report.baseline.runs[0].derivedNotOriginal,true);
 assert.deepEqual(r.report.baseline.runs[0].originalResult,baseline.runs[0].result);
});
test('incomplete baseline is not a completed run or a reduced denominator',async()=>{
 const b=boundary(),r=await runComparison(b.c,b.io,runtime),old=structuredClone(r.report);old.runs[1].status='failed';old.runs[1].result=null;
 const n=boundary(config({suiteRevision:'v2.1'}));n.io.baseline=async()=>({value:old,sha256:'c'.repeat(64)});const out=await runComparison(n.c,n.io,runtime);
 assert.equal(out.status,'completed');assert.equal(out.report.baseline.runs[1].originalResult,null);assert.equal(out.report.baseline.runs[1].rescoredResult.total,10);assert.equal(out.report.baseline.runs[1].rescoredResult.errors,10);
});
test('baseline question/order/critical/policy mismatch stops before auth/target mutations',async()=>{
 const b=boundary(),r=await runComparison(b.c,b.io,runtime);
 for(const patch of [old=>old.policy.minScore=90,old=>old.cases.reverse(),old=>old.cases[0].prompt='Changed',old=>old.cases[0].critical=false]){
  const old=structuredClone(r.report);patch(old);const next=boundary(config({suiteRevision:'v2.1'}));next.io.baseline=async()=>({value:old,sha256:'d'.repeat(64)});
  assert.equal((await runComparison(next.c,next.io,runtime)).status,'failed_or_unknown');assert.equal(next.api.requests.length,0);
 }
});
test('frozen source reproduces import execution, unaffirmed association and raw-error leak only under fake boundaries',async()=>{
 const source=readFileSync(new URL('./fixtures/compare-prompts-source-pr1.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
 const run=async(fault)=>{let saved,requests=0;const fakeProcess={argv:['node','original.mjs','replay'],env:{RG_SUITE_REVISION:'v2'}};
  const complete=async id=>({id,input:{promptVersion:'v2',source:'replay'},status:'succeeded',result:runtime.domain.evaluate(fixture.suite.cases,fixture.suite.policy,outputs())});
  const fn=new (Object.getPrototypeOf(async()=>{}).constructor)('mkdir','writeFile','readFile','createHash','revisedReturnsSuite','returnsEvaluatorVersion','evaluate','cloudToken','token','application','legacySuite','required','completed','key','base','process','console',source);
  await fn(async()=>{},async(p,v)=>{saved=JSON.parse(v);},async()=>Buffer.from('{}'),createHash,runtime.policy.revisedReturnsSuite,runtime.policy.returnsEvaluatorVersion,runtime.domain.evaluate,async()=>credential,async()=>credential,fixture.application,fixture.suite,
   async()=>{requests++;if(fault&&requests===3)throw Error('Bearer '+credential);return {id:'10000000-0000-4000-8000-000000000001'};},complete,()=> 'synthetic-key','http://127.0.0.1:34567',fakeProcess,{log(){}});
  return {saved,requests};};
 const old=await run(false);assert.equal(old.saved.schemaVersion,'2.2');assert.equal(old.saved.evaluatorVersion,'returns-policy-v2.1');assert.equal(old.requests,4);
 assert.equal(old.saved.runs[0].input.promptVersion,'v2','original accepted a mismatched first-prompt association');
 const fail=await run(true);assert.match(fail.saved.error,new RegExp(credential));
});
