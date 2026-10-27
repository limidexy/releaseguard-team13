import test from 'node:test';
import assert from 'node:assert/strict';
import {pauseProgramVM} from './fixtures/worker-pause-program-vm.mjs';
test('exact in-container program inspects PodUID, PIDnamespace/start and compiled main without anysignal',async()=>{
 const h=pauseProgramVM(),r=await h.run(h.config);assert.equal(r.exitCode,0);assert.equal(r.output[0].state,'inspected');assert.equal(r.output[0].identity.pidNamespace,h.state.pidNamespace);assert.equal(h.signals.length,0);assert.equal(h.spawns.length,1);
});
test('detached ownedagent persists bothintents, STOPs once and CONTs onceafter17000syntheticms',async()=>{
 const h=pauseProgramVM(),c=h.ready(),r=await h.run(c);assert.equal(r.exitCode,0);assert.equal(r.output[0].state,'stopped');assert.equal(r.output[0].watchdogArmed,true);assert.equal(h.signals.length,1);assert.equal(h.signals[0].signal,'SIGSTOP');
 const records=h.records();assert.equal(Object.keys(records).some(p=>p.endsWith('/continue-intent.json')),true);assert.equal(Object.keys(records).some(p=>p.endsWith('/stop-intent.json')),true);
 await h.advance(17000);const status=await h.run({...c,mode:'status'});assert.equal(status.output[0].finished.resumeObserved,true);assert.equal(status.output[0].finished.pauseMs,17000);assert.equal(h.signals.filter(s=>s.signal==='SIGCONT').length,1);
 assert.equal(h.spawns[1].options.env.SERVICE_ROLE,'worker');assert.equal(Object.keys(h.spawns[1].options.env).length,3);assert.equal(h.state.workerState,'S');
});
test('operatorrequest andwatchdog shareoneCONTboundary, evenwithrepeatedlaterreads',async()=>{
 const h=pauseProgramVM(),c=h.ready();await h.run(c);await h.advance(1000);await h.run({...c,mode:'request-resume'});await h.advance(100);await h.advance(20000);
 for(let i=0;i<3;i++)assert.equal((await h.run({...c,mode:'status'})).output[0].finished.continueSignalAttempts,1);
 assert.equal(h.signals.filter(s=>s.signal==='SIGCONT').length,1);assert.equal((await h.run({...c,mode:'request-resume'})).output[0].finished.reason,'operator_request');
});
test('unknown CONT result isretained, neverresentbyrequest,watchdogorread',async()=>{
 const h=pauseProgramVM({unknownCONT:true}),c=h.ready();await h.run(c);await h.advance(17000);const r=await h.run({...c,mode:'status'});assert.equal(r.output[0].finished.code,'resume_failed_or_unknown_no_retry');assert.equal(r.output[0].finished.resumeObserved,false);
 await h.run({...c,mode:'request-resume'});await h.advance(20000);assert.equal(h.signals.filter(s=>s.signal==='SIGCONT').length,1);
});
test('a foreignPodUID orrestartedPIDnamespace refusesbeforeanysignal',async()=>{
 for(const field of ['podUID','pidNamespace','pidStartTicks']){const h=pauseProgramVM(),c=h.ready();h.state[field]=field==='pidNamespace'?'pid:[60000]':field==='pidStartTicks'?'999999':'foreign-pod-uid';const r=await h.run(c);assert.equal(r.exitCode,1);assert.equal(h.signals.length,0);}
});
for(const field of ['role','platform','uid'])test('wrong '+field+' refusesremoteauthority beforeanysignal',async()=>{
 const h=pauseProgramVM(),c=h.ready();h.state[field]=field==='uid'?0:field==='platform'?'darwin':'support';const r=await h.run(c);assert.equal(r.exitCode,1);assert.equal(h.signals.length,0);
});
test('wrong mainhash, expired start or missingDownwardAPI identity refusesbeforewritingrunorsignalling',async()=>{
 for(const change of [c=>{c.mainSHA256='a'.repeat(64);},c=>{c.notAfterEpochMs=0;}]){const h=pauseProgramVM(),c=h.ready();change(c);assert.equal((await h.run(c)).exitCode,1);assert.equal(h.signals.length,0);}
 const h=pauseProgramVM();assert.equal((await h.run(h.ready(),{RG_TRIAL_POD_UID:undefined})).exitCode,1);assert.equal(h.signals.length,0);
});
test('same run cannot start again oroverwriteitsoriginalintent',async()=>{
 const h=pauseProgramVM(),c=h.ready();await h.run(c);const before=JSON.stringify(h.records());assert.equal((await h.run(c)).exitCode,1);assert.equal(JSON.stringify(h.records()),before);assert.equal(h.signals.filter(s=>s.signal==='SIGSTOP').length,1);await h.advance(17000);
});
test('cancelbefore unknown delayedstart reservesrunandpreventsafutureSTOP',async()=>{
 const h=pauseProgramVM(),c=h.ready(),r=await h.run({...c,mode:'request-resume'});assert.equal(r.output[0].state,'cancelled_before_start');assert.equal((await h.run(c)).exitCode,1);assert.equal(h.signals.length,0);
});
test('agentdeath remainsunknown andstopped, neverasilentrestorationclaim or automaticrestart',async()=>{
 const h=pauseProgramVM(),c=h.ready();await h.run(c);h.killAgent();await h.advance(20000);const r=await h.run({...c,mode:'status'});assert.equal(r.output[0].state,'pending_or_unknown');assert.equal(h.state.workerState,'T');assert.equal(h.spawns.length,2);assert.equal(h.signals.filter(s=>s.signal==='SIGCONT').length,0);
});
test('a preSTOPintent persistencefailure preventsSTOP entirely',async()=>{
 const h=pauseProgramVM({failSync:p=>p.endsWith('/continue-intent.json')}),c=h.ready();const r=await h.run(c);assert.equal(r.exitCode,1);assert.equal(h.signals.length,0);
});
test('apausebyanotheractor betweenselectionandagentstart isnotclaimedorresumed',async()=>{
 const h=pauseProgramVM({beforeAgent:state=>{state.workerState='T';}}),c=h.ready();const r=await h.run(c);assert.equal(r.exitCode,1);assert.equal(h.signals.length,0);
});
test('anexternalearlyresume isvisibleasinterference, not17seconds ofcontinuouspause',async()=>{
 const h=pauseProgramVM(),c=h.ready();await h.run(c);await h.advance(5000);h.state.workerState='S';await h.advance(100);
 const r=await h.run({...c,mode:'status'});assert.equal(r.output[0].state,'finished');assert.equal(r.output[0].finished.stimulusIntegrity,false);assert.equal(r.output[0].finished.reason,'external_state_change');
});
test('direct Worker as namespace PID1 is refused; no in-namespace STOP is attempted',async()=>{
 const h=pauseProgramVM({directPID1:true});assert.equal((await h.run(h.config)).exitCode,1);assert.equal((await h.run(h.ready())).exitCode,1);
 assert.equal(h.signals.length,0);assert.equal(h.spawns.length,0);
});
test('ambiguous Worker children, changed PID or launcher digest refuse before fault',async()=>{
 const duplicate=pauseProgramVM({duplicateWorker:true});assert.equal((await duplicate.run(duplicate.config)).exitCode,1);assert.equal(duplicate.signals.length,0);
 for(const change of [c=>{c.workerPID=8;},c=>{c.launcherSHA256='e'.repeat(64);}]){
  const h=pauseProgramVM(),c=h.ready();change(c);assert.equal((await h.run(c)).exitCode,1);assert.equal(h.signals.length,0);
 }
});
test('after a confirmed STOP, journal read loss cannot disable the sole identity-bound CONT attempt',async()=>{
 let fail=false;const h=pauseProgramVM({failRead:p=>fail&&p.endsWith('/plan.json')}),c=h.ready();assert.equal((await h.run(c)).exitCode,0);
 fail=true;await h.advance(17000);assert.equal(h.signals.filter(s=>s.signal==='SIGCONT').length,1);assert.equal(h.state.workerState,'S');
 fail=false;const r=await h.run({...c,mode:'status'});assert.equal(r.output[0].finished.resumeObserved,true);assert.equal(h.signals.some(s=>s.pid===1),false);
});
