import test from 'node:test';import assert from 'node:assert/strict';
import {runDeploy,validateDeploy} from '../scripts/deploy-core.mjs';
import {deploymentOwnerAnnotation as marker,captureDeploymentObject, deploymentObjectRef} from '../scripts/deploy-object-core.mjs';
import {deployFixture} from './fixtures/deploy-lifecycle.mjs';
import {comparisonFiles} from '../scripts/comparison-files.mjs';
import fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const fields=d=>captureDeploymentObject(deploymentObjectRef(d.kind,d.metadata.name),d).fields;
function quotaStore(t){
 const root=fs.mkdtempSync(join(fs.realpathSync(tmpdir()),'rg-deploy-quota-'));
 t.after(()=>{assert.match(root,/[/\\]rg-deploy-quota-[^/\\]+$/);fs.rmSync(root,{recursive:true});});
 return comparisonFiles(root,'f7df9b5c-08e9-4d1d-9c73-7cbd99bcb50a','cloud-deploy');
}
test('bounded recovery receipts remain usable after the normal evidence allowance is exhausted',{skip:process.platform==='win32'},async t=>{
 const s=quotaStore(t);await s.reserve({synthetic:true});
 await assert.rejects(s.put('normal-padding.bin',Buffer.alloc(64*1024*1024,32)));
 await assert.rejects(s.json('normal-after-limit.json',{mustNotContinue:true}));
 for(const name of ['cleanup-operation-0001-intent.json','cleanup-operation-0001-observed.json','cleanup-native-000001-intent.json','cleanup-native-000001-stdout.bin','cleanup-request-000001.json','cleanup-unknown-service-support.json','smoke-failure-recovery-started.json','smoke-failure-recovery-0001-intent.json','smoke-failure-recovery-0001-observed.json','smoke-failure-recovery-0001-result.json','smoke-failure-recovery-job.json','smoke-failure-recovery-terminal.json'])
  await s.json(name,{syntheticRecovery:true});
 await assert.rejects(s.json('normal-still-blocked.json',{mustNotContinue:true}));
 await assert.rejects(s.put('cleanup-native-000002-stdout.bin',Buffer.alloc(16*1024*1024,32)));
 await assert.rejects(s.json('cleanup-operation-0002-intent.json',{mustNotContinue:true}));
 await s.json('terminal.json',{passed:false});
});
test('normal evidence exhaustion does not disable owned restoration before its first cleanup intent',{skip:process.platform==='win32'},async t=>{
 const f=deployFixture({failSmoke:['candidate']}),store=quotaStore(t),reserve=f.io.reserve,record=f.io.json,smoke=f.io.smoke;
 f.io.reserve=async c=>{await reserve(c);await store.reserve({synthetic:true});};
 f.io.json=async(n,v)=>{await store.json(n,v);await record(n,v);};
 f.io.smoke=async(label,selected)=>{const r=await smoke(label,selected);if(label==='candidate')await assert.rejects(store.put('normal-padding.bin',Buffer.alloc(64*1024*1024,32)));return r;};
 const r=await runDeploy(f.c,f.io);
 assert.equal(r.passed,false);assert.equal(r.recoveredPrevious,true);
 for(const[k,a]of f.api)assert.deepEqual(fields(a.read()),fields(f.initial.get(k)));
 assert.ok([...f.files.keys()].some(n=>/^cleanup-operation-\d{4}-intent\.json$/.test(n)));
 assert.equal(JSON.parse(fs.readFileSync(join(store.directory,'terminal.json'))).passed,false);
});
test('complete candidate changes all13 objects, six roles and final source/image, releases markers',async()=>{
 const f=deployFixture(),r=await runDeploy(f.c,f.io);assert.equal(r.passed,true);assert.equal(r.objects.length,13);assert.equal(r.stages.length,1);assert.equal(f.events.filter(e=>e.kind==='smoke').length,1);
 for(const [k,a]of f.api){const d=a.read();assert.equal(d.metadata.annotations?.[marker],undefined);if(k.startsWith('Deployment/')){assert.equal(d.spec.template.spec.containers[0].image,f.c.image);assert.equal(d.spec.template.spec.containers[0].env[0].value,'candidate');assert.equal(d.metadata.annotations['releaseguard/source'],f.c.sourceCommit);}}
 assert.equal(r.perObjectNotFleetAtomic,true);assert.equal(r.actualAPIServerCompatibilityProven,false);
});
test('full previous/candidate cycle uses Worker identity, not first-role source',async()=>{
 const f=deployFixture();f.c.proveRollback=true;f.api.get('Deployment/registry').mutate(d=>d.metadata.annotations['releaseguard/source']='c'.repeat(40));const r=await runDeploy(f.c,f.io);assert.equal(r.passed,true);assert.equal(r.rollbackTested,true);assert.deepEqual(r.stages.map(s=>s.name),['candidate','previous','restored-candidate']);assert.equal(f.events.find(e=>e.kind==='smoke'&&e.arg.label==='previous').arg.selected.source,'a'.repeat(40));
});
test('candidate semantic smoke failure restores full previous fields and keeps failed report',async()=>{
 const f=deployFixture({failSmoke:['candidate']}),r=await runDeploy(f.c,f.io);assert.equal(r.passed,false);assert.equal(r.recoveredPrevious,true);for(const[k,a]of f.api)assert.deepEqual(fields(a.read()),fields(f.initial.get(k)));assert.equal(f.files.get('terminal.json').passed,false);
});
test('missing auxiliary creation is included, deleted for previous cycle, and recreated for candidate',async()=>{
 const f=deployFixture({missing:['Service/support','ConfigMap/rg-config']});f.c.proveRollback=true;const r=await runDeploy(f.c,f.io);assert.equal(r.passed,true);assert.equal(f.events.filter(e=>e.kind==='create').length,4);assert.equal(f.events.filter(e=>e.kind==='delete').length,2);
});
test('missing auxiliary resources are deleted after failed candidate; existing resources remain',async()=>{
 const f=deployFixture({missing:['Service/support','ConfigMap/rg-config'],failSmoke:['candidate']}),r=await runDeploy(f.c,f.io);assert.equal(r.recoveredPrevious,true);assert.equal(f.api.size,11);assert.ok(!f.api.has('Service/support'));assert.ok(!f.api.has('ConfigMap/rg-config'));
});
for(const field of ['allowDeployment','isolatedAdminWindow'])test('explicit '+field+' required; environment cannot activate',async()=>{const f=deployFixture();f.c[field]=false;assert.equal((await runDeploy(f.c,f.io)).state,'refused_before_reservation');assert.equal(f.events.length,0);});
test('second identical run never overwrites first terminal or started receipt',async()=>{const f=deployFixture();await runDeploy(f.c,f.io);const original=structuredClone(f.files.get('terminal.json')),count=f.events.length;const r=await runDeploy(f.c,f.io);assert.equal(r.passed,false);assert.deepEqual(f.files.get('terminal.json'),original);assert.equal(f.events.length,count);});
test('foreign UID during recovery is retained without overwriting replacement',async()=>{
 const f=deployFixture({after(kind,arg,result,{api}){if(kind==='smoke'&&arg.label==='candidate')api.get('Deployment/worker').mutate(d=>{d.metadata.uid='foreign-worker';d.spec.template.spec.containers[0].env=[{name:'FOREIGN',value:'keep'}];});},failSmoke:['candidate']});
 const r=await runDeploy(f.c,f.io);assert.equal(r.recoveredPrevious,false);assert.equal(f.api.get('Deployment/worker').read().metadata.uid,'foreign-worker');assert.equal(f.api.get('Deployment/worker').read().spec.template.spec.containers[0].env[0].name,'FOREIGN');
});
test('same values with foreign field ownership prohibit recovery',async()=>{
 const f=deployFixture({after(kind,arg,result,{api}){if(kind==='smoke'&&arg.label==='candidate')api.get('Deployment/worker').mutate(d=>d.metadata.managedFields.push({manager:'foreign',operation:'Update',apiVersion:'apps/v1',fieldsType:'FieldsV1',fieldsV1:{'f:spec':{}}}));},failSmoke:['candidate']});const r=await runDeploy(f.c,f.io);assert.equal(r.recoveredPrevious,false);assert.ok(f.api.get('Deployment/worker').read().metadata.managedFields.some(x=>x.manager==='foreign'));
});
test('accepted patch with lost response is never resent or recovered from guessed state',async()=>{
  let lost=false;const f=deployFixture({after(kind,arg){if(kind==='patch'&&!lost){lost=true;throw Error('response lost');}}});const r=await runDeploy(f.c,f.io);assert.equal(r.passed,false);assert.equal(f.events.filter(e=>e.kind==='patch').length,1);assert.equal(r.objects[0].unknown,true);
  const retained=f.files.get('cleanup-unknown-configmap-rg-config.json');assert.ok(retained);assert.equal(retained.ownershipNotProven,true);assert.equal(retained.noResend,true);assert.deepEqual(retained.ref,r.objects[0].ref);
});
test('accepted auxiliary create with lost response remains unknown and is not deleted',async()=>{
 let lost=false;const f=deployFixture({missing:['ConfigMap/rg-config'],after(kind){if(kind==='create'&&!lost){lost=true;throw Error('create response lost');}}});const r=await runDeploy(f.c,f.io);assert.equal(r.passed,false);assert.equal(r.recoveredPrevious,false);assert.equal(f.events.filter(e=>e.kind==='create').length,1);assert.ok(f.api.has('ConfigMap/rg-config'));assert.equal(f.events.filter(e=>e.kind==='delete').length,0);
});
test('abort after owned update stops candidate and uses only bounded recovery',async()=>{
 let stopped=false;const f=deployFixture({after(kind,arg,result,{controller}){if(kind==='patch'&&arg.operation==='update'&&!stopped){stopped=true;controller.abort();}}});const r=await runDeploy(f.c,f.io);assert.equal(r.passed,false);assert.equal(f.events.filter(e=>e.kind==='smoke'&&e.arg.label==='candidate').length,0);assert.ok(r.objects.some(x=>x.unknown));
});
test('wrong patch dry-run fields stop before real mutation',async()=>{const f=deployFixture({after(kind,arg,result){if(kind==='previewPatch')result.metadata.annotations['foreign']='bad';}}),r=await runDeploy(f.c,f.io);assert.equal(r.passed,false);assert.equal(f.events.filter(e=>e.kind==='patch').length,0);});
test('malformed baseline readiness prevents all mutations',async()=>{const f=deployFixture({after(kind,arg,result){if(kind==='get'&&arg.kind==='Deployment')delete result.status.observedGeneration;}}),r=await runDeploy(f.c,f.io);assert.equal(r.passed,false);assert.equal(f.events.filter(e=>e.kind==='patch').length,0);});
test('deadline after response preserves unknown, never changes timestamps or resends',async()=>{const f=deployFixture({after(kind,arg,result,{advance}){if(kind==='patch')advance(540000);}}),r=await runDeploy(f.c,f.io);assert.equal(r.passed,false);assert.equal(f.events.filter(e=>e.kind==='patch').length,1);assert.ok(r.objects.some(x=>x.unknown));});
test('unexpected namespace/Secret/duplicate/missing manifest scope is rejected before mutation',async()=>{for(const change of [d=>d.pop(),d=>d.push(d[0]),d=>{d[0].kind='Secret';},d=>{d[0].metadata.namespace='other';}]){const f=deployFixture();change(f.desired);const r=await runDeploy(f.c,f.io);assert.equal(r.passed,false);assert.equal(f.events.filter(e=>e.kind==='patch').length,0);}});
test('recovery interruption is retained and never reported as successful restore',async()=>{const f=deployFixture({failSmoke:['candidate'],before(kind,arg,{cleanup}){if(kind==='patch'&&arg.operation==='restore')cleanup.abort();}}),r=await runDeploy(f.c,f.io);assert.equal(r.passed,false);assert.equal(r.recoveredPrevious,false);});
test('configuration is isolated from mutation by returning a copy',()=>{const f=deployFixture(),v=validateDeploy(f.c);v.cloud.namespace='foreign';assert.equal(f.c.cloud.namespace,'releaseguard');});
test('last baseline failure prevents early mutation across the entire manifest scope',async()=>{const f=deployFixture({after(kind,arg,value){if(kind==='get'&&arg.kind==='Service'&&arg.name==='gateway')value.metadata.annotations[marker]='foreign-run';}}),r=await runDeploy(f.c,f.io);assert.equal(r.passed,false);assert.equal(f.events.filter(e=>['patch','create','delete'].includes(e.kind)).length,0);});
test('autoscaler change between owned read and SSA preview is never forced',async()=>{let changed=false;const f=deployFixture({before(kind,arg,{api}){if(kind==='previewApply'&&arg.kind==='Deployment'&&arg.metadata.name==='worker'&&!changed){changed=true;api.get('Deployment/worker').mutate(d=>d.spec.replicas=3);}}}),r=await runDeploy(f.c,f.io);assert.equal(r.passed,false);assert.equal(f.api.get('Deployment/worker').read().spec.replicas,3);assert.equal(r.recoveredPrevious,false);});
test('unknown DELETE after server deletion is observed absent but never resent or claimed recovered',async()=>{let lost=false;const f=deployFixture({missing:['ConfigMap/rg-config'],failSmoke:['candidate'],after(kind){if(kind==='delete'&&!lost){lost=true;throw Error('lost delete response');}}}),r=await runDeploy(f.c,f.io);assert.equal(r.passed,false);assert.equal(r.recoveredPrevious,false);assert.equal(f.api.has('ConfigMap/rg-config'),false);assert.equal(f.events.filter(e=>e.kind==='delete').length,1);assert.ok(r.objects.find(x=>x.ref.kind==='ConfigMap').unknown);});
test('runtime drift after final candidate validation prevents success and restores owned resources',async()=>{const f=deployFixture();let count=0;f.io.verifyRuntime=async()=>{if(++count===2)throw Error('source changed');};const r=await runDeploy(f.c,f.io);assert.equal(r.passed,false);assert.equal(r.recoveredPrevious,true);});
test('partial marker release is not a fleet rollback or successful deployment',async()=>{let releases=0;const f=deployFixture({before(kind,arg){if(kind==='patch'&&arg.operation==='release'&&++releases===2)throw Error('lost release');}}),r=await runDeploy(f.c,f.io);assert.equal(r.passed,false);assert.equal(r.recoveredPrevious,false);assert.ok(r.objects.some(x=>x.recovery==='ownership_released_not_restored'));});
test('terminal persistence failure cannot promote an already released fleet to success',async()=>{const f=deployFixture(),write=f.io.json;f.io.json=async(n,v)=>{if(n==='terminal.json')throw Error('disk sync unknown');return write(n,v);};const r=await runDeploy(f.c,f.io);assert.equal(r.passed,false);assert.equal(r.evidenceState,'terminal_persistence_unknown');});
test('creation default mismatch leaves ambiguous resource in place',async()=>{const f=deployFixture({missing:['Service/support'],after(kind,arg,result){if(kind==='create')result.spec.selector={app:'foreign'};}}),r=await runDeploy(f.c,f.io);assert.equal(r.passed,false);assert.ok(f.api.has('Service/support'));assert.equal(f.events.filter(e=>e.kind==='delete').length,0);});

