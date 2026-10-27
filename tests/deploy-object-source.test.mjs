import test from 'node:test';import assert from 'node:assert/strict';
import {simulateDeployment} from './fixtures/deploy-source-harness.mjs';
import {objectFixture,atomicObjectAPI,runId,executeObjectPlan} from './fixtures/deploy-object-api.mjs';
const apply=(api,plan)=>executeObjectPlan(api,plan,observed);
import {captureDeploymentObject as capture,deploymentObjectRef as ref,planDeploymentClaim as claim,planDeploymentUpdate as update,planDeploymentRestore as restore,verifyDeploymentChange as observed} from '../scripts/deploy-object-core.mjs';
test('frozen original overwrites a foreign UID during recovery; replacement primitive refuses before producing a restoration patch',async()=>{
 const original=await simulateDeployment({failCandidateSmoke:true,foreignDuringFailure:true});assert.ok(original.foreignOverwrites>0);assert.equal(original.report.recoveredPrevious,true);assert.equal(original.simulation.actualDeployment,0);
 const r=ref('Deployment','evaluation'),api=atomicObjectAPI(objectFixture('Deployment','evaluation')),baseline=capture(r,api.read()),take=claim(baseline,runId),owned=apply(api,take);
 api.mutate(d=>{d.metadata.uid='synthetic-replacement-uid';});const before=api.read(),calls=api.writes.length;assert.throws(()=>restore(baseline,owned,capture(r,api.read()),runId));assert.deepEqual(api.read(),before);assert.equal(api.writes.length,calls);
});
test('original recoveredPrevious can leave applied non-image configuration; replacement primitive restores the entire selected spec',async()=>{
 const original=await simulateDeployment({failCandidateSmoke:true});assert.equal(original.report.recoveredPrevious,true);assert.equal(original.deployments.get('evaluation').spec.template.spec.containers[0].env[0].value,'candidate');
 const r=ref('Deployment','evaluation'),api=atomicObjectAPI(objectFixture('Deployment','evaluation')),baseline=capture(r,api.read()),take=claim(baseline,runId),owned=apply(api,take),desired=api.read();
 desired.spec.template.spec.containers[0].image='registry.example.invalid/rg@sha256:'+'b'.repeat(64);desired.spec.template.spec.containers[0].env[0].value='candidate';desired.spec.template.spec.containers[0].resources.requests.cpu='150m';
 const change=update(owned,desired,runId),after=apply(api,change),back=restore(baseline,after,capture(r,api.read()),runId),done=apply(api,back);
 assert.deepEqual(done.fields,baseline.fields);assert.equal(api.read().spec.template.spec.containers[0].env[0].value,'before');
});
test('frozen original full candidate/previous/candidate path remains separately reproducible; no full replacement consumer is claimed here',async()=>{
 const original=await simulateDeployment({env:{RG_PROVE_ROLLBACK:'true'}});assert.equal(original.report.passed,true);assert.equal(original.smokes,3);assert.equal(original.applies,2);assert.deepEqual(original.report.stages.map(x=>x.name),['candidate','previous','restored-candidate']);assert.equal(original.simulation.actualCloud,0);
});
