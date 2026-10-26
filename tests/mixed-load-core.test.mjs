import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runMixedLoad, summarizeStage, seedQuota } from '../scripts/mixed-load-core.mjs';
const assets=JSON.parse(await readFile(new URL('../public/demo-fixtures.json',import.meta.url),'utf8'));
function fixture(mode='success'){
 let now=0, sequence=0, active=0, maxActive=0, reads=0, measuredWrites=0;
 const rows=new Map(), events=[], requests=[], subjects=[];
 const deps={
  clock:{now:()=>now,sleep:async ms=>{now+=ms;await Promise.resolve();}},
  key:()=>randomUUID(),token:async(sub,role,workspace)=>{subjects.push({sub,role,workspace});return{sub,role,workspace};},
  record:async event=>{if(mode==='persist-failure'&&event.kind==='request_intent'&&event.body?.source==='replay')throw Error('OWNED_PRIVATE_ERROR');events.push(structuredClone(event));},
  transport:async(path,token,body,key,meta)=>{
   active++;maxActive=Math.max(active,maxActive);await Promise.resolve();now++;
   requests.push({path,token,body,key,meta});
   try{
    if(path==='applications'||path==='suites')return{status:201,data:{id:randomUUID()}};
    if(path==='jobs'&&body){
     if(meta.phase==='measured'){measuredWrites++;if(mode==='http429')return{status:429,data:{error:'OWNED_PRIVATE_ERROR'}};}
     if(meta.phase==='measured'&&mode==='unknown-empty')throw Error('OWNED_PRIVATE_ERROR');
     const id=randomUUID(),job={id,status:'succeeded',input:body,result:{gate:'passed'},workspace:token.workspace};
     rows.set(id,job);
     if(meta.phase==='measured'&&mode==='unknown-saved')throw Error('OWNED_PRIVATE_ERROR');
     if(meta.phase==='seed'&&mode==='seed-failure'&&++sequence===2)return{status:503,data:{}};
     return{status:202,data:{id}};
    }
    if(path.startsWith('jobs/submissions/')){
     const prior=requests.find(r=>r.key===path.split('/').at(-1)&&r.body?.source==='replay');
     const job=[...rows.values()].find(j=>j.input===prior?.body);
     return job?{status:200,data:{id:job.id,submissionState:'accepted'}}:{status:404,data:{definitive:false,doNotResubmit:true}};
    }
    if(path.startsWith('jobs/'))return{status:200,data:rows.get(path.split('/')[1])};
    reads++;return{status:200,data:[...rows.values()].filter(j=>j.workspace===token.workspace).slice(0,25)};
   }finally{active--;}
  },
  telemetry:async()=>({at:'synthetic',containers:[],database:{xact_commit:123}}),
  rowCount:async ws=>[...rows.values()].filter(j=>j.workspace===ws).length,
  seedPace:async()=>{},assets,runId:'11111111-1111-4111-8111-111111111111',seconds:5,deadlineMs:600000,
 };
 return{deps,rows,events,requests,subjects,metrics:()=>({now,maxActive,reads,measuredWrites})};
}
test('metrics use all API samples including failures, with literal nearest-rank percentiles',()=>{
 const raw=[{kind:'read',durationMs:10,passed:true},{kind:'read',durationMs:30,passed:false},{kind:'read',durationMs:20,passed:true},{kind:'write',durationMs:80,passed:false}];
 const summary=summarizeStage(raw,1000);
 assert.deepEqual(summary,[{kind:'read',requests:3,errors:1,requestsPerSecond:3,p50Ms:20,p95Ms:30,p99Ms:30,timingValid:true},{kind:'write',requests:1,errors:1,requestsPerSecond:1,p50Ms:80,p95Ms:80,p99Ms:80,timingValid:true}]);
});
test('negative timing is retained as invalid, not clamped or dropped into a passing percentile',()=>{
 const raw=[{kind:'read',durationMs:-2,passed:true},{kind:'read',durationMs:5,passed:true}];
 const m=summarizeStage(raw,1000)[0];assert.equal(raw[0].durationMs,-2);assert.equal(m.requests,2);assert.equal(m.timingValid,false);assert.equal(m.p95Ms,null);
});
test('zero stable window and empty samples do not fabricate throughput or p95',()=>{
 const m=summarizeStage([],0);assert.ok(m.every(x=>x.requests===0&&x.p95Ms===null&&x.requestsPerSecond===null&&!x.timingValid));
});
test('full two-stage source protocol retains100/1000 seeds,4 clients,3read1write and telemetry',async()=>{
 const f=fixture(),r=await runMixedLoad(f.deps);
 assert.equal(r.passed,true);assert.deepEqual(r.protocol.initialRows,[100,1000]);assert.equal(r.protocol.clients,4);assert.equal(r.protocol.thinkTimeMs,100);
 assert.equal(r.protocol.workerReplicas,1);assert.equal(r.realProviderCalls,0);assert.equal(r.cloud,false);
 assert.deepEqual(r.stages.map(s=>s.initialRows),[100,1000]);assert.ok(r.stages.every(s=>s.state==='completed'&&s.seed.length===s.initialRows&&s.seed.every(x=>x.state==='completed')));
 for(const s of r.stages){
  assert.equal(s.rowCountMatches,true);assert.equal(s.attemptedWrites,s.admittedWrites);assert.equal(s.completedWrites,s.admittedWrites);
  assert.equal(s.databaseRowsAfter,s.initialRows+s.admittedWrites);assert.ok(s.raw.length>0);
  assert.ok(s.raw.every(x=>x.kind===(x.i%4===3?'write':'read')));assert.deepEqual([...new Set(s.raw.map(x=>x.client))].sort(),[0,1,2,3]);
  assert.deepEqual(s.before.database,{xact_commit:123});assert.deepEqual(s.after.database,{xact_commit:123});
 }
 assert.ok(f.requests.filter(r=>r.body?.source).every(r=>r.body.source==='replay'&&r.body.scenario==='passing'));
 assert.equal(new Set(f.requests.filter(r=>r.body?.source).map(r=>r.key)).size,f.requests.filter(r=>r.body?.source).length);
 assert.ok(f.subjects.every(x=>x.role==='contributor'));assert.equal(new Set(f.subjects.map(x=>x.sub)).size,2);
 assert.ok(f.metrics().maxActive<=12);assert.doesNotMatch(JSON.stringify(r),/OWNED_PRIVATE_ERROR/);
});
test('persist-first intent is observable before every mutating transport invocation',async()=>{
 const f=fixture(),transport=f.deps.transport;
 f.deps.transport=async(path,token,body,key,meta)=>{
  if(body)assert.ok(f.events.some(e=>e.kind==='request_intent'&&e.requestId===meta.requestId&&e.key===key&&e.path===path));
  return transport(path,token,body,key,meta);
 };
 assert.equal((await runMixedLoad(f.deps)).passed,true);
});
test('429 is preserved and stops new sends, without retry/identity rotation or second stage',async()=>{
 const f=fixture('http429'),r=await runMixedLoad(f.deps);
 assert.equal(r.passed,false);assert.equal(r.stages[1].state,'not_started');const s=r.stages[0];
 assert.ok(s.raw.some(x=>x.status===429&&!x.passed));assert.ok(s.errors>0);assert.ok(s.attemptedWrites>s.admittedWrites);
 assert.equal(new Set(f.subjects.map(x=>x.sub)).size,2);assert.ok(!r.stages[1].seed.some(x=>x.state!=='not_attempted'));
});
test('unknown POST later found in storage never becomes a202 or a successful admission',async()=>{
 const f=fixture('unknown-saved'),r=await runMixedLoad(f.deps),s=r.stages[0];
 assert.equal(r.passed,false);assert.ok(s.raw.some(x=>x.kind==='write'&&x.status===null&&!x.passed));
 assert.equal(s.admittedWrites,0);assert.ok(s.attemptedWrites>0);assert.equal(s.rowCountMatches,false);
 assert.ok(s.writtenJobs.some(j=>j.submissionOutcome==='response_unknown'&&j.id&&j.status==='succeeded'));
 const writes=f.requests.filter(x=>x.meta.phase==='measured'&&x.body);assert.equal(new Set(writes.map(x=>x.key)).size,writes.length);
 assert.doesNotMatch(JSON.stringify(r),/OWNED_PRIVATE_ERROR/);
});
test('partial failed seeding retains all expected seed slots and waits for in-flight senders',async()=>{
 const f=fixture('seed-failure'),r=await runMixedLoad(f.deps),s=r.stages[0];
 assert.equal(r.passed,false);assert.equal(s.seed.length,100);assert.ok(s.seed.some(x=>x.state==='not_attempted'));assert.ok(s.seed.some(x=>x.responseStatus===503));
 assert.equal(f.metrics().maxActive<=6,true);assert.equal(f.requests.filter(x=>x.meta.phase==='measured').length,0);assert.equal(r.stages[1].state,'not_started');
});
test('evidence failure before dispatch records incomplete work and sends no job',async()=>{
 const f=fixture('persist-failure'),r=await runMixedLoad(f.deps);
 assert.equal(r.passed,false);assert.equal(f.requests.filter(x=>x.body?.source==='replay').length,0);
 assert.equal(r.stages[0].seed.length,100);assert.ok(r.stages[0].seed.some(x=>x.state==='not_sent'));
});
test('expired monotonic budget leaves all stages unexecuted and never creates assets',async()=>{
 const f=fixture();f.deps.deadlineMs=0;const r=await runMixedLoad(f.deps);
 assert.equal(r.passed,false);assert.equal(f.requests.length,0);assert.ok(r.stages.every(x=>x.state==='not_started'));
});

