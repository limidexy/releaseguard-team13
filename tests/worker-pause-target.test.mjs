import test from 'node:test';
import assert from 'node:assert/strict';
import {workerPauseBoundary} from './fixtures/worker-pause-protocol.mjs';
import {runWorkerPause} from '../scripts/worker-pause-core.mjs';
import {benchmarkTargetHash} from '../scripts/cloud-benchmark-target.mjs';
for(const change of [p=>{p.containers[0].env=p.containers[0].env.filter(e=>e.name!=='RG_TRIAL_POD_UID');},p=>{delete p.containers[0].command;},p=>{p.containers[0].command=['node','dist/src/main.js'];},p=>{p.containers[0].securityContext.readOnlyRootFilesystem=false;},p=>{p.volumes[0].emptyDir.sizeLimit='1Gi';},p=>{p.securityContext.fsGroup=0;},p=>{p.hostPID=true;}])test('missingorweakenedfuturefixture isrefusedbeforecredentials,controllerwritesorsignals',async()=>{
 const b=workerPauseBoundary();change(b.f.state.worker.spec.template.spec);b.f.state.pods.items=[];b.reconcile();b.c.target.workerSpecSHA256=benchmarkTargetHash('worker',b.f.state.worker.spec);const r=await runWorkerPause(b.c,b.io);
 assert.equal(r.passed,false);assert.equal(b.calls.length,0);assert.equal(b.vm.signals.length,0);assert.equal(b.f.events.some(e=>e.type==='patch'),false);
});
test('allcontrollerwrites haveUID,resourceVersion,whole-spec andownedannotationguards; resourceandreplicawritesareabsent',async()=>{
 const b=workerPauseBoundary();assert.equal((await runWorkerPause(b.c,b.io)).passed,true);for(const e of b.f.events.filter(e=>e.type==='patch')){
  for(const path of ['/metadata/uid','/metadata/resourceVersion','/spec'])assert.ok(e.ops.some(p=>p.op==='test'&&p.path===path));assert.equal(e.ops.some(p=>p.op!=='test'&&p.path.startsWith('/spec')),false);
 }
});
test('aconcurrentforeigncontrollerowner ispreservedandnotforce-restored',async()=>{
 const b=workerPauseBoundary(),patch=b.targetIO.patch;let changed=false;b.targetIO.patch=async(kind,ops,clean)=>{if(!changed){changed=true;b.f.state.controller.metadata.resourceVersion='999';b.f.state.controller.metadata.annotations['releaseguard.io/worker-pause']='foreign';}return patch(kind,ops,clean);};
 const r=await runWorkerPause(b.c,b.io);assert.equal(r.passed,false);assert.equal(r.restoration.originalStateRestored,false);assert.equal(b.f.state.controller.metadata.annotations['releaseguard.io/worker-pause'],'foreign');assert.equal(b.vm.signals.length,0);
});
test('terminalpersistencefailure cannot returnpassedtrue',async()=>{
 const b=workerPauseBoundary();b.io.terminal=async()=>{throw Error('Synthetic disk failure');};const r=await runWorkerPause(b.c,b.io);assert.equal(r.passed,false);assert.equal(r.evidenceState,'terminal_persistence_unknown');
});
test('cancellationafterterminalwrite preservesearlierrawrecord butreturnedglobaloutcome isunconfirmed',async()=>{
 const b=workerPauseBoundary(),put=b.io.terminal;b.io.terminal=async r=>{await put(r);b.controller.abort();};const r=await runWorkerPause(b.c,b.io);assert.equal(r.passed,false);assert.equal(r.evidenceState,'completion_deadline_or_cancellation');assert.equal(b.records.get('terminal.json').passed,true);
});
