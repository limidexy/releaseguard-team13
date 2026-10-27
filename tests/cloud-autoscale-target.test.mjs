import test from 'node:test';
import assert from 'node:assert/strict';
import {autoscaleTarget} from '../scripts/cloud-autoscale-target.mjs';
import {runControlledBacklog} from '../scripts/cloud-autoscale-core.mjs';
import {benchmarkTargetHash} from '../scripts/cloud-benchmark-target.mjs';
import {autoscaleBoundary} from './fixtures/cloud-autoscale-protocol.mjs';
const select=b=>({...b.c.target,runId:b.c.runId,namespace:b.c.cloud.namespace,imageDigest:b.c.image.split('@')[1]});
test('all mutations include UID,resourceVersion and whole-spec tests; onlymin changes, never policy/resource/replica writes',async()=>{
 const b=autoscaleBoundary();assert.equal((await runControlledBacklog(b.c,b.io)).passed,true);
 for(const event of b.f.events.filter(e=>e.type==='patch')){
  const paths=event.ops.filter(p=>p.op==='test').map(p=>p.path);for(const name of ['/metadata/uid','/metadata/resourceVersion','/spec'])assert.ok(paths.includes(name));
  assert.equal(event.ops.some(p=>p.op!=='test'&&p.path.startsWith('/spec')&&p.path!=='/spec/minReplicaCount'),false);
 }
});
for(const field of ['workerUID','controllerUID','workerSpecSHA256','controllerSpecSHA256'])test('wrong '+field+' refuses before anyselectedcredential orAPI',async()=>{
 const b=autoscaleBoundary();b.c.target[field]=field.endsWith('SHA256')?'b'.repeat(64):'foreign-uid';const r=await runControlledBacklog(b.c,b.io);
 assert.equal(r.passed,false);assert.equal(b.auth.length,0);assert.equal(b.calls.length,0);assert.equal(b.f.events.some(e=>e.type==='patch'),false);
});
test('changing the selectedhash cannot silently bless a different controllerpolicy',async()=>{
 const b=autoscaleBoundary();b.f.state.controller.spec.maxReplicaCount=4;b.c.target.controllerSpecSHA256=benchmarkTargetHash('controller',b.f.state.controller.spec);
 const r=await runControlledBacklog(b.c,b.io);assert.equal(r.passed,false);assert.equal(b.auth.length,0);assert.equal(b.calls.length,0);
});
test('CAS race preserves original conflict, never force-writes or resends',async()=>{
 const b=autoscaleBoundary(),patch=b.targetIO.patch;let used=false;b.targetIO.patch=async(kind,ops,clean)=>{
  if(!used&&kind==='controller'&&!clean){used=true;b.f.state.controller.metadata.resourceVersion='999';b.f.state.controller.metadata.annotations['releaseguard.io/controlled-backlog']='foreign-actor';}
  return patch(kind,ops,clean);
 };
 const r=await runControlledBacklog(b.c,b.io);assert.equal(r.passed,false);assert.equal(b.f.state.controller.metadata.annotations['releaseguard.io/controlled-backlog'],'foreign-actor');
 assert.equal(b.f.events.filter(e=>e.type==='patch').length,1);assert.equal(r.restoration.originalStateRestored,false);
});
test('replacement HPA identity afterthehold stopsrelease andverification without relabellingtheacceptedcohort',async()=>{
 const b=autoscaleBoundary(),read=b.targetIO.read;let reads=0;b.targetIO.read=async(kind,clean)=>{
  const v=await read(kind,clean);if(kind==='hpas'&&++reads>3&&v.items[0])v.items[0].metadata.uid='foreign-replacement';return v;
 };
 const r=await runControlledBacklog(b.c,b.io);assert.equal(r.passed,false);assert.equal(b.calls.filter(c=>c.route.endsWith('/jobs')).length<=700,true);
 // It may detect replacement onlyafterenqueuing: never rewrite the accepted
 // cohort into a successful experiment or retry it under another HPA.
 assert.equal(r.observedVerified,0);
});
test('originalpausedone is restored on failure, ratherthanconverted to a newCDhandoff',async()=>{
 const b=autoscaleBoundary({initialPaused:true,disconnectPost:1,postcondition:'paused-one-for-cd'}),r=await runControlledBacklog(b.c,b.io);
 assert.equal(r.passed,false);assert.equal(r.restoration.originalStateRestored,true);assert.equal(r.restoration.pausedOneHandoff,false);
 assert.equal(b.f.state.controller.metadata.annotations['autoscaling.keda.sh/paused-replicas'],'1');assert.equal(b.f.state.controller.metadata.annotations['releaseguard.io/controlled-backlog'],undefined);
});
test('nonadvancing injectedclock cannot loop forever or become a successfulwarmup',async()=>{
 const b=autoscaleBoundary();b.targetIO.sleep=async()=>{};const t=autoscaleTarget(select(b),b.targetIO);await t.preflight();await assert.rejects(()=>t.prepare());
 assert.equal(b.f.events.filter(e=>e.type==='read'&&e.kind==='controller').length<100,true);assert.equal((await t.finish(false,'restore-original')).originalStateRestored,true);
});
test('backwardsclock is rejected by targetboundary even before core can recheck',async()=>{
 const b=autoscaleBoundary(),t=autoscaleTarget(select(b),b.targetIO);await t.preflight();b.targetIO.now=()=>-1;await assert.rejects(()=>t.prepare());
});
test('cancellation atterminal persistence cannot return successfulglobalstate',async()=>{
 const b=autoscaleBoundary(),terminal=b.io.terminal;b.io.terminal=async r=>{await terminal(r);b.controller.abort();};const r=await runControlledBacklog(b.c,b.io);
 assert.equal(r.passed,false);assert.equal(r.evidenceState,'completion_deadline_or_cancellation');assert.equal(b.records.get('terminal.json').passed,true); // Preserve the exact earlier write.
});
