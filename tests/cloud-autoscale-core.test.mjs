import test from 'node:test';
import assert from 'node:assert/strict';
import {runControlledBacklog,validateAutoscale} from '../scripts/cloud-autoscale-core.mjs';
import {autoscaleBoundary} from './fixtures/cloud-autoscale-protocol.mjs';
const run=options=>{const b=autoscaleBoundary(options);return runControlledBacklog(b.c,b.io).then(r=>({b,r}));};
test('full700 ten-case source protocol retains all1402requests, three auth boundaries,150s hold and automatic3then1',async()=>{
 const {b,r}=await run();assert.equal(r.passed,true,JSON.stringify(r.errors));assert.equal(r.requests,1402);assert.equal(b.auth.filter(x=>x==='authorize').length,3);
 assert.equal(r.requested,700);assert.equal(r.denominator,700);assert.equal(r.uniqueAccepted,700);assert.equal(r.observedVerified,700);assert.equal(r.tasks.length,700);
 assert.equal(r.preparation.metricWarmupMs,150000);assert.deepEqual(r.samples.map(s=>s.ready),[3,1]);assert.equal(r.restoration.state,'restored');
 assert.equal(r.automaticScaleOutObserved,true);assert.equal(r.automaticScaleDownObserved,true);assert.equal(r.actualWorkerDistributionObserved,true);
 assert.equal(Object.values(r.workerCounts).reduce((a,b)=>a+b,0),700);assert.equal(Object.values(r.workerCounts).filter(n=>n>0).length,3);
 assert.equal(r.automaticScalingBenefitProven,false);assert.equal(r.maximumCapacityProven,false);assert.equal(r.modelCallsRequested,0);
 const patches=b.f.events.filter(e=>e.type==='patch');assert.equal(patches.some(e=>e.ops.some(p=>p.path==='/spec/replicas')),false);
 assert.equal([...b.records.keys()].filter(k=>/^operations\/.*-observed/.test(k)).length,1402);
 assert.equal(b.records.get('events.json').length,1);assert.equal(b.records.get('terminal.json').passed,true);
});
test('original paused-one CD capability is explicit, acknowledged and distinct from original-state restoration',async()=>{
 const {b,r}=await run({initialPaused:true,postcondition:'paused-one-for-cd'});assert.equal(r.passed,true,JSON.stringify(r.errors));assert.equal(r.restoration.pausedOneHandoff,true);
 assert.equal(r.restoration.originalStateRestored,false);assert.equal(b.f.state.controller.metadata.annotations['autoscaling.keda.sh/paused-replicas'],'1');assert.equal(b.f.state.controller.metadata.annotations['releaseguard.io/controlled-backlog'],b.c.runId);
});
test('currentmain five-replica/120s profile is recorded, never silently retuned to originalthree',async()=>{
 const {b,r}=await run({profile:'main-five'});assert.equal(r.passed,true,JSON.stringify(r.errors));assert.equal(r.preparation.maxReplicas,5);assert.equal(r.preparation.controllerProfile,'main-five');
 assert.equal(b.f.state.controller.spec.maxReplicaCount,5);assert.equal(b.f.state.controller.spec.cooldownPeriod,120);
});
test('unknown accepted POST stops new dispatch, drains at most8in-flight receipts, keeps full700denominator and never retries',async()=>{
 const {b,r}=await run({disconnectPost:1});assert.equal(r.passed,false);const posts=b.calls.filter(c=>c.method==='POST'&&c.route.endsWith('/jobs'));
 assert.ok(posts.length>0&&posts.length<=8,String(posts.length));assert.equal(new Set(posts.map(p=>p.key)).size,posts.length);assert.equal(r.denominator,700);
 assert.equal(r.tasks.some(s=>s.submission.state==='unknown'),true);assert.equal(r.tasks.some(s=>s.submission.state==='not_sent'),true);assert.equal(r.observedVerified,0);assert.equal(r.restoration.state,'restored');
 assert.equal([...b.records.keys()].filter(k=>/^operations\/.*-observed/.test(k)).length,posts.length+2);
});
test('duplicate returned job identity is never700distinct verified rows',async()=>{
 let first;const {r}=await run({mutateJob:j=>{first??=j.id;j.id=first;}});assert.equal(r.passed,false);assert.equal(r.observedVerified<700,true);assert.equal(r.tasks.some(t=>t.job&&t.job.id!==t.submission.jobId),true);
});
for(const option of ['foreignMetric','staleMetric','foreignHPA','missingObservedGeneration'])test(option+' is refused without any700-job dispatch',async()=>{
 const {b,r}=await run({[option]:true});assert.equal(r.passed,false);assert.equal(b.calls.some(c=>c.route.endsWith('/jobs')),false);assert.equal(r.denominator,700);
 if(option==='foreignHPA'||option==='missingObservedGeneration')assert.equal(b.auth.length,0);
});
test('a concurrent replica edit2 is retained, never overwritten with pausedone or a successful restoration claim',async()=>{
 const {b,r}=await run({externalReplica:true});assert.equal(r.passed,false);assert.equal(b.f.state.worker.spec.replicas,2);assert.equal(r.restoration.originalStateRestored,false);assert.equal(r.restoration.pausedOneHandoff,false);
 assert.equal(b.f.events.filter(e=>e.type==='patch'&&e.cleanup).length,0);
});
test('cleanup failure makes global reportfailed even after all700valid rows; raw scaling observations remain',async()=>{
 const {b,r}=await run({cleanupFailure:true});assert.equal(r.observedVerified,700);assert.equal(r.automaticScaleOutObserved,true);assert.equal(r.passed,false);assert.equal(b.records.get('terminal.json').passed,false);
});
for(const option of ['unknownBefore','unknownAfter'])test(option+' is observed and never resent; conservative owned recovery stays separate',async()=>{
 const {b,r}=await run({[option]:true});assert.equal(r.passed,false);assert.equal(b.f.events.filter(e=>e.type==='patch'&&!e.cleanup&&e.ops.some(p=>p.op!=='test'&&p.value==='zero')).length,1);
 assert.equal(b.calls.filter(c=>c.route.endsWith('/jobs')).length,0);assert.equal(r.restoration.state,'restored');
});
test('an unchanged one-Worker sample for210s is failed control proof, not a successful distributed experiment',async()=>{
 const {r}=await run({noScale:true});assert.equal(r.passed,false);assert.equal(r.automaticScaleOutObserved,false);assert.equal(r.samples.length,70);assert.equal(r.observedVerified,0);
});
test('negative original timestamps survive in evidence and fail verification',async()=>{
 const {r}=await run({mutateJob:j=>{j.finished_at='2026-10-10T23:59:59.999Z';}});assert.equal(r.passed,false);assert.equal(r.tasks.some(t=>t.job?.finished_at==='2026-10-10T23:59:59.999Z'),true);
});
for(const option of ['sourceDrift','terminalFailure'])test(option+' cannot return successful completion',async()=>{
 const b=autoscaleBoundary();if(option==='sourceDrift')b.io.verifyRuntime=async()=>{throw Error('Synthetic source drift');};else b.io.terminal=async()=>{throw Error('Synthetic disk failure');};
 const r=await runControlledBacklog(b.c,b.io);assert.equal(r.passed,false);assert.equal(r.state,'failed_or_unknown_retained');
});
test('independent optin, selected policy and exclusivequeue acknowledgement are mandatory',()=>{
 for(const change of [c=>{delete c.allowControlledBacklog;c.allowPairedReplay=true;},c=>{c.isolation.exclusiveQueueAndWorker=false;},c=>{c.postcondition='deploy';},c=>{c.target.controllerProfile='retune';},c=>{c.jobs=10;}]){
  const b=autoscaleBoundary();change(b.c);assert.throws(()=>validateAutoscale(b.c));
 }
});
