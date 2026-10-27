import test from 'node:test';
import assert from 'node:assert/strict';
import {benchmarkTarget,benchmarkTargetHash} from '../scripts/cloud-benchmark-target.mjs';
import {targetFixture} from './fixtures/cloud-benchmark-target.mjs';
const owner='releaseguard.io/paired-benchmark';
test('owned target actually pauses generated HPA, observes1/3/3/1 ready Pods and restores exact original fields',async()=>{
 const f=targetFixture(),original=structuredClone(f.state),t=benchmarkTarget(f.config,f.io);
 assert.equal((await t.prepare()).controllerPaused,true);assert.equal(f.state.hpas.items.length,0);
 for(const n of [1,3,3,1]){const r=await t.scale(n);assert.equal(r.replicas,n);assert.equal(r.workerIds.length,n);assert.equal(new Set(r.pods.map(p=>p.uid)).size,n);}
 const r=await t.restore();assert.equal(r.workerRestored,true);assert.equal(r.controllerRestored,true);assert.equal(f.state.worker.spec.replicas,1);
 assert.deepEqual(f.state.worker.spec,original.worker.spec);assert.deepEqual(f.state.controller.spec,original.controller.spec);
 assert.deepEqual(f.state.worker.metadata.annotations,original.worker.metadata.annotations);assert.deepEqual(f.state.controller.metadata.annotations,original.controller.metadata.annotations);assert.equal(f.state.hpas.items.length,1);
 for(const p of f.events.filter(e=>e.type==='patch')){assert.equal(p.ops.some(x=>x.op==='test'&&x.path==='/metadata/uid'),true);assert.equal(p.ops.some(x=>x.op==='test'&&x.path==='/metadata/resourceVersion'),true);assert.equal(p.ops.some(x=>x.op==='test'&&x.path==='/spec'),true);}
 const count=f.patches();assert.equal((await t.restore()).controllerRestored,true);assert.equal(f.patches(),count);
});
test('original fully paused annotations and unrelated metadata survive manual comparison and restoration',async()=>{
 const f=targetFixture({initialPaused:true,initialReplicas:3});f.state.controller.metadata.annotations['autoscaling.keda.sh/paused-replicas']='3';f.reconcile();
 const before=structuredClone(f.state.controller.metadata.annotations),t=benchmarkTarget(f.config,f.io);await t.prepare();await t.scale(1);await t.scale(3);
 f.state.controller.metadata.annotations.concurrent='keep';f.state.worker.metadata.annotations.concurrent='keep';const r=await t.restore();assert.equal(r.controllerRestored,true);
 assert.deepEqual(f.state.controller.metadata.annotations,{...before,concurrent:'keep'});assert.equal(f.state.worker.metadata.annotations.concurrent,'keep');assert.equal(f.state.hpas.items.length,0);assert.equal(f.state.worker.spec.replicas,3);
});
for(const [label,change]of [
 ['wrong UID',f=>{f.state.worker.metadata.uid='foreign';}],
 ['changed image',f=>{f.state.worker.spec.template.spec.containers[0].image='foreign:v2';}],
 ['changed resource',f=>{f.state.worker.spec.template.spec.containers[0].resources.limits.cpu='9';}],
 ['foreign HPA',f=>{f.state.hpas.items[0].metadata.ownerReferences[0].uid='foreign';}]
])test(label+' refuses before any mutation',async()=>{const f=targetFixture();change(f);const t=benchmarkTarget(f.config,f.io);await assert.rejects(t.prepare());assert.equal(f.patches(),0);});
test('a foreign lease on an already paused resource cannot be acquired or overwritten',async()=>{
 const f=targetFixture({initialPaused:true});f.state.worker.metadata.annotations[owner]='foreign';const t=benchmarkTarget(f.config,f.io);await assert.rejects(t.prepare());assert.equal(f.patches(),0);
});
test('mismatching initial replica declaration on a paused resource refuses before controller mutation',async()=>{
 const f=targetFixture({initialPaused:true});f.state.worker.spec.replicas=3;f.reconcile();const t=benchmarkTarget(f.config,f.io);await assert.rejects(t.prepare());assert.equal(f.patches(),0);
});
for(const fault of ['hpa-persists','pause-condition-missing'])test(fault+' cannot authorize Worker mutation from an annotation alone',async()=>{
 const f=targetFixture({fault}),t=benchmarkTarget(f.config,f.io);await assert.rejects(t.prepare());assert.equal(f.events.some(e=>e.type==='patch'&&e.kind==='worker'),false);
});
test('external replica change is preserved during cleanup; controller is not resumed over an unconfirmed Worker',async()=>{
 const f=targetFixture(),t=benchmarkTarget(f.config,f.io);await t.prepare();await t.scale(3);f.state.worker.spec.replicas=2;f.state.worker.metadata.resourceVersion='99';f.reconcile();
 const count=f.patches(),r=await t.restore();assert.equal(r.workerRestored,false);assert.equal(r.controllerRestored,false);assert.equal(f.state.worker.spec.replicas,2);assert.equal(f.patches(),count);assert.equal(f.state.controller.metadata.annotations[owner],f.config.runId);
});
for(const kind of ['worker','controller'])test('external '+kind+' spec change is never overwritten during restoration',async()=>{
 const f=targetFixture(),t=benchmarkTarget(f.config,f.io);await t.prepare();await t.scale(3);f.state[kind].spec.external='other actor';
 const count=f.patches(),r=await t.restore();assert.equal(r.controllerRestored,false);assert.equal(f.state[kind].spec.external,'other actor');assert.equal(f.patches(),count);
});
test('resourceVersion race rejects the scale once, without retry, and leaves recoverable original replicas',async()=>{
 const f=targetFixture({fault:'rv-race'}),t=benchmarkTarget(f.config,f.io);await t.prepare();await assert.rejects(t.scale(3));assert.equal(f.state.worker.spec.replicas,1);
 assert.equal(f.events.filter(e=>e.type==='patch'&&e.ops.some(x=>x.path==='/spec/replicas'&&x.value===3)).length,1);
 const r=await t.restore();assert.equal(r.controllerRestored,true);assert.equal(f.state.worker.spec.replicas,1);
});
for(const fault of ['scale-unknown-before','scale-unknown-after'])test(fault+' uses observed owned step for a distinct cleanup, never resends scale',async()=>{
 const f=targetFixture({fault}),t=benchmarkTarget(f.config,f.io);await t.prepare();await assert.rejects(t.scale(3));const r=await t.restore();assert.equal(r.controllerRestored,true);
 assert.equal(f.state.worker.spec.replicas,1);assert.equal(f.events.filter(e=>e.type==='patch'&&e.ops.some(x=>x.path==='/spec/replicas'&&x.value===3)).length,1);
});
test('unknown pause before application stays unconfirmed, not declared restored from one unchanged read',async()=>{
 const f=targetFixture({fault:'pause-unknown-before'}),t=benchmarkTarget(f.config,f.io);await assert.rejects(t.prepare());const r=await t.restore();assert.equal(r.controllerRestored,false);
 assert.equal(f.patches(),1);assert.equal(r.manualRecoveryMayBeRequired,true);
});
test('unknown pause after application can restore only after its exact owned marker is observed',async()=>{
 const f=targetFixture({fault:'pause-unknown-after'}),t=benchmarkTarget(f.config,f.io);await assert.rejects(t.prepare());const r=await t.restore();assert.equal(r.controllerRestored,true);
 assert.equal(f.patches(),2);assert.equal(Object.hasOwn(f.state.controller.metadata.annotations,owner),false);
});
test('terminating or foreign Pods cannot be counted as a ready Worker cohort',async()=>{
 const f=targetFixture(),t=benchmarkTarget(f.config,f.io);await t.prepare();await t.scale(1);
 f.state.pods.items[0].metadata.deletionTimestamp='2026-10-11T00:00:00Z';await assert.rejects(t.observeReady(1));delete f.state.pods.items[0].metadata.deletionTimestamp;
 f.state.pods.items[0].metadata.ownerReferences[0].uid='foreign';await assert.rejects(t.observeReady(1));
});
test('Pod container image or resource drift is not a stable measured target',async()=>{
 const f=targetFixture(),t=benchmarkTarget(f.config,f.io);await t.prepare();await t.scale(1);
 f.state.pods.items[0].status.containerStatuses[0].imageID='foreign@sha256:'+'b'.repeat(64);await assert.rejects(t.observeReady(1));
});
test('missing observedGeneration cannot count as an observed rollout',async()=>{
 const f=targetFixture({fault:'missing-observed-generation'}),t=benchmarkTarget(f.config,f.io);await assert.rejects(t.prepare());assert.equal(f.patches(),0);
});
test('prepare cannot be called twice and no scale is allowed before ownership or after restoration',async()=>{
 const f=targetFixture(),t=benchmarkTarget(f.config,f.io);await assert.rejects(t.scale(1));await t.prepare();await assert.rejects(t.prepare());await t.scale(1);await t.restore();await assert.rejects(t.scale(3));
});
test('original Pod image identity is checked before any controller or Worker write',async()=>{
 const f=targetFixture();f.state.pods.items[0].status.containerStatuses[0].imageID='foreign@sha256:'+'b'.repeat(64);const t=benchmarkTarget(f.config,f.io);await assert.rejects(t.prepare());assert.equal(f.patches(),0);
});
test('operator spec hash cannot authorize larger resources than the original comparison contract',async()=>{
 const f=targetFixture();f.state.worker.spec.template.spec.containers[0].resources.limits.cpu='9';f.config.workerSpecSHA256=benchmarkTargetHash('worker',f.state.worker.spec);f.reconcile();
 const t=benchmarkTarget(f.config,f.io);await assert.rejects(t.prepare());assert.equal(f.patches(),0);
});
