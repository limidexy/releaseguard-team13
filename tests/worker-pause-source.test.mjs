// Frozen source parity and corrected safety boundaries. All source execution
// uses in-memory boundaries; none of these are cloud/OS-fault measurements.
import test from 'node:test';
import assert from 'node:assert/strict';
import {simulateWorkerPause} from './fixtures/worker-pause-source-harness.mjs';
import {workerPauseBoundary} from './fixtures/worker-pause-protocol.mjs';
import {runWorkerPause} from '../scripts/worker-pause-core.mjs';
test('both originalandnew complete500ten-case sourceprotocols preserve1002API,2authandonefault',async()=>{
 const old=await simulateWorkerPause(),b=workerPauseBoundary({postcondition:'paused-one-for-cd'}),r=await runWorkerPause(b.c,b.io);assert.equal(old.report.passed,true);assert.equal(r.passed,true);
 assert.equal(old.report.requested,r.requested);assert.equal(old.report.completed,r.observedVerified);assert.equal(old.calls.length,r.requests);assert.equal(old.auth,b.auth.filter(x=>x==='authorize').length);
 assert.equal(old.stopCount,b.vm.signals.filter(s=>s.signal==='SIGSTOP').length);assert.equal(old.resumeCount,b.vm.signals.filter(s=>s.signal==='SIGCONT').length);assert.equal(r.restoration.pausedOneHandoff,true);
 assert.equal(old.report.cloud,true);assert.equal(old.actualOSSignals,0);assert.equal(r.automaticScalingBenefitProven,false);
});
test('originalunknownPOST continuesall500; replacement stopswithin8alreadyinflight',async()=>{
 const old=await simulateWorkerPause({fault:'unknown-post'}),b=workerPauseBoundary({disconnectPost:1}),r=await runWorkerPause(b.c,b.io);assert.equal(old.postCount,500);assert.equal(r.passed,false);assert.ok(b.calls.filter(c=>c.route.endsWith('/jobs')).length<=8);assert.equal(r.denominator,500);
});
test('originalduplicatejobrows canpass; replacement demandsuniqueassociatedidentities',async()=>{
 const old=await simulateWorkerPause({fault:'duplicate-job'});assert.equal(old.report.passed,true);assert.equal(new Set(old.report.jobs.map(j=>j.id)).size,1);
 let first;const b=workerPauseBoundary({mutateJob:j=>{first??=j.id;j.id=first;}}),r=await runWorkerPause(b.c,b.io);assert.equal(r.passed,false);assert.ok(r.observedVerified<500);
});
test('originalforeignHPA authorizesfaultandjobs; replacement refusesbeforeanyAPIorSTOP',async()=>{
 const old=await simulateWorkerPause({fault:'foreign-hpa'}),b=workerPauseBoundary({foreignHPA:true}),r=await runWorkerPause(b.c,b.io);assert.equal(old.report.passed,true);assert.equal(r.passed,false);assert.equal(b.auth.length,0);assert.equal(b.vm.signals.length,0);
});
test('originalPodname reusecanCONTforeignUID; actualnewprogram insideVMrejectsforeignUIDbeforeSTOP',async()=>{
 const old=await simulateWorkerPause({fault:'pod-name-reuse'});assert.equal(old.externalChange,true);assert.ok(old.trace.some(t=>t.type==='resume'&&t.targetUID==='FOREIGN_REUSED_POD_UID'));
 const b=workerPauseBoundary({foreignPod:true}),r=await runWorkerPause(b.c,b.io);assert.equal(r.passed,false);assert.equal(b.vm.signals.length,0);
});
test('originalunknownCONTisresent; newagentonlyattemptsoneCONTandkeepsfailedstate',async()=>{
 const old=await simulateWorkerPause({fault:'unknown-resume-after'});assert.equal(old.resumeCount,2);const b=workerPauseBoundary({unknownCONT:true}),r=await runWorkerPause(b.c,b.io);assert.equal(r.passed,false);assert.equal(b.vm.signals.filter(s=>s.signal==='SIGCONT').length,1);
});
test('originalcleanupfailure keepspassedtrue withexit1; replacementglobalreportfails',async()=>{
 const old=await simulateWorkerPause({fault:'cleanup-failure'});assert.equal(old.report.passed,true);assert.equal(old.exitCode,1);const b=workerPauseBoundary({cleanupFailure:true}),r=await runWorkerPause(b.c,b.io);assert.equal(r.passed,false);assert.equal(r.observedVerified,500);
});