// Handoff repair: replay only typed Deployment observations. No cloud commands.
for(const [label,change] of [
 ['old replicas still present',d=>{d.status.replicas=d.spec.replicas+1;}],
 ['missing total replica count',d=>{delete d.status.replicas;}],
 ['surplus updated replicas',d=>{d.status.replicas=d.spec.replicas+1;d.status.updatedReplicas=d.spec.replicas+1;d.status.readyReplicas=d.spec.replicas+1;d.status.availableReplicas=d.spec.replicas+1;}],
 ['reported rollout failure',d=>{d.status.conditions=[{type:'Progressing',status:'False',reason:'ProgressDeadlineExceeded'}];}],
 ['reported terminating replicas',d=>{d.status.terminatingReplicas=1;}],
])test('resume regression: '+label+' cannot pass deployment preflight',async()=>{
 const f=deployFixture({after(kind,arg,d){if(kind==='get'&&arg.kind==='Deployment')change(d);}});
 const r=await runDeploy(f.c,f.io);
 assert.equal(r.passed,false);
 assert.equal(f.events.filter(e=>['patch','create','delete','smoke'].includes(e.kind)).length,0);
});

test('resume regression: candidate smoke waits until old replicas have drained',async()=>{
 let candidateReads=0,readsAtSmoke=0;
 const f=deployFixture({after(kind,arg,d){
  if(kind==='get'&&arg.kind==='Deployment'&&arg.name==='registry'&&d.spec.template.spec.containers[0].env[0].value==='candidate'){
   candidateReads++;
   d.status.replicas=d.spec.replicas+(candidateReads<=2?1:0);
  }
  if(kind==='smoke'&&arg.label==='candidate')readsAtSmoke=candidateReads;
 }});
 const r=await runDeploy(f.c,f.io);
 assert.equal(r.passed,true);
 assert.ok(readsAtSmoke>=3,'must observe rollout completion before smoke, not only minimum ready replicas');
});
