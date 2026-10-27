// Original source and replacement run under controlled boundaries; none of
// these assertions claim actual cloud KEDA control, billing or scaling benefit.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {autoscaleSource,autoscaleFixtures} from './fixtures/cloud-autoscale-source-pr1.mjs';
import {simulateFrozenAutoscale} from './fixtures/cloud-autoscale-source-harness.mjs';
import {autoscaleBoundary} from './fixtures/cloud-autoscale-protocol.mjs';
import {runControlledBacklog} from '../scripts/cloud-autoscale-core.mjs';
test('originalsource andten-case95fixture remain frozen andbothfull700protocols execute',async()=>{
 assert.equal(createHash('sha256').update(autoscaleSource).digest('hex'),'ac436fa21f4e5b1561de3352f83e78276b583574493c7eaed1dd00266ab2fe1f');
 const old=await simulateFrozenAutoscale(),b=autoscaleBoundary({postcondition:'paused-one-for-cd'}),r=await runControlledBacklog(b.c,b.io);
 assert.equal(old.report.passed,true);assert.equal(r.passed,true);assert.equal(old.report.requested,r.requested);assert.equal(old.report.completed,r.observedVerified);
 assert.equal(old.calls.length,r.requests);assert.equal(old.auth,b.auth.filter(x=>x==='authorize').length);assert.equal(old.report.metricWarmup.elapsedMs,r.preparation.metricWarmupMs);
 assert.deepEqual(autoscaleFixtures,JSON.parse((await b.io.fixture()).bytes));assert.equal(old.state.annotations['autoscaling.keda.sh/paused-replicas'],'1');assert.equal(r.restoration.pausedOneHandoff,true);
});
test('oldunknownPOST continues700sends; fullreplacement stopsnewdispatch andkeepsrawunknowns',async()=>{
 const old=await simulateFrozenAutoscale({fault:'unknown-after-accepted'}),b=autoscaleBoundary({disconnectPost:1}),r=await runControlledBacklog(b.c,b.io);
 assert.equal(old.postCount,700);assert.equal(r.passed,false);assert.ok(b.calls.filter(c=>c.route.endsWith('/jobs')).length<=8);assert.equal(r.denominator,700);
});
test('oldduplicate rows canpass; replacement requires returnedidentity match eachuniqueacceptedjob',async()=>{
 const old=await simulateFrozenAutoscale({fault:'duplicate-job-response'});assert.equal(old.report.passed,true);assert.equal(new Set(old.report.jobs.map(j=>j.id)).size,1);
 let first;const b=autoscaleBoundary({mutateJob:j=>{first??=j.id;j.id=first;}}),r=await runControlledBacklog(b.c,b.io);assert.equal(r.passed,false);assert.ok(r.observedVerified<700);
});
test('oldforeignmetric canpass; replacement binds actualrequestedmetric,controller andnamespace beforejobs',async()=>{
 const old=await simulateFrozenAutoscale({fault:'foreign-metric'});assert.equal(old.report.passed,true);const b=autoscaleBoundary({foreignMetric:true}),r=await runControlledBacklog(b.c,b.io);
 assert.equal(r.passed,false);assert.equal(b.calls.some(c=>c.route.endsWith('/jobs')),false);
});
test('oldconcurrentreplica2 isoverwritten; replacement preservesit withoutaCDhandoffclaim',async()=>{
 const old=await simulateFrozenAutoscale({fault:'concurrent-replica-change'});assert.equal(old.externalChange,true);assert.equal(old.state.replicas,1);
 const b=autoscaleBoundary({externalReplica:true}),r=await runControlledBacklog(b.c,b.io);assert.equal(r.passed,false);assert.equal(b.f.state.worker.spec.replicas,2);assert.equal(r.restoration.pausedOneHandoff,false);
});
test('oldcleanupfailure preserves passedtrue andexit1; newglobalreport isfailed andoriginalrecordsareseparate',async()=>{
 const old=await simulateFrozenAutoscale({fault:'cleanup-command-failure'});assert.equal(old.report.passed,true);assert.equal(old.exitCode,1);
 const b=autoscaleBoundary({cleanupFailure:true}),r=await runControlledBacklog(b.c,b.io);assert.equal(r.passed,false);assert.equal(b.records.get('terminal.json').passed,false);assert.equal(r.observedVerified,700);
});
