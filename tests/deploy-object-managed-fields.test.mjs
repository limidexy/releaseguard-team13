import test from 'node:test';import assert from 'node:assert/strict';
import {objectFixture,atomicObjectAPI,runId,executeObjectPlan} from './fixtures/deploy-object-api.mjs';
const apply=(api,plan)=>executeObjectPlan(api,plan,observed);
import {captureDeploymentObject as capture,deploymentObjectRef as ref,planDeploymentClaim as claim,planDeploymentRestore as restore,planDeploymentUpdate as update,verifyDeploymentChange as observed} from '../scripts/deploy-object-core.mjs';
test('foreign field ownership transfer with unchanged values prevents automatic recovery',()=>{
 const r=ref('Deployment','worker'),api=atomicObjectAPI(objectFixture()),baseline=capture(r,api.read()),take=claim(baseline,runId),owned=apply(api,take);
 api.mutate(d=>{d.metadata.managedFields=[{manager:'synthetic-other-tool',operation:'Apply',apiVersion:'apps/v1',fieldsType:'FieldsV1',fieldsV1:{'f:spec':{'f:template':{}}}}];});
 const before=api.read(),writes=api.writes.length;assert.throws(()=>restore(baseline,owned,capture(r,api.read()),runId));assert.deepEqual(api.read(),before);assert.equal(api.writes.length,writes);
});
function setup(){
 const r=ref('Deployment','worker'),api=atomicObjectAPI(objectFixture()),baseline=capture(r,api.read()),take=claim(baseline,runId),owned=apply(api,take);return {r,api,baseline,take,owned};
}
test('the exact JSON-patch preview is mandatory, plan-bound and checked separately from the actual response',()=>{
 const x=setup(),d=x.api.read();d.spec.replicas=2;const p=update(x.owned,d,runId),preview={planChecksum:p.checksum,observation:x.api.preview(p.patch)},actual=x.api.patch(p.patch);
 assert.throws(()=>observed(p,actual));assert.throws(()=>observed(p,actual,{...preview,planChecksum:'0'.repeat(64)}));
 const wrong=structuredClone(preview);wrong.observation.spec.replicas=7;assert.throws(()=>observed(p,actual,wrong));
 const missing=structuredClone(actual);delete missing.metadata.managedFields;assert.throws(()=>observed(p,missing,preview));
 assert.equal(observed(p,actual,preview).fields.spec.value.replicas,2);assert.notEqual(preview.observation.metadata.managedFields[0].time,actual.metadata.managedFields[0].time);
});
test('unexpected actual managed-field ownership cannot be accepted from matching writable values alone',()=>{
 const x=setup(),d=x.api.read();d.spec.replicas=2;const p=update(x.owned,d,runId),preview={planChecksum:p.checksum,observation:x.api.preview(p.patch)},actual=x.api.patch(p.patch);
 actual.metadata.managedFields.push({manager:'synthetic-foreign',operation:'Apply',apiVersion:'apps/v1',fieldsType:'FieldsV1',fieldsV1:{'f:spec':{}}});assert.throws(()=>observed(p,actual,preview));
});
test('raw managedFields is a conditional patch guard, so even a same-RV ownership race cannot partially restore',()=>{
 const x=setup(),back=restore(x.baseline,x.owned,capture(x.r,x.api.read()),runId);
 x.api.mutate(d=>{d.metadata.managedFields.push({manager:'synthetic-foreign',operation:'Apply',apiVersion:'apps/v1',fieldsType:'FieldsV1',fieldsV1:{'f:spec':{}}});},{bump:false});
 const before=x.api.read();assert.throws(()=>x.api.patch(back.patch));assert.deepEqual(x.api.read(),before);
});
test('a pure status field-manager entry may change while selected configuration recovery remains guarded',()=>{
 const x=setup();x.api.mutate(d=>{d.status.readyReplicas=0;d.metadata.managedFields.push({manager:'synthetic-status-controller',operation:'Update',apiVersion:'apps/v1',subresource:'status',fieldsType:'FieldsV1',fieldsV1:{'f:status':{'f:readyReplicas':{}}}});});
 const back=restore(x.baseline,x.owned,capture(x.r,x.api.read()),runId),done=apply(x.api,back);assert.deepEqual(done.fields,x.baseline.fields);assert.equal(x.api.read().status.readyReplicas,0);
});
test('a status-labelled entry that also claims spec fields is preserved as foreign interference',()=>{
 const x=setup();x.api.mutate(d=>{d.metadata.managedFields.push({manager:'synthetic-not-just-status',operation:'Update',apiVersion:'apps/v1',subresource:'status',fieldsType:'FieldsV1',fieldsV1:{'f:status':{},'f:spec':{}}});});assert.throws(()=>restore(x.baseline,x.owned,capture(x.r,x.api.read()),runId));
});
test('timestamp and entry-order changes do not invent an ownership transfer; raw receipts still differ',()=>{
 const x=setup();x.api.mutate(d=>{d.metadata.managedFields[0].time='2000-01-01T00:00:09Z';d.metadata.managedFields.reverse();});const latest=capture(x.r,x.api.read());assert.notEqual(latest.observationSHA256,x.owned.observationSHA256);assert.ok(restore(x.baseline,x.owned,latest,runId));
});
test('SSA hypothetical ownership is not mistaken for the ownership effects of the actual conditional JSON patch',()=>{
 const x=setup(),desired=x.api.read();desired.spec.replicas=2;desired.metadata.managedFields=[{manager:'synthetic-ssa-preview',operation:'Apply',apiVersion:'apps/v1',fieldsType:'FieldsV1',fieldsV1:{'f:spec':{}}}];
 const raw=JSON.stringify(desired),p=update(x.owned,desired,runId),done=apply(x.api,p);assert.equal(JSON.stringify(desired),raw);assert.equal(done.fields.spec.value.replicas,2);assert.equal(x.api.read().metadata.managedFields.some(e=>e.manager==='synthetic-ssa-preview'),false);
});
test('configuration restoration does not rewrite server-managed field-ownership history',()=>{
 const x=setup(),back=restore(x.baseline,x.owned,capture(x.r,x.api.read()),runId),done=apply(x.api,back);assert.deepEqual(done.fields,x.baseline.fields);assert.notDeepEqual(done.context.managedFields,x.baseline.context.managedFields);
 assert.equal(back.patch.filter(p=>p.op!=='test').some(p=>p.path==='/metadata/managedFields'),false);
});
