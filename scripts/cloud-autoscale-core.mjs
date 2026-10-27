// Full700-job source protocol. Inert until explicitly called with owned IO.
// No failed-operation retry/resume, smaller success denominator or model calls.
import {isDeepStrictEqual as same} from 'node:util';
import {validatePairedBenchmark} from './cloud-benchmark-core.mjs';
import {validateAutoscaleTarget} from './cloud-autoscale-target.mjs';
import {declaredServiceActor} from './cloud-acceptance-core.mjs';
import {benchmarkDurations} from './cloud-benchmark-metrics.mjs';
import {sha256} from './comparison-files.mjs';
const deny=()=>{throw Error('Controlled backlog unconfirmed');},plain=x=>x&&Object.getPrototypeOf(x)===Object.prototype;
const id=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(x);
export function validateAutoscale(v){
 const names=['allowControlledBacklog','runId','deadlineMs','origin','allowedOrigins','commit','image','workspace','authMode','authFile','cloud','target','fixtureSHA256','identity','isolation','postcondition'];
 if(!plain(v)||Object.keys(v).length!==names.length||names.some(k=>!Object.hasOwn(v,k))||v.allowControlledBacklog!==true||
  !['restore-original','paused-one-for-cd'].includes(v.postcondition)||!same(v.isolation,{exclusiveQueueAndWorker:true,acknowledgement:'I_CONTROL_THIS_ISOLATED_QUEUE_AND_WORKER_TARGET'}))deny();
 const {metricName,controllerProfile,...selected}=v.target??{};
 validatePairedBenchmark({...Object.fromEntries(names.filter(k=>!['allowControlledBacklog','isolation','postcondition','target'].includes(k)).map(k=>[k,v[k]])),allowPairedReplay:true,jobs:100,target:selected});
 validateAutoscaleTarget({...v.target,runId:v.runId,namespace:v.cloud.namespace,imageDigest:v.image.split('@')[1]});return structuredClone(v);
}
export async function runControlledBacklog(input,io){
 let c,target,fixture,appData,appId,suiteId,actor,auth,phase='configuration',halt=false,reason='unconfirmed',reserved=false,requests=0,sequence=0,last=-Infinity,protocolComplete=false;
 let preparation=null,restoration={state:'not_observed',originalStateRestored:false,pausedOneHandoff:false};
 const tasks=Array.from({length:700},(_,index)=>({index,submission:{state:'not_sent',commitState:'not_sent'},job:null})),samples=[],created=[],errors=[],seen=new Set();
 const fail=code=>{halt=true;reason=code;deny();};
 const check=()=>{if(halt)deny();const now=io.now();if(!Number.isFinite(now)||now<last||io.signal?.aborted||io.remaining(false)<=0)fail('stopped_deadline_or_clock_invalid');last=now;};
 async function api(op,token,status,onBoundary=()=>{}){
  check();const n=String(++sequence).padStart(6,'0'),began=io.now();await io.json('operations/'+n+'-intent.json',{phase,request:op,state:'intent',credentialWithheld:true});check();requests++;onBoundary();
  let r;try{r=await io.request(c.origin,op,token,Math.max(1,Math.min(15000,Math.floor(io.remaining(false)))),io.signal);}
  catch{r={networkEntered:true,status:null,code:'boundary_threw_outcome_unknown',bodyComplete:false,bodyTruncated:false,rawEntityBase64:null,body:null};}
  const {body,...raw}=r;try{await io.json('operations/'+n+'-observed.json',{...raw,elapsedMs:io.now()-began});}catch{halt=true;reason='response_persistence_unknown';throw Error('unconfirmed');}
  const ok=r.code==='response_received'&&r.bodyComplete&&!r.bodyTruncated&&r.status===status&&io.now()>=began&&io.remaining(false)>0&&!io.signal?.aborted;
  if(!ok){halt=true;reason='http_failed_or_unknown';}return {ok,raw,body:body??null};
 }
 async function asset(route,body,token){const r=await api({method:'POST',route,body},token,201);if(!r.ok||!id(r.body?.id)||route==='/suites'&&r.body.version!==1)fail('asset_failed_or_unconfirmed');created.push({kind:route.slice(1),id:r.body.id});return r.body.id;}
 async function pool(fn){let cursor=0;await Promise.all(Array.from({length:8},async()=>{while(!halt&&!io.signal?.aborted&&cursor<700){const slot=tasks[cursor++];try{await fn(slot);}catch{halt=true;}}}));}
 function associated(j,s){
  return plain(j)&&j.id===s.submission.jobId&&j.workspace===c.workspace&&j.created_by===actor.principal&&same(j.input,s.input)&&
   j.snapshot?.application?.id===appId&&same(j.snapshot.application.data,appData)&&j.snapshot?.suite?.id===suiteId&&same(j.snapshot.suite.data,fixture.suite)&&
   j.status==='succeeded'&&j.attempts===1&&typeof j.worker_id==='string'&&target.workers().some(p=>p.name===j.worker_id)&&benchmarkDurations(j).valid&&
   j.result?.gate==='passed'&&j.result.score===100&&j.result.total===10&&j.result.passed===10&&j.result.errors===0&&j.result.criticalFailures===0&&
   j.result.results?.length===10&&new Set(j.result.results.map(r=>r.caseId)).size===10&&j.result.results.every(r=>r.status==='passed'&&fixture.suite.cases.some(k=>k.id===r.caseId));
 }
 try{
  c=validateAutoscale(input);phase='reservation';await io.reserve(c);reserved=true;
  phase='fixture';check();const f=await io.fixture();if(sha256(f.bytes)!==c.fixtureSHA256)fail('fixture_hash_changed');fixture=f.value;
  if(!plain(fixture.application)||fixture.suite?.cases?.length!==10||new Set(fixture.suite.cases.map(x=>x.id)).size!==10||fixture.suite.policy?.minScore!==95||fixture.suite.policy.maxLatencyMs!==null)fail('fixture_invalid');
  phase='target-proof';check();target=await io.target(c);await target.preflight();check();
  // Bind target before sending selected credentials; reserve before all IO.
  phase='selected-credentials';auth=await io.authInputs(c);check();
  phase='authenticate-assets';const token=await io.authorize(auth,c,0);actor=declaredServiceActor(token,'contributor',c.workspace);check();
  phase='assets';appData={...fixture.application,name:'Controlled replay '+c.runId};appId=await asset('/applications',appData,token);suiteId=await asset('/suites',fixture.suite,token);
  phase='zero-and-hold';check();preparation=await target.prepare();check();await io.json('preparation.json',preparation);
  phase='authenticate-enqueue';const enqueue=await io.authorize(auth,c,1);if(!same(declaredServiceActor(enqueue,'contributor',c.workspace),actor))fail('service_actor_changed');check();
  phase='enqueue';await pool(async s=>{
   s.input={appId,suiteId,candidate:'autoscale-'+c.runId+'-'+s.index,commitRef:c.commit,source:'replay',promptVersion:'v1',scenario:'passing'};
   const r=await api({method:'POST',route:'/jobs',body:s.input,key:'autoscale-'+c.runId+'-'+s.index},enqueue,202,()=>{s.submission={state:'unknown',commitState:'unknown'};});
   const ok=r.ok&&id(r.body?.id)&&r.body.status==='queued'&&r.body.replayed===false&&!seen.has(r.body.id);
   s.submission={state:ok?'accepted':!r.raw.networkEntered?'not_sent':r.raw.code==='response_received'&&r.raw.status!==202?'failed_response':'unknown',commitState:ok?'accepted':!r.raw.networkEntered?'not_sent':'unknown',jobId:ok?r.body.id:null,response:r.body};
   if(!ok){halt=true;reason='submission_failed_unknown_or_duplicate';}else seen.add(r.body.id);
  });check();await target.held();
  phase='release';await target.release();check();
  phase='observe-automatic';let up=false,down=false;const began=io.now(),end=began+210000;
  while(io.now()<end){check();const s=await target.sample();samples.push(s);await io.json('sample-'+samples.length+'.json',s);
   if(s.ready>=3&&s.hpaDesired>=3)up=true;
   if(up&&s.desired===1&&s.ready===1&&s.hpaDesired===1){down=true;break;}
   await io.sleep(3000,false);
  }
  if(!up||!down)fail('automatic_scale_out_or_down_not_observed');
  phase='authenticate-verify';const verify=await io.authorize(auth,c,2);if(!same(declaredServiceActor(verify,'contributor',c.workspace),actor))fail('service_actor_changed');check();
  phase='verify700';await pool(async s=>{const r=await api({method:'GET',route:'/jobs/'+s.submission.jobId},verify,200);if(r.body!==null)s.job=structuredClone(r.body);
   if(!r.ok||!associated(s.job,s)){halt=true;reason='job_failed_unassociated_or_time_invalid';}else s.verified=true;
  });check();
  phase='events';const events=await target.events();await io.json('events.json',events);check();
  phase='source-stability';await io.verifyRuntime();check();protocolComplete=tasks.every(t=>t.verified===true);
 }catch{halt=true;errors.push({phase,code:reason});}
 finally{if(target){try{restoration=await target.finish(protocolComplete&&!halt,c.postcondition);}catch{restoration={state:'finish_threw_unknown',originalStateRestored:false,pausedOneHandoff:false,retryAllowed:false};}}}
 const passed=Boolean(reserved&&!halt&&protocolComplete&&(c.postcondition==='restore-original'?restoration.originalStateRestored:restoration.pausedOneHandoff)&&!io.signal?.aborted&&io.remaining(true)>0);
 const observed=tasks.filter(t=>t.verified).length,workerCounts=Object.fromEntries((target?.workers()??[]).map(p=>[p.name,0]));for(const s of tasks)if(s.verified)workerCounts[s.job.worker_id]++;
 const report={formatVersion:1,state:passed?'completed':reserved?'failed_or_unknown_retained':'refused_before_reservation',passed,runId:c?.runId??null,sourceCommit:c?.commit??null,image:c?.image??null,
  requested:700,casesPerJob:10,producers:8,observers:8,requests,preparation,tasks,samples,created,errors,restoration,observedVerified:observed,denominator:700,
  uniqueAccepted:new Set(tasks.filter(t=>t.submission.state==='accepted').map(t=>t.submission.jobId)).size,workerCounts,
  automaticScaleOutObserved:samples.some(s=>s.ready>=3&&s.hpaDesired>=3),automaticScaleDownObserved:samples.some((s,i)=>s.desired===1&&s.ready===1&&s.hpaDesired===1&&samples.slice(0,i).some(p=>p.ready>=3&&p.hpaDesired>=3)),
  actualWorkerDistributionObserved:Object.values(workerCounts).filter(n=>n>0).length>1,
  modelCallsRequested:0,actualProviderCallsIndependentlyMeasured:false,automaticScalingBenefitProven:false,maximumCapacityProven:false,retryAllowed:false,resumeAllowed:false,
  identityDeclarationIsNotAuthentication:true,cloudCostOrDeploymentAccepted:false,interpretation:'Artificial controlled backlog. Control observations and actual job/Worker associations are separate; no natural-traffic, sustained throughput benefit, maximum capacity, node scaling or deployment claim.'};
 if(reserved||io.owned){try{await io.terminal(report);if(passed&&(io.signal?.aborted||io.remaining(true)<=0))return {...report,passed:false,state:'failed_or_unknown_retained',evidenceState:'completion_deadline_or_cancellation'};}
  catch{return {...report,passed:false,state:'failed_or_unknown_retained',evidenceState:'terminal_persistence_unknown'};}}
 return report;
}