test('seed503 is an unknown commit outcome, never a definitive rejection',async()=>{
 const f=fixture('seed-failure'),r=await runMixedLoad(f.deps);
 const row=r.stages[0].seed.find(x=>x.responseStatus===503);assert.equal(row.state,'response_unknown');assert.equal(row.responseStatus,503);assert.equal(r.passed,false);
});
test('completed job evidence must match the exact submitted input, not only an existing ID',async()=>{
 const f=fixture(),transport=f.deps.transport;
 f.deps.transport=async(...args)=>{const r=await transport(...args);if(args[0].startsWith('jobs/')&&!args[0].startsWith('jobs/submissions/')&&r.data?.input)r.data={...r.data,input:{...r.data.input,candidate:'unrelated-job'}};return r;};
 const r=await runMixedLoad(f.deps);assert.equal(r.passed,false);assert.equal(r.stages[1].state,'not_started');assert.equal(r.stages[0].seed.some(x=>x.state==='result_unknown'),true);
});
test('response persistence failure keeps observed202/status metadata instead of fabricating network absence',async()=>{
 const f=fixture(),record=f.deps.record;
 f.deps.record=async e=>{if(e.kind==='response'&&e.status===202)throw Error('OWNED_PRIVATE_ERROR');return record(e);};
 const r=await runMixedLoad(f.deps);assert.equal(r.passed,false);
 const row=r.stages[0].seed.find(x=>x.responseObserved);assert.ok(row);assert.equal(row.responseStatus,202);assert.equal(row.state,'response_evidence_incomplete');assert.ok(row.observedId);
});

