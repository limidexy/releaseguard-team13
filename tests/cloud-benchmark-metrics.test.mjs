import test from 'node:test';
import assert from 'node:assert/strict';
import {benchmarkDurations,summarizeBenchmarkStage,summarizePairedBenchmark} from '../scripts/cloud-benchmark-metrics.mjs';
const stage=(round=1,replicas=1)=>{
 const job=index=>({id:'synthetic-'+round+'-'+replicas+'-'+index,status:'succeeded',worker_id:'worker-'+index%replicas,
  created_at:'2026-10-11T00:00:00.000Z',started_at:'2026-10-11T00:00:00.010Z',finished_at:'2026-10-11T00:00:00.030Z'});
 const task=index=>({index,submission:{state:'accepted',durationMs:2},job:job(index)});
 return {round,replicas,requested:20,elapsedMs:1000,targetStable:true,tasks:Array.from({length:20},(_,i)=>task(i)),warmups:Array.from({length:5},(_,i)=>task(i+100)),
  reads:Array.from({length:200},(_,index)=>({index,state:'succeeded',durationMs:4})),errors:[]};
};
const restored={workerRestored:true,controllerRestored:true};
test('complete20-job denominator has hand-checked30ms completion,10ms queue,20ms processing and20jobs/s',()=>{
 const s=stage(),copy=structuredClone(s),r=summarizeBenchmarkStage(s);assert.equal(r.completeSuccessfulCohort,true);assert.equal(r.jobsPerSecond,20);
 assert.equal(r.fullCohortCompletionP95Ms,30);assert.equal(r.fullCohortQueueP95Ms,10);assert.equal(r.fullCohortProcessingP95Ms,20);assert.equal(r.historyReadP95Ms,4);
 assert.deepEqual(r.workerCounts,{'worker-0':{succeeded:20,failed:0}});assert.deepEqual(s,copy);
});
test('negative raw times stay negative, invalid, and never become passing percentile evidence',()=>{
 const s=stage();s.tasks[0].job.finished_at='2026-10-10T23:59:59.999Z';const r=summarizeBenchmarkStage(s);
 assert.equal(r.rows[0].completionMs,-1);assert.equal(r.rows[0].processingMs,-11);assert.equal(r.outcomes.invalidTimes,1);assert.equal(r.fullCohortCompletionP95Ms,null);assert.equal(r.completeSuccessfulCohort,false);
});
for(const field of ['created_at','started_at','finished_at'])test('missing '+field+' is unknown rather than silently excluded',()=>{
 const s=stage();delete s.tasks[0].job[field];const r=summarizeBenchmarkStage(s);assert.equal(r.fullCohortCompletionP95Ms,null);assert.equal(r.rows.length,20);assert.equal(r.completeSuccessfulCohort,false);
});
test('failed warmup invalidates preparation but is not added to measured20 jobs or worker counts',()=>{
 const s=stage();s.warmups[0].job.status='failed';const r=summarizeBenchmarkStage(s);assert.equal(r.warmupPassed,false);assert.equal(r.completeSuccessfulCohort,false);assert.equal(r.outcomes.requested,20);assert.equal(r.workerCounts['worker-0'].succeeded,20);
});
for(const state of ['not_sent','unknown','failed_response'])test(state+' remains in full planned denominator with no successful-subset p95',()=>{
 const s=stage();s.tasks[0]={index:0,submission:{state,durationMs:3},job:null};const r=summarizeBenchmarkStage(s);assert.equal(r.rows.length,20);assert.equal(r.outcomes.uniqueSucceededJobs,19);
 assert.equal(r.jobsPerSecond,19);assert.equal(r.completeSuccessfulCohort,false);assert.equal(r.fullCohortCompletionP95Ms,null);assert.equal(r.fullCohortWriteP95Ms,null);
});
test('duplicate job observations do not double-count actual Worker processing or permit a successful cohort',()=>{
 const s=stage();s.tasks[1].job=structuredClone(s.tasks[0].job);const r=summarizeBenchmarkStage(s);assert.equal(r.outcomes.uniqueSucceededJobs,19);assert.equal(r.workerCounts['worker-0'].succeeded,19);assert.equal(r.outcomes.duplicateJobIds.length,1);assert.equal(r.completeSuccessfulCohort,false);
});
for(const value of [-1,NaN,Infinity,null])test('invalid raw submit duration '+value+' remains visible and produces no full-cohort write percentile',()=>{
 const s=stage();s.tasks[0].submission.durationMs=value;const r=summarizeBenchmarkStage(s);assert.equal(r.fullCohortWriteP95Ms,null);assert.equal(r.originalSlots[0].submission.durationMs,value);assert.equal(r.completeSuccessfulCohort,false);
});
test('incomplete history reads are not silently filtered to199 successful reads',()=>{
 const s=stage();s.reads[0].state='unknown';const r=summarizeBenchmarkStage(s);assert.equal(r.historyReadP95Ms,null);assert.equal(r.originalReads.length,200);assert.equal(r.completeSuccessfulCohort,false);
});
test('manual four-stage comparison uses all rounds and requires both Worker and controller restoration',()=>{
 const stages=[stage(1,1),stage(1,3),stage(2,3),stage(2,1)];stages[1].elapsedMs=500;stages[2].elapsedMs=500;
 const r=summarizePairedBenchmark(stages,restored);assert.equal(r.passed,true);assert.equal(r.summary[0].medianJobsPerSecond,20);assert.equal(r.summary[1].medianJobsPerSecond,40);assert.equal(r.throughputRatio,2);assert.equal(r.automaticScalingBenefitProven,false);
 for(const bad of [{workerRestored:false,controllerRestored:true},{workerRestored:true,controllerRestored:false},null])assert.equal(summarizePairedBenchmark(stages,bad).passed,false);
});
test('a missing/reordered stage or one failed task cannot produce a valid paired throughput ratio',()=>{
 for(const mutate of [s=>s.pop(),s=>s.reverse(),s=>{s[2].tasks[0].job.status='failed';}]){const stages=[stage(1,1),stage(1,3),stage(2,3),stage(2,1)];mutate(stages);const r=summarizePairedBenchmark(stages,restored);assert.equal(r.passed,false);assert.equal(r.throughputRatio,null);}
});
test('target instability or non-positive measured window remains raw and cannot pass',()=>{
 for(const patch of [{targetStable:false},{elapsedMs:0},{elapsedMs:-1},{elapsedMs:NaN}]){const s={...stage(),...patch},r=summarizeBenchmarkStage(s);assert.equal(r.completeSuccessfulCohort,false);if(Object.hasOwn(patch,'elapsedMs'))assert.equal(r.jobsPerSecond,null);}
});
test('timezone-less timestamp is unknown rather than dependent on the client local timezone',()=>{
 const s=stage();s.tasks[0].job.created_at='2026-10-11T00:00:00';const r=summarizeBenchmarkStage(s);assert.equal(r.rows[0].completionMs,null);assert.equal(r.completeSuccessfulCohort,false);
});
test('missing Worker identity or empty job identity cannot prove distributed completion',()=>{
 for(const patch of [{worker_id:null},{id:''}]){const s=stage();Object.assign(s.tasks[0].job,patch);assert.equal(summarizeBenchmarkStage(s).completeSuccessfulCohort,false);}
});
test('untrusted Worker labels cannot mutate object prototypes while reporting observed counts',()=>{
 const s=stage();s.tasks[0].job.worker_id='__proto__';const r=summarizeBenchmarkStage(s);assert.equal(Object.prototype.succeeded,undefined);
 assert.equal(Object.hasOwn(r.workerCounts,'__proto__'),true);assert.deepEqual(r.workerCounts.__proto__,{succeeded:1,failed:0});
});
test('invalid calendar dates stay raw/unknown instead of being normalized by Date.parse',()=>{
 const s=stage();s.tasks[0].job.created_at='2026-02-30T00:00:00Z';const r=summarizeBenchmarkStage(s);assert.equal(r.rows[0].createdAt,'2026-02-30T00:00:00Z');assert.equal(r.rows[0].completionMs,null);assert.equal(r.completeSuccessfulCohort,false);
});
test('ready but idle Workers are explicitly reported with zero completions',()=>{
 const s=stage();s.targetBefore={workerIds:['worker-0','worker-idle']};const r=summarizeBenchmarkStage(s);assert.deepEqual(r.targetWorkerCounts['worker-idle'],{succeeded:0,failed:0});assert.equal(r.targetWorkerCounts['worker-0'].succeeded,20);
});
