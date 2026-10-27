import test from 'node:test';
import assert from 'node:assert/strict';
import {runWorkerPause,validateWorkerPause} from '../scripts/worker-pause-core.mjs';
import {workerPauseBoundary} from './fixtures/worker-pause-protocol.mjs';
const run=async options=>{const b=workerPauseBoundary(options),r=await runWorkerPause(b.c,b.io);return {b,r};};
test('complete500ten-case protocol has1002APIrequests,2auth,oneSTOP/CONT,original3then1andraw17000ms',async()=>{
 const {b,r}=await run();assert.equal(r.passed,true,JSON.stringify(r.errors));assert.equal(r.requests,1002);assert.equal(r.observedVerified,500);assert.equal(r.uniqueAccepted,500);assert.equal(r.denominator,500);
 assert.equal(b.auth.filter(x=>x==='authorize').length,2);assert.equal(b.vm.signals.filter(s=>s.signal==='SIGSTOP').length,1);assert.equal(b.vm.signals.filter(s=>s.signal==='SIGCONT').length,1);
 assert.equal(r.rawObservedPauseMs,17000);assert.equal(r.automaticScaleOutObserved,true);assert.equal(r.automaticScaleDownObserved,true);assert.equal(r.actualWorkerDistributionObserved,true);assert.equal(r.automaticScalingBenefitProven,false);
 assert.equal(r.restoration.state,'restored');assert.equal(b.f.events.some(e=>e.type==='patch'&&e.ops.some(o=>o.op!=='test'&&o.path.startsWith('/spec'))),false);
});
test('source pausedoneforCD remains explicit anddifferent from originalstate restoration',async()=>{
 const {r}=await run({initialPaused:true,postcondition:'paused-one-for-cd'});assert.equal(r.passed,true,JSON.stringify(r.errors));assert.equal(r.restoration.pausedOneHandoff,true);assert.equal(r.restoration.originalStateRestored,false);
});
test('unknown acceptedPOST stopsnewwork andkeeps500denominator plusallinflightreceipts',async()=>{
 const {b,r}=await run({disconnectPost:1});assert.equal(r.passed,false);assert.equal(b.calls.filter(c=>c.route.endsWith('/jobs')).length<=8,true);assert.equal(r.denominator,500);assert.equal(r.tasks.some(t=>t.submission.state==='unknown'),true);assert.equal(r.tasks.some(t=>t.submission.state==='not_sent'),true);
 assert.equal(b.vm.signals.filter(s=>s.signal==='SIGCONT').length,1);assert.equal(r.restoration.originalStateRestored,true);
});
test('duplicate returnedjobidentity cannotbe500verifiedresults',async()=>{
 let first;const {r}=await run({mutateJob:j=>{first??=j.id;j.id=first;}});assert.equal(r.passed,false);assert.equal(r.observedVerified<500,true);assert.equal(r.tasks.some(t=>t.job&&t.job.id!==t.submission.jobId),true);
});
test('foreignHPA refuses beforeauthentication,assets,faultorjobs',async()=>{
 const {b,r}=await run({foreignHPA:true});assert.equal(r.passed,false);assert.equal(b.auth.length,0);assert.equal(b.calls.length,0);assert.equal(b.vm.signals.length,0);
});
test('samePodname withforeignincontainerUID isrefused beforeSTOPandnotresumed',async()=>{
 const {b,r}=await run({foreignPod:true});assert.equal(r.passed,false);assert.equal(b.vm.signals.length,0);assert.equal(b.calls.filter(c=>c.route.endsWith('/jobs')).length,0);assert.equal(r.restoration.pausedOneHandoff,false);
});
test('unknownCONTisneverresent andneverbecomes passed',async()=>{
 const {b,r}=await run({unknownCONT:true});assert.equal(r.passed,false);assert.equal(b.vm.signals.filter(s=>s.signal==='SIGCONT').length,1);assert.equal(r.observedVerified,0);assert.equal(r.denominator,500);
});
for(const option of ['unknownStartBefore','unknownStartAfter'])test(option+' stopsalljobs andusesoneownedcancel/resumerequest withoutstartretry',async()=>{
 const {b,r}=await run({[option]:true});assert.equal(r.passed,false);assert.equal(b.remote.filter(c=>c.kind==='fault-start').length,1);assert.equal(b.remote.filter(c=>c.kind==='fault-request-resume').length,1);assert.equal(b.calls.filter(c=>c.route.endsWith('/jobs')).length,0);
 assert.equal(b.vm.signals.filter(s=>s.signal==='SIGCONT').length<=1,true);
});
test('cleanupfailuremakesglobalreportfailed after500validjobs; oldrawobservationsremain',async()=>{
 const {b,r}=await run({cleanupFailure:true});assert.equal(r.observedVerified,500);assert.equal(r.passed,false);assert.equal(b.records.get('terminal.json').passed,false);assert.equal(r.automaticScaleOutObserved,true);
});
test('deadagent isnotrestarted andcannotclaim resumeorcompletedexperiment',async()=>{
 const {b,r}=await run({agentDeath:true});assert.equal(r.passed,false);assert.equal(b.vm.spawns.filter(s=>s.kind==='agent').length,1);assert.equal(b.vm.signals.filter(s=>s.signal==='SIGCONT').length,0);assert.equal(r.restoration.originalStateRestored,false);
});
test('anexternalreplica2 ispreserved, neverforcedtoone',async()=>{
 const {b,r}=await run({externalReplica:true});assert.equal(r.passed,false);assert.equal(b.f.state.worker.spec.replicas,2);assert.equal(r.restoration.originalStateRestored,false);
});
test('fivewithoutobservedthree doesnotquietlyrelax theoriginalcriterion',async()=>{
 const {r}=await run({profile:'main-five',onlyFive:true});assert.equal(r.passed,false);assert.equal(r.automaticScaleOutObserved,false);assert.equal(r.denominator,500);
});
test('backward/negative originalserver time isretained andrefused, notclamped',async()=>{
 const {r}=await run({mutateJob:j=>{j.finished_at='2026-10-10T23:59:59.999Z';}});assert.equal(r.passed,false);assert.equal(r.tasks.some(t=>t.job?.finished_at==='2026-10-10T23:59:59.999Z'),true);
});
test('a sourcechanged afterexecution cannotclaimsuccessfulcompletion',async()=>{
 const b=workerPauseBoundary();b.io.verifyRuntime=async()=>{throw Error('Synthetic source drift');};const r=await runWorkerPause(b.c,b.io);assert.equal(r.passed,false);assert.equal(r.observedVerified,500);
});
test('ownoptin,compiledmainhash andfaultacknowledgement cannotbefilledbygenericflags',()=>{
 for(const f of [c=>{delete c.allowWorkerPauseReplay;c.allowControlledBacklog=true;},c=>{c.fault.acknowledgement='yes';},c=>{c.fault.mainSHA256='x';},c=>{c.jobs=8;}]){const b=workerPauseBoundary();f(b.c);assert.throws(()=>validateWorkerPause(b.c));}
});
test('physicalresumeafterexternalinterference cannotbeaccepted asavalidfaultstimulus',async()=>{
 const {r}=await run({externalResume:true});assert.equal(r.passed,false);assert.equal(r.resumed.confirmed,true);assert.equal(r.resumed.raw.finished.stimulusIntegrity,false);assert.equal(r.observedVerified,0);assert.notEqual(r.rawObservedPauseMs,17000);assert.equal(r.denominator,500);
});
