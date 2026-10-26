import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { runCloudReplaySmoke,validateCloudSmoke } from '../scripts/cloud-smoke-core.mjs';
import { boundary,config,fixture,ids,runId,token } from './fixtures/cloud-smoke-data.mjs';
net.Socket.prototype.connect=()=>{throw Error('No native TCP in cloud smoke protocol tests');};
globalThis.fetch=()=>{throw Error('No native fetch in cloud smoke protocol tests');};
test('full protocol creates app/suite/one replay, checks the original ten cases and retains untouched evidence',async()=>{
 const b=boundary(),r=await runCloudReplaySmoke(b.c,b.io);assert.equal(r.passed,true);assert.equal(r.state,'completed');assert.equal(r.requests,4);
 assert.deepEqual(b.commands.map(v=>[v.method,v.path]),[['POST','applications'],['POST','suites'],['POST','jobs'],['GET','jobs/'+ids.job]]);
 assert.deepEqual(b.commands[0].body,{...fixture.application,name:'Cloud smoke '+runId});assert.deepEqual(b.commands[1].body,fixture.suite);
 assert.deepEqual(b.commands[2].body,{appId:ids.app,suiteId:ids.suite,candidate:'smoke-'+runId,commitRef:'a'.repeat(40),source:'replay',promptVersion:'v1',scenario:'passing'});
 assert.equal(b.commands[2].key,'smoke-'+runId);assert.equal(r.modelCallsRequested,0);assert.equal(r.actualProviderCallsIndependentlyMeasured,false);assert.equal(r.independentReviewOrDeployment,false);
 assert.equal(b.retained.result.score,100);assert.equal(b.terminals.length,1);assert.equal(JSON.stringify(r).includes(token),false);
});
test('queued/running observation polls read-only; no mutation or failed request is retried',async()=>{
 const b=boundary({queued:2}),r=await runCloudReplaySmoke(b.c,b.io);assert.equal(r.passed,true);assert.equal(b.commands.filter(x=>x.method==='POST').length,3);assert.equal(b.commands.filter(x=>x.method==='GET').length,3);assert.equal(b.events.filter(e=>e[0]==='sleep').length,2);
});
test('persisted intent precedes auth and each request, original status/bytes are observed before step success',async()=>{
 const b=boundary();await runCloudReplaySmoke(b.c,b.io);let last;
 for(const e of b.events){if(e[0]==='intent')last=e;if(e[0]==='authorize')assert.equal(last[2].name,'authentication');if(e[0]==='request')assert.equal(last[2].request.path,e[1]);}
 for(const n of [3,4,5,6]){const observed=b.events.findIndex(e=>e[0]==='observed'&&e[1]===n),done=b.events.findIndex(e=>e[0]==='result'&&e[1]===n);assert.ok(observed>=0&&observed<done);}
 for(const r of b.observed)assert.deepEqual(JSON.parse(Buffer.from(r.rawEntityBase64,'base64')),r.body);
});
for(const[route,n]of [['applications',1],['suites',2],['jobs',3],['jobs/'+ids.job,4]])for(const status of [401,429,503,504])
 test('HTTP'+status+' at '+route+' stops with original observation and no new request',async()=>{
  const b=boundary({failureAt:route,status}),r=await runCloudReplaySmoke(b.c,b.io);assert.equal(r.passed,false);assert.equal(r.state,'failed_or_unknown_retained');assert.equal(b.commands.length,n);
  const last=b.observed.at(-1);assert.equal(last.status,status);assert.equal(last.body.error,'SYNTHETIC unknown; retain original');assert.equal(b.terminals.length,1);assert.equal(r.retryAllowed,false);
 });