test('404 reconciliation remains unknown even if the observed rowcount happens to match',async()=>{
 const f=fixture('unknown-empty'),r=await runMixedLoad(f.deps),s=r.stages[0];assert.equal(r.passed,false);
 assert.equal(s.rowCountMatches,true);assert.ok(s.errors>0);assert.equal(s.admittedWrites,0);
 assert.ok(s.writtenJobs.every(w=>w.id===null&&w.reconciliationStatus===404));assert.ok(s.writtenJobs.every(w=>/not definitive/.test(w.reconciliationLimit)));
});
test('observed HTTP503 stays503 even when readonly reconciliation later finds the exact job',async()=>{
 const f=fixture(),transport=f.deps.transport;
 f.deps.transport=async(...args)=>{const r=await transport(...args);return args[4].phase==='measured'&&args[2]?{status:503,data:{}}:r;};
 const r=await runMixedLoad(f.deps),s=r.stages[0];assert.equal(r.passed,false);assert.ok(s.raw.some(x=>x.status===503&&!x.passed));
 assert.ok(s.writtenJobs.some(w=>w.admissionResponseStatus===503&&w.id&&w.status==='succeeded'));assert.equal(s.admittedWrites,0);assert.equal(s.rowCountMatches,false);
});
test('response journal failure keeps HTTP202 for measured attempts and cannot count them as admitted success',async()=>{
 const f=fixture(),record=f.deps.record;let measuring=false;
 f.deps.record=async e=>{if(e.kind==='request_intent'&&e.phase==='measured')measuring=true;if(measuring&&e.kind==='response'&&e.status===202)throw Error('OWNED_PRIVATE_ERROR');return record(e);};
 const r=await runMixedLoad(f.deps),s=r.stages[0];assert.equal(r.passed,false);assert.ok(s.raw.some(x=>x.status===202&&x.responseObserved&&!x.passed&&x.outcome==='response_evidence_incomplete'));
 assert.equal(s.admittedWrites,0);
});
test('foreign workspace evidence is not counted as completion of this cohort',async()=>{
 const f=fixture(),transport=f.deps.transport;
 f.deps.transport=async(...args)=>{const r=await transport(...args);if(args[0].startsWith('jobs/')&&r.data?.workspace)r.data={...r.data,workspace:'another-workspace'};return r;};
 const r=await runMixedLoad(f.deps);assert.equal(r.passed,false);assert.equal(r.stages[1].state,'not_started');
});

