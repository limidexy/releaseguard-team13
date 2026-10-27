import test from 'node:test';
import assert from 'node:assert/strict';
import { runRetainedRescore } from '../scripts/retained-rescore-core.mjs';
import { config,boundary,runtime,retainedSource,legacyProbe } from './fixtures/retained-rescore-data.mjs';
globalThis.fetch=()=>{throw Error('Native fetch forbidden');};
for(const revision of ['v2.1','v2.2'])test('complete '+revision+' imported workflow preserves original answers, scores, order, parent and full results',async()=>{
 const b=boundary(config({suiteRevision:revision})),raw=JSON.stringify(b.source),r=await runRetainedRescore(b.c,b.io,runtime);
 assert.equal(r.status,'completed');assert.equal(r.requests,9);assert.equal(r.report.passed,true);assert.equal(r.report.protocolPassed,true);assert.equal(r.report.modelCallsRequested,0);
 assert.equal(r.report.evaluatorVersion,'returns-policy-'+revision);assert.equal(r.report.originalJobsUnchangedObserved,true);assert.equal(JSON.stringify(b.source),raw);
 assert.deepEqual(r.report.sourceReportOriginal,b.source);assert.equal(r.report.runs.length,2);assert.equal(r.report.allDerivedRuleGatesPassed,true);
 assert.equal(b.api.calls.filter(c=>c.method==='POST').length,3);assert.equal(b.api.calls.some(c=>c.route.includes('applications')||c.route.includes('releases')),false);
 for(const [i,row]of r.report.runs.entries()){
  assert.equal(row.importedJob.input.source,'imported');assert.equal(row.importedJob.snapshot.suite.version,8);assert.equal(row.importedJob.snapshot.suite.data.parentId,b.source.suiteId);
  assert.deepEqual(row.originalResult,b.source.runs[i].result);assert.equal(row.resultValidated,true);assert.equal(row.importedJob.result.total,10);assert.equal(row.importedJob.result.score,100);
  assert.deepEqual(row.importedJob.result.results.map(x=>x.output),b.source.runs[i].result.results.map(x=>x.output));
 }
});
test('original v2.1 gold result is preserved by complete guarded consumer, not only a new planner',async()=>{
 const old=await legacyProbe(),b=boundary(),r=await runRetainedRescore(b.c,b.io,runtime);assert.equal(old.saved.passed,true);assert.equal(r.status,'completed');
 assert.equal(old.saved.evaluatorVersion,r.report.evaluatorVersion);assert.deepEqual(old.saved.runs.map(x=>x.job.result),r.report.runs.map(x=>x.importedJob.result));
});
test('frozen source accepts an incorrect per-case status despite correct aggregate, guarded consumer refuses it',async()=>{
 const old=await legacyProbe({fault:'wrong-case-status'});assert.equal(old.saved.passed,true);
 const b=boundary(config(),retainedSource(),{fault:'wrong-case-status'}),r=await runRetainedRescore(b.c,b.io,runtime);
 assert.equal(r.status,'failed_or_unknown');assert.equal(r.report.runs[0].importedJob.result.score,100);assert.equal(r.report.runs[0].importedJob.result.results[0].status,'failed');
 assert.equal(r.report.runs[0].resultValidated,false);assert.equal(b.api.jobs.length,1);assert.equal(r.report.passed,false);
});
for(const [label,change]of [
 ['unapproved target',{allowedOrigins:['https://other.example.test']}],['HTTP',{origin:'http://retained.example.test',allowedOrigins:['http://retained.example.test']}],
 ['classroom',{origin:'https://localhost:5193',allowedOrigins:['https://localhost:5193']}],['no own opt-in',{allowImportedRescore:false}],['wrong version',{suiteRevision:'v2'}],
 ['mutable image',{image:'latest'}],['short source',{commit:'course-v2'}],['workspace empty',{workspace:''}],['extra source mode',{source:'real'}],['invalid deadline',{deadlineMs:NaN}],
])test('guard refuses '+label+' before reservation or auth',async()=>{
 const b=boundary(config(change));await assert.rejects(runRetainedRescore(b.c,b.io,runtime));assert.equal(b.events.length,0);assert.equal(b.api.calls.length,0);
});
for(const [label,patch]of [
 ['nonreal retained claim',s=>s.source='replay'],['relaxed threshold',s=>s.policy.minScore=90],['missing case',s=>s.cases.pop()],['duplicate case',s=>s.cases[9]=s.cases[0]],
 ['unknown criterion',s=>s.cases[0].id='other'],['same original job',s=>s.runs[1].id=s.runs[0].id],['duplicate prompt',s=>s.runs[1].input.promptVersion='v1'],
 ['foreign workspace',s=>s.runs[0].workspace='foreign'],['wrong app',s=>s.runs[0].input.appId=s.suiteId],['changed snapshot',s=>s.runs[0].snapshot.suite.data.cases[0].prompt='Changed'],
 ['ambiguous parent version',s=>s.runs[1].snapshot.suite.version=8],['duplicate answer',s=>s.runs[0].result.results[9]=s.runs[0].result.results[0]],
 ['altered critical flag',s=>s.runs[0].result.results[0].critical=false],['bad raw latency',s=>s.runs[0].result.results[0].latencyMs=-1],
 ['error without original reason',s=>{s.runs[0].result.results[0].status='error';s.runs[0].result.results[0].reason='';}],['reduced old denominator',s=>s.runs[0].result.total=9],
 ['conflicting original origin',s=>s.declaredOrigin='https://other.example.test'],
 ['reused source report run ID',s=>s.runId=config().runId],
])test('retained input refuses '+label+' before issuer or target operations',async()=>{
 const source=retainedSource();patch(source);const b=boundary(config(),source);let authentications=0;b.io.authenticate=async()=>{authentications++;throw Error('must not authenticate');};
 const r=await runRetainedRescore(b.c,b.io,runtime);assert.equal(r.status,'failed_or_unknown');assert.equal(authentications,0);assert.equal(b.api.calls.length,0);
});
for(const fault of ['source-before','wrong-parent-version','http429','unknown-post','wrong-reason','wrong-workspace','wrong-snapshot','wrong-output','wrong-source','failed-job'])test(fault+' preserves unknown/failure and never retries or submits the second job',async()=>{
 const b=boundary(config(),retainedSource(),{fault}),r=await runRetainedRescore(b.c,b.io,runtime);assert.equal(r.status,'failed_or_unknown');assert.equal(b.api.calls.filter(c=>c.route==='/jobs').length<=1,true);
 assert.equal(b.retained['terminal.json'].automaticRetry,false);assert.equal(r.report?.runs[1].state,'not_executed');
});
test('after-read source drift does not undo old data, promote results or rerun two already accepted imported jobs',async()=>{
 const b=boundary(config(),retainedSource(),{fault:'source-after'}),r=await runRetainedRescore(b.c,b.io,runtime);
 assert.equal(r.status,'failed_or_unknown');assert.equal(b.api.jobs.length,2);assert.equal(r.report.passed,false);assert.equal(r.report.originalJobsUnchangedObserved,false);
 assert.equal(b.api.calls.filter(c=>c.method==='POST'&&c.route!=='/jobs'&&c.route!=='/suites').length,0);
});
test('retained execution error preserves original answer/latency/reason, blocks derived rules, but is not a transport failure',async()=>{
 const source=retainedSource(),row=source.runs[0].result.results[0];row.status='error';row.reason='Original provider failure';row.output=' \nRAW answer is retained.\n ';row.latencyMs=12.25;
 const b=boundary(config(),source),r=await runRetainedRescore(b.c,b.io,runtime);assert.equal(r.status,'completed');assert.equal(r.report.protocolPassed,true);assert.equal(r.report.allDerivedRuleGatesPassed,false);
 const actual=r.report.runs[0].importedJob.result;assert.equal(actual.total,10);assert.equal(actual.errors,1);assert.equal(actual.score,90);assert.equal(actual.gate,'blocked');
 assert.deepEqual([actual.results[0].output,actual.results[0].latencyMs,actual.results[0].reason],[row.output,12.25,'Original provider failure']);assert.equal(actual.results[0].evaluatorStatus,'not_run');
 assert.equal(r.report.sourceReportOriginal.runs[0].result.score,100,'old inconsistent score is retained, never relabelled');
});
for(const type of ['missing','not_run','whole-unexecuted'])test(type+' cannot turn an incomplete original into a passing ten-case subset',async()=>{
 const source=retainedSource();if(type==='missing')source.runs[0].result.results.pop();
 else if(type==='not_run'){source.runs[0].result.results[0].status='not_run';source.runs[0].result.results[0].reason='Original not-run explanation';}
 else{source.runs[0].status='queued';source.runs[0].result=null;}
 const b=boundary(config(),source),r=await runRetainedRescore(b.c,b.io,runtime);assert.equal(r.status,'completed');const result=r.report.runs[0].importedJob.result;
 assert.equal(result.total,10);assert.equal(result.errors,type==='whole-unexecuted'?10:1);assert.equal(result.score,type==='whole-unexecuted'?0:90);assert.equal(result.gate,'blocked');
 assert.deepEqual(r.report.runs[0].originalResult,source.runs[0].result);
 if(type==='not_run')assert.equal(result.results[0].reason,'Original not-run explanation');
});
test('case/prompt/result order and latency/critical policies are never sorted or relaxed',async()=>{
 const source=retainedSource();source.cases.reverse();source.runs.reverse();source.policy.maxLatencyMs=1;
 for(const j of source.runs){j.result.results.reverse();j.snapshot.suite.data.cases=structuredClone(source.cases);j.snapshot.suite.data.policy=structuredClone(source.policy);j.result.results[0].latencyMs=12;}
 const b=boundary(config(),source),r=await runRetainedRescore(b.c,b.io,runtime);assert.equal(r.status,'completed');assert.deepEqual(r.report.runs.map(r=>r.promptVersion),['v2','v1']);
 assert.deepEqual(r.report.definition.cases.map(c=>c.id),source.cases.map(c=>c.id));assert.equal(r.report.definition.policy.maxLatencyMs,1);assert.equal(r.report.runs[0].importedJob.result.results[0].status,'failed');
});
for(const fault of ['intent','observed','result','retainSource','retain','terminal'])test('failed '+fault+' persistence cannot produce successful exit/continue uncertain sends',async()=>{
 const b=boundary();b.io[fault]=async()=>{throw Error('INSECURE_PRIVATE_RAW_DIAGNOSTIC');};const r=await runRetainedRescore(b.c,b.io,runtime);
 assert.notEqual(r.status,'completed');assert.equal(b.api.jobs.length<=(fault==='terminal'?2:0),true);assert.doesNotMatch(JSON.stringify(r),/INSECURE_PRIVATE_RAW_DIAGNOSTIC/);
});
test('issuer failure, cancellation, backwards time and queued deadline never fall back or resend',async()=>{
 for(const mode of ['auth','cancel','backward','queued']){const b=boundary(config({deadlineMs:1000}),retainedSource(),{fault:mode==='queued'?'queued':''});
  if(mode==='auth')b.io.authenticate=async()=>{throw Error('INSECURE_PRIVATE_AUTH');};
  if(['cancel','backward'].includes(mode)){const original=b.io.intent;b.io.intent=async(n,v)=>{await original(n,v);mode==='cancel'?b.controller.abort():b.advance(-1);};}
  const r=await runRetainedRescore(b.c,b.io,runtime);assert.equal(r.status,'failed_or_unknown');assert.equal(b.api.calls.filter(c=>c.route==='/jobs').length<=1,true);assert.doesNotMatch(JSON.stringify(r),/INSECURE_PRIVATE_AUTH/);
 }
});
