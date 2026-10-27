// Full planned-cohort accounting for the inactive paired replay benchmark.
// Raw slots stay unchanged. Partial/negative/missing observations cannot produce
// a full-cohort percentile or a passing comparison. No runtime IO on import.
const finiteNonnegative=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
const timestamp=x=>{
 if(typeof x!=='string')return null;const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(x);if(!m)return null;
 const [,y,month,day,hour,minute,second,offsetHour='0',offsetMinute='0']=m.map((v,i)=>i?Number(v):v),leap=y%4===0&&(y%100!==0||y%400===0),days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 if(month<1||month>12||day<1||day>days[month-1]||hour>23||minute>59||second>59||offsetHour>23||offsetMinute>59)return null;
 const ms=Date.parse(x);return Number.isFinite(ms)?ms:null;
};
const percentile=xs=>{const s=[...xs].sort((a,b)=>a-b);return s.length?s[Math.ceil(s.length*.95)-1]:null;};
const completePercentile=(xs,total)=>xs.length===total&&total>0&&xs.every(finiteNonnegative)?percentile(xs):null;
const median=xs=>{const s=[...xs].sort((a,b)=>a-b);return s.length===2&&s.every(finiteNonnegative)?s[0]/2+s[1]/2:null;};
export function benchmarkDurations(job){
 const created=timestamp(job?.created_at),started=timestamp(job?.started_at),finished=timestamp(job?.finished_at);
 const raw={createdAt:job?.created_at??null,startedAt:job?.started_at??null,finishedAt:job?.finished_at??null,
  queueMs:created!==null&&started!==null?started-created:null,
  processingMs:started!==null&&finished!==null?finished-started:null,
  completionMs:created!==null&&finished!==null?finished-created:null};
 return {...raw,valid:[raw.queueMs,raw.processingMs,raw.completionMs].every(finiteNonnegative)};
}
export function summarizeBenchmarkStage(stage){
 const tasks=Array.isArray(stage.tasks)?stage.tasks:[],reads=Array.isArray(stage.reads)?stage.reads:[],warmups=Array.isArray(stage.warmups)?stage.warmups:[];
 const rows=tasks.map((t,index)=>({index,plannedIndex:t?.index??null,submissionState:t?.submission?.state??'not_sent',
  submitMs:t?.submission?.durationMs??null,jobId:t?.job?.id??null,status:t?.job?.status??null,workerId:t?.job?.worker_id??null,
  ...benchmarkDurations(t?.job)}));
 const validShape=Number.isInteger(stage.requested)&&stage.requested>=20&&stage.requested<=200&&tasks.length===stage.requested&&rows.every((r,i)=>r.plannedIndex===i);
 const observed=rows.filter(r=>r.jobId!==null),ids=observed.map(r=>r.jobId),duplicateJobIds=[...new Set(ids.filter((id,i)=>ids.indexOf(id)!==i))];
 const terminal=row=>['succeeded','failed'].includes(row.status),unique=new Map();
 for(const row of rows)if(typeof row.jobId==='string'&&!unique.has(row.jobId))unique.set(row.jobId,row);
 const outcomes={requested:stage.requested,slotCount:tasks.length,notSent:rows.filter(r=>r.submissionState==='not_sent').length,
  accepted:rows.filter(r=>r.submissionState==='accepted').length,submissionFailed:rows.filter(r=>r.submissionState==='failed_response').length,
  submissionUnknown:rows.filter(r=>r.submissionState==='unknown').length,observedTerminal:rows.filter(terminal).length,
  uniqueSucceededJobs:[...unique.values()].filter(r=>r.status==='succeeded').length,uniqueFailedJobs:[...unique.values()].filter(r=>r.status==='failed').length,
  missingOrNonterminal:rows.filter(r=>!terminal(r)).length,invalidTimes:rows.filter(r=>!r.valid).length,duplicateJobIds};
 const workerMap=new Map();for(const row of unique.values())if(typeof row.workerId==='string'&&row.workerId.length>0&&terminal(row)){
  const key=row.workerId;if(!workerMap.has(key))workerMap.set(key,{succeeded:0,failed:0});workerMap.get(key)[row.status==='succeeded'?'succeeded':'failed']++;}
 const workerCounts=Object.fromEntries(workerMap);
 const elapsedValid=typeof stage.elapsedMs==='number'&&Number.isFinite(stage.elapsedMs)&&stage.elapsedMs>0;
 const warmupPassed=warmups.length===5&&warmups.every(t=>t?.submission?.state==='accepted'&&t.job?.status==='succeeded'&&benchmarkDurations(t.job).valid);
 const allAccepted=validShape&&rows.every(r=>r.submissionState==='accepted'&&typeof r.jobId==='string'&&r.jobId.length>0)&&duplicateJobIds.length===0;
 const submissionsValid=allAccepted&&rows.every(r=>finiteNonnegative(r.submitMs));
 const jobsComplete=allAccepted&&rows.every(r=>r.status==='succeeded'&&r.valid&&typeof r.workerId==='string'&&r.workerId.length>0);
 const readsComplete=reads.length===200&&reads.every((r,i)=>r?.index===i&&r.state==='succeeded'&&finiteNonnegative(r.durationMs));
 const complete=jobsComplete&&submissionsValid&&warmupPassed&&readsComplete&&elapsedValid&&stage.targetStable===true&&Array.isArray(stage.errors)&&stage.errors.length===0;
 const descriptiveRate=elapsedValid?outcomes.uniqueSucceededJobs*1000/stage.elapsedMs:null;
 return {round:stage.round,replicas:stage.replicas,requested:stage.requested,outcomes,warmupPassed,readsComplete,targetStable:stage.targetStable===true,
  completeSuccessfulCohort:complete,elapsedMs:stage.elapsedMs??null,
  jobsPerSecond:Number.isFinite(descriptiveRate)?descriptiveRate:null,
  throughputMeaning:'Unique observed succeeded jobs per full measured elapsed window; descriptive even on a failed cohort, not maximum capacity',
  fullCohortWriteP95Ms:allAccepted?completePercentile(rows.map(r=>r.submitMs),stage.requested):null,
  fullCohortCompletionP95Ms:jobsComplete?completePercentile(rows.map(r=>r.completionMs),stage.requested):null,
  fullCohortQueueP95Ms:jobsComplete?completePercentile(rows.map(r=>r.queueMs),stage.requested):null,
  fullCohortProcessingP95Ms:jobsComplete?completePercentile(rows.map(r=>r.processingMs),stage.requested):null,
  historyReadP95Ms:readsComplete?completePercentile(reads.map(r=>r.durationMs),200):null,
  workerCounts,targetWorkerCounts:Array.isArray(stage.targetBefore?.workerIds)?Object.fromEntries(stage.targetBefore.workerIds.map(id=>[id,workerCounts[id]??{succeeded:0,failed:0}])):null,
  rows,originalSlots:structuredClone(tasks),originalReads:structuredClone(reads),
  noInvalidSampleFiltering:true,warmupsExcludedFromMeasuredDenominator:true};
}
export function summarizePairedBenchmark(stages,restoration){
 const summaries=stages.map(summarizeBenchmarkStage),plan=[[1,1],[1,3],[2,3],[2,1]],paired=summaries.length===4&&summaries.every((s,i)=>s.round===plan[i][0]&&s.replicas===plan[i][1]);
 const complete=paired&&summaries.every(s=>s.completeSuccessfulCohort)&&restoration?.workerRestored===true&&restoration?.controllerRestored===true;
 const pairedRates=[1,3].map(replicas=>({replicas,rounds:summaries.filter(s=>s.replicas===replicas).length,
  medianJobsPerSecond:paired?median(summaries.filter(s=>s.replicas===replicas).map(s=>s.jobsPerSecond)):null}));
 const a=pairedRates[0].medianJobsPerSecond,b=pairedRates[1].medianJobsPerSecond,ratio=complete&&a>0?b/a:null;
 return {formatVersion:1,automaticScaling:false,plannedStages:plan,summaries,summary:pairedRates,passed:complete,
  throughputRatio:Number.isFinite(ratio)?ratio:null,restoration:structuredClone(restoration??null),
  maximumCapacityProven:false,automaticScalingBenefitProven:false,
  interpretation:complete?'Complete short manual paired replay comparison; a descriptive ratio is not proportional/sustained/automatic scaling proof.':'Failed/incomplete/unknown cohort or restoration; no valid benefit comparison.',
  limitations:'Four planned stages, five excluded warmups/stage, eight producers/observers and200 history reads/stage. Client durable receipt overhead is included in measured elapsed time and submit duration; this can constrain offered load. Percentiles are not means and cannot establish Little law. Raw failures, unknowns and invalid times are preserved.'};
}
