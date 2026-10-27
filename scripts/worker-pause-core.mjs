// Full original500-job controlled fault protocol. No default IO or invocation.
// It is not a throughput benchmark or a substitute for a failed admission test.
import {isDeepStrictEqual as same} from 'node:util';
import {validateAutoscale} from './cloud-autoscale-core.mjs';
import {declaredServiceActor} from './cloud-acceptance-core.mjs';
import {benchmarkDurations} from './cloud-benchmark-metrics.mjs';
import {sha256} from './comparison-files.mjs';
const deny=()=>{throw Error('Worker fault unconfirmed');},id=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(x);
export function validateWorkerPause(v){
 if(!v||Object.getPrototypeOf(v)!==Object.prototype||v.allowWorkerPauseReplay!==true||Object.hasOwn(v,'allowControlledBacklog')||
  !v.fault||Object.keys(v.fault).sort().join(',')!=='acknowledgement,mainSHA256'||v.fault.acknowledgement!=='I_AUTHORIZE_THIS_ISOLATED_WORKER_CHILD_STOP_WITH_BOUNDED_AGENT_RESUME'||!/^[a-f0-9]{64}$/.test(v.fault.mainSHA256??''))deny();
 const {allowWorkerPauseReplay,fault,...rest}=v;validateAutoscale({...rest,allowControlledBacklog:true});return structuredClone(v);
}
export async function runWorkerPause(input,io){
 let c,target,fixture,actor,auth,appData,appId,suiteId,preparation=null,started=null,resumed=null,reserved=false,halt=false,reason='unconfirmed',phase='configuration',requests=0,sequence=0,last=-Infinity,protocolComplete=false;
 const tasks=Array.from({length:500},(_,index)=>({index,submission:{state:'not_sent',commitState:'not_sent'},job:null})),samples=[],created=[],errors=[],seen=new Set();
 let restoration={state:'not_observed',originalStateRestored:false,pausedOneHandoff:false};
 const fail=code=>{halt=true;reason=code;deny();},check=()=>{if(halt)deny();const now=io.now();if(!Number.isFinite(now)||now<last||io.signal?.aborted||io.remaining(false)<=0)fail('stopped_clock_or_deadline');last=now;};
 async function api(op,token,status,boundary=()=>{}){
  check();const n=String(++sequence).padStart(6,'0'),began=io.now();await io.json('operations/'+n+'-intent.json',{phase,request:op,state:'intent',credentialWithheld:true});check();requests++;boundary();
  let r;try{r=await io.request(c.origin,op,token,Math.max(1,Math.min(15000,Math.floor(io.remaining(false)))),io.signal);}catch{r={networkEntered:true,status:null,code:'boundary_threw_outcome_unknown',bodyComplete:false,bodyTruncated:false,rawEntityBase64:null,body:null};}
  const {body,...raw}=r;try{await io.json('operations/'+n+'-observed.json',{...raw,elapsedMs:io.now()-began});}catch{halt=true;reason='response_persistence_unknown';throw Error('unconfirmed');}
  const ok=r.code==='response_received'&&r.bodyComplete&&!r.bodyTruncated&&r.status===status&&io.now()>=began&&io.remaining(false)>0&&!io.signal?.aborted;
  if(!ok){halt=true;reason='http_failed_or_unknown';}return {ok,raw,body:body??null};
 }
 async function asset(route,body,token){const r=await api({method:'POST',route,body},token,201);if(!r.ok||!id(r.body?.id)||route==='/suites'&&r.body.version!==1)fail('asset_failed_or_unknown');created.push({kind:route.slice(1),id:r.body.id});return r.body.id;}
 async function pool(fn){let cursor=0;await Promise.all(Array.from({length:8},async()=>{while(!halt&&!io.signal?.aborted&&cursor<500){const s=tasks[cursor++];try{await fn(s);}catch{halt=true;}}}));}
 function associated(j,s){return j&&j.id===s.submission.jobId&&j.workspace===c.workspace&&j.created_by===actor.principal&&same(j.input,s.input)&&
  j.snapshot?.application?.id===appId&&same(j.snapshot.application.data,appData)&&j.snapshot?.suite?.id===suiteId&&same(j.snapshot.suite.data,fixture.suite)&&j.status==='succeeded'&&j.attempts===1&&
  target.workers().some(p=>p.name===j.worker_id)&&benchmarkDurations(j).valid&&j.result?.gate==='passed'&&j.result.score===100&&j.result.total===10&&j.result.passed===10&&j.result.errors===0&&j.result.criticalFailures===0&&
  j.result.results?.length===10&&new Set(j.result.results.map(r=>r.caseId)).size===10&&j.result.results.every(r=>r.status==='passed'&&fixture.suite.cases.some(k=>k.id===r.caseId));}
 try{
  c=validateWorkerPause(input);phase='reservation';await io.reserve(c);reserved=true;check();
  phase='fixture';const f=await io.fixture();if(sha256(f.bytes)!==c.fixtureSHA256)fail('fixture_hash_changed');fixture=f.value;
  if(fixture.suite?.cases?.length!==10||new Set(fixture.suite.cases.map(x=>x.id)).size!==10||fixture.suite.policy?.minScore!==95||fixture.suite.policy.maxLatencyMs!==null)fail('fixture_invalid');
  phase='target-proof';target=await io.target(c);await target.preflight();check();
  phase='selected-credentials';auth=await io.authInputs(c);check();
  phase='active-one-warmup';preparation=await target.prepare();await io.json('fault-preparation.json',preparation);check();
  phase='authenticate-assets-and-enqueue';const token=await io.authorize(auth,c,0);actor=declaredServiceActor(token,'contributor',c.workspace);check();
  phase='assets';appData={...fixture.application,name:'Worker fault replay '+c.runId};appId=await asset('/applications',appData,token);suiteId=await asset('/suites',fixture.suite,token);
  phase='fault-start';check();started=await target.start();await io.json('fault-started.json',started);check();
  phase='enqueue500';await pool(async s=>{
   s.input={appId,suiteId,candidate:'worker-pause-'+c.runId+'-'+s.index,commitRef:c.commit,source:'replay',promptVersion:'v1',scenario:'passing'};
   const r=await api({method:'POST',route:'/jobs',body:s.input,key:'worker-pause-'+c.runId+'-'+s.index},token,202,()=>{s.submission={state:'unknown',commitState:'unknown'};});
   const ok=r.ok&&id(r.body?.id)&&r.body.status==='queued'&&r.body.replayed===false&&!seen.has(r.body.id);
   s.submission={state:ok?'accepted':!r.raw.networkEntered?'not_sent':r.raw.code==='response_received'&&r.raw.status!==202?'failed_response':'unknown',commitState:ok?'accepted':!r.raw.networkEntered?'not_sent':'unknown',jobId:ok?r.body.id:null,response:r.body};
   if(ok)seen.add(r.body.id);else{halt=true;reason='submission_failed_unknown_or_duplicate';}
  });check();
  phase='observe-automatic';let up=false,down=false;const end=io.now()+180000;
  for(let n=0;n<90&&io.now()<end;n++){
   check();const s=await target.sample();samples.push(s);await io.json('sample-'+samples.length+'.json',s);
   if(s.ready===3&&s.verifiedCohort&&s.hpaDesired>=3)up=true;
   if(up&&s.desired===1&&s.ready===1&&s.verifiedCohort&&s.hpaDesired===1){down=true;break;}await io.sleep(2000,false);
  }
  if(!up||!down)fail('original_exact_three_then_one_control_not_observed');
  phase='resume-proof';resumed=await target.resume(false);await io.json('fault-resume.json',resumed);if(!resumed.confirmed)fail('resume_failed_or_unknown');if(resumed.raw?.finished?.stimulusIntegrity!==true||resumed.raw.finished.stopSignalAttempted!==true)fail('fault_stimulus_interfered_or_unknown');check();
  phase='authenticate-verify';const verify=await io.authorize(auth,c,1);if(!same(declaredServiceActor(verify,'contributor',c.workspace),actor))fail('actor_changed');check();
  phase='verify500';await pool(async s=>{const r=await api({method:'GET',route:'/jobs/'+s.submission.jobId},verify,200);if(r.body!==null)s.job=structuredClone(r.body);if(!r.ok||!associated(s.job,s)){halt=true;reason='job_unassociated_failed_or_time_invalid';}else s.verified=true;});check();
  phase='source-stability';await io.verifyRuntime();check();protocolComplete=tasks.every(s=>s.verified===true);
 }catch{halt=true;errors.push({phase,code:reason});}
 finally{if(target)try{restoration=await target.finish(protocolComplete&&!halt,c.postcondition);}catch{restoration={state:'finish_threw_unknown',originalStateRestored:false,pausedOneHandoff:false,retryAllowed:false};}}
 const passed=Boolean(reserved&&!halt&&protocolComplete&&(c.postcondition==='restore-original'?restoration.originalStateRestored:restoration.pausedOneHandoff)&&!io.signal?.aborted&&io.remaining(true)>0);
 const workerCounts=Object.fromEntries((target?.workers()??[]).map(p=>[p.name,0]));for(const s of tasks)if(s.verified)workerCounts[s.job.worker_id]++;
 const report={formatVersion:1,state:passed?'completed':reserved?'failed_or_unknown_retained':'refused_before_reservation',passed,runId:c?.runId??null,sourceCommit:c?.commit??null,image:c?.image??null,
  requested:500,denominator:500,casesPerJob:10,producers:8,observers:8,requests,preparation,started,resumed,fault:target?.details()??null,tasks,samples,created,errors,restoration,
  uniqueAccepted:seen.size,observedVerified:tasks.filter(s=>s.verified).length,workerCounts,requestedPauseMs:17000,rawObservedPauseMs:resumed?.raw?.finished?.pauseMs??restoration.resume?.raw?.finished?.pauseMs??null,
  automaticScaleOutObserved:samples.some(s=>s.ready===3&&s.verifiedCohort&&s.hpaDesired>=3),automaticScaleDownObserved:samples.some((s,i)=>s.desired===1&&s.ready===1&&s.hpaDesired===1&&samples.slice(0,i).some(p=>p.ready===3&&p.verifiedCohort)),
  actualWorkerDistributionObserved:Object.values(workerCounts).filter(n=>n>0).length>1,automaticScalingBenefitProven:false,maximumCapacityProven:false,
  modelCallsRequested:0,actualProviderCallsIndependentlyMeasured:false,identityDeclarationIsNotAuthentication:true,cloudCostOrDeploymentAccepted:false,retryAllowed:false,resumeAllowed:false,
  interpretation:'Fault stimulus with an explicitly selected isolated fixture; full500-job denominator. Not natural traffic, a throughput benchmark, maximum capacity, node scaling, historical experiment replay, human acceptance or deployment. Agent/PID recovery and elapsed times require actual observation; no hard-kill or17-second SLA.'};
 if(reserved||io.owned)try{await io.terminal(report);if(passed&&(io.signal?.aborted||io.remaining(true)<=0))return {...report,passed:false,state:'failed_or_unknown_retained',evidenceState:'completion_deadline_or_cancellation'};}catch{return {...report,passed:false,state:'failed_or_unknown_retained',evidenceState:'terminal_persistence_unknown'};}
 return report;
}