test('an undispatched quota reservation cannot expire while its caller is delayed',async()=>{
 let now=0;const waiters=[];const quota=seedQuota({limit:1,check:()=>{},clock:{now:()=>now,sleep:()=>new Promise(resolve=>waiters.push(resolve))}});
 const permit=await quota({workspace:'same',shouldStop:()=>false});now=61001;
 let second;const pending=quota({workspace:'same',shouldStop:()=>false}).then(p=>{second=p;});
 await Promise.resolve();assert.equal(second,undefined);assert.equal(waiters.length,1);
 permit();now=61002;waiters.shift()();await Promise.resolve();await Promise.resolve();assert.equal(second,undefined);
 now=122002;waiters.shift()();await pending;assert.equal(typeof second,'function');second();assert.throws(()=>second(),/already dispatched/);
});
test('one contributor workspace cannot consume another workspace reservation',async()=>{
 let now=0;const quota=seedQuota({limit:1,check:()=>{},clock:{now:()=>now,sleep:async()=>{throw Error('should not wait');}}});
 const first=await quota({workspace:'first',shouldStop:()=>false}),second=await quota({workspace:'second',shouldStop:()=>false});first();second();
});
test('quota waiting checks the original deadline and never grants another send after cancellation',async()=>{
 let now=0,stopped=false;const quota=seedQuota({limit:1,check:()=>{if(now>=1000)throw Error('deadline');},clock:{now:()=>now,sleep:async ms=>{now+=ms;}}});
 const p=await quota({workspace:'same',shouldStop:()=>false});p();
 await assert.rejects(quota({workspace:'same',shouldStop:()=>false}),/deadline/);
 now=0;stopped=true;await assert.rejects(quota({workspace:'same',shouldStop:()=>stopped}));
});