for(const[key,mutate]of [
 ['foreign job',j=>{j.id=ids.app;}],['foreign app',j=>{j.input.appId=ids.suite;}],['foreign suite',j=>{j.input.suiteId=ids.app;}],
 ['real source',j=>{j.input.source='real';}],['different commit',j=>{j.input.commitRef='f'.repeat(40);}],
 ['duplicate result',j=>{j.result.results[1]=j.result.results[0];}],['missing result',j=>{j.result.results.pop();}],
 ['failed result',j=>{j.result.results[0].status='failed';}],['blocked gate',j=>{j.result.gate='blocked';}],
 ['failed job',j=>{j.status='failed';}],['changed snapshot ID',j=>{j.snapshot.suite.id=ids.app;}],['relaxed threshold',j=>{j.snapshot.suite.data.policy.minScore=90;}],
 ['unknown job state',j=>{j.status='missing';}],
])test('rejects '+key+' rather than manufacturing a passing smoke',async()=>{
 const b=boundary({mutateJob:mutate}),r=await runCloudReplaySmoke(b.c,b.io);assert.equal(r.passed,false);assert.equal(b.retained,undefined);assert.equal(b.commands.length,4);
});
test('different prompt/scenario cannot satisfy a smoke submitted with explicit passing v1 input',async()=>{
 for(const mutate of [j=>{j.input.promptVersion='v2';},j=>{j.input.scenario='failing';}]){const b=boundary({mutateJob:mutate});assert.equal((await runCloudReplaySmoke(b.c,b.io)).passed,false);}
});
test('snapshot rule text cannot change while keeping the same case IDs and a green score',async()=>{
 const b=boundary({mutateJob:j=>{j.snapshot.suite.data.cases[0].expected='different rule';}});assert.equal((await runCloudReplaySmoke(b.c,b.io)).passed,false);
});
test('a job response after the original observation deadline is retained but cannot pass',async()=>{
 const b=boundary({lateObservation:true}),r=await runCloudReplaySmoke(b.c,b.io);assert.equal(r.passed,false);assert.equal(b.observed.length,4);assert.equal(b.retained,undefined);
});
test('intent persistence consuming the observation budget cannot start a late GET',async()=>{
 const b=boundary({lateIntent:'observe-0'}),r=await runCloudReplaySmoke(b.c,b.io);assert.equal(r.passed,false);assert.equal(b.commands.length,3);assert.equal(b.commands.some(v=>v.method==='GET'),false);
});
test('aggregate evidence limit retains the last observation and stops polling, without a new mutation',async()=>{
 const b=boundary({queued:100,observationPadding:750000}),r=await runCloudReplaySmoke(b.c,b.io);assert.equal(r.passed,false);assert.equal(r.code,'evidence_size_limit');
 assert.equal(b.commands.filter(x=>x.method==='POST').length,3);assert.ok(b.commands.length<20);assert.equal(b.observed.length,b.commands.length);assert.equal(b.retained,undefined);
});
for(const fault of [['intent',2],['result',2],['authorize',0],['intent',3],['observed',3],['result',3],['retainJob',0]])test('failed '+fault.join('/')+' halts and retains the partial run',async()=>{
 const b=boundary({fail:fault}),r=await runCloudReplaySmoke(b.c,b.io);assert.equal(r.passed,false);assert.equal(r.resumeAllowed,false);assert.equal(r.retryAllowed,false);assert.equal(b.terminals.length,1);assert.equal(JSON.stringify(r).includes('PRIVATE_TEST_FAILURE'),false);
 if(fault[0]==='intent'&&fault[1]===2)assert.equal(b.events.some(e=>e[0]==='authorize'),false);
 if(fault[1]===3)assert.equal(b.commands.length,fault[0]==='intent'?0:1);
});
test('unknown terminal persistence is attempted once, never overwritten with another terminal',async()=>{
 const b=boundary({fail:['terminal',0]}),r=await runCloudReplaySmoke(b.c,b.io);assert.equal(r.evidenceState,'terminal_persistence_unknown');assert.equal(b.terminals.length,1);
});
test('terminal persistence after cancellation/deadline cannot return a successful exit or overwrite its first receipt',async()=>{
 for(const options of [{lateTerminal:true},{abortAtTerminal:true}]){const b=boundary(options),r=await runCloudReplaySmoke(b.c,b.io);assert.equal(r.passed,false);assert.equal(r.evidenceState,'terminal_persistence_unknown');assert.equal(b.terminals.length,1);}
});
test('owned partial reservation is retained and no credential or request is accessed',async()=>{
 const b=boundary({fail:['reserve',0]}),r=await runCloudReplaySmoke(b.c,b.io);assert.equal(r.state,'failed_or_unknown_retained');assert.equal(b.commands.length,0);assert.equal(b.events.some(e=>e[0]==='authorize'),false);
});
test('old consumed IDs cannot re-enter authentication or mutate retained evidence',async()=>{
 const b=boundary();assert.equal((await runCloudReplaySmoke(b.c,b.io)).passed,true);const original=structuredClone(b.terminals),count=b.commands.length;assert.equal((await runCloudReplaySmoke(b.c,b.io)).passed,false);assert.equal(b.commands.length,count);assert.deepEqual(b.terminals,original);
});
test('abort after intent stops the side effect; abort during final evidence cannot become success',async()=>{
 for(const options of [{abortAtIntent:3},{abortAtRetain:true}]){const b=boundary(options),r=await runCloudReplaySmoke(b.c,b.io);assert.equal(r.passed,false);if(options.abortAtIntent)assert.equal(b.commands.length,0);}
});
for(const[name,change]of [
 ['no opt-in',c=>{c.allowReplaySmoke=false;}],['HTTP',c=>{c.origin='http://cloud.example.test';}],['origin path',c=>{c.origin+='/path';}],
 ['unapproved target',c=>{c.allowedOrigins=[];}],['credential URL',c=>{c.origin='https://user:password@cloud.example.test';}],
 ['classroom',c=>{c.origin='https://localhost:5193';c.allowedOrigins=[c.origin];}],['missing runID',c=>{c.runId=undefined;}],
 ['traversal runID',c=>{c.runId='../old';}],['no commit',c=>{c.commit=undefined;}],['mutable image',c=>{c.image='example.test/rg:latest';}],
 ['unknown auth',c=>{c.authMode='password';}],['model setting',c=>{c.MODEL_API_KEY='INSECURE_TEST_ONLY';}],
])test('configuration rejects '+name+' before reserve/credential/request',async()=>{
 const b=boundary(),c=config();change(c);const r=await runCloudReplaySmoke(c,b.io);assert.equal(r.state,'refused_before_reservation');assert.deepEqual(b.events,[]);
});
test('config copy does not modify original input, including allowlist',()=>{const c=config(),r=validateCloudSmoke(c);r.allowedOrigins.push('https://other.example.test');assert.equal(c.allowedOrigins.length,1);});
