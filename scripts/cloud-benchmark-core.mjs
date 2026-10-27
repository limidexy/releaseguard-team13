// Complete manual 1/3,3/1 replay comparison. Injected boundaries; import is inert.
// No success subset, failed-call retry, model, review, deletion or deployment.
import {isDeepStrictEqual as same} from 'node:util';
import {isAbsolute} from 'node:path';
import {validateCloudSmoke} from './cloud-smoke-core.mjs';
import {declaredServiceActor} from './cloud-acceptance-core.mjs';
import {validateEvidenceConfiguration} from './gcp-evidence-core.mjs';
import {benchmarkTarget} from './cloud-benchmark-target.mjs';
import {benchmarkDurations,summarizeBenchmarkStage,summarizePairedBenchmark} from './cloud-benchmark-metrics.mjs';
import {sha256} from './comparison-files.mjs';
const deny=()=>{throw Error('Paired benchmark unconfirmed');},plain=x=>x&&Object.getPrototypeOf(x)===Object.prototype;
const id=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(x);
const keys=(x,names)=>{if(!plain(x)||Object.keys(x).length!==names.length||names.some(n=>!Object.hasOwn(x,n)))deny();};
export function validatePairedBenchmark(input){
 const v=plain(input)&&!Object.hasOwn(input,'jobs')?{...input,jobs:100}:input;
 keys(v,['allowPairedReplay','runId','deadlineMs','jobs','origin','allowedOrigins','commit','image','workspace','authMode','authFile','cloud','target','fixtureSHA256','identity']);
 if(v.allowPairedReplay!==true||!Number.isInteger(v.jobs)||v.jobs<20||v.jobs>200||!Number.isInteger(v.deadlineMs)||v.deadlineMs<600000||v.deadlineMs>1200000||
  !id(v.runId)||!/^[-A-Za-z0-9_/]{1,100}$/.test(v.workspace??'')||!['token','client-credentials'].includes(v.authMode)||
  typeof v.authFile!=='string'||!isAbsolute(v.authFile)||!v.authFile.endsWith('.json')||!/^[a-f0-9]{64}$/.test(v.fixtureSHA256??''))deny();
 validateCloudSmoke({allowReplaySmoke:true,runId:v.runId,origin:v.origin,allowedOrigins:v.allowedOrigins,commit:v.commit,image:v.image,authMode:v.authMode});
 validateEvidenceConfiguration({mode:'collect-readonly',runId:v.runId,deadlineMs:600000,sources:{},cloud:v.cloud},true);
 keys(v.identity,['path','sha256']);if(typeof v.identity.path!=='string'||!isAbsolute(v.identity.path)||!v.identity.path.endsWith('.json')||!/^[a-f0-9]{64}$/.test(v.identity.sha256??''))deny();
 keys(v.target,['workerName','controllerName','workerUID','controllerUID','workerSpecSHA256','controllerSpecSHA256','initialReplicas','nodeNames']);
 benchmarkTarget({...v.target,runId:v.runId,namespace:v.cloud.namespace,imageDigest:v.image.split('@')[1]},{});
 return structuredClone(v);
}
export async function runPairedBenchmark(input,io){
 let c,target,phase='configuration',halt=false,n=0,requests=0,terminalAttempted=false,reserved=false,reason='unconfirmed',fixture;
 const stages=[],errors=[],created=[],seen=new Set();let restoration={workerRestored:false,controllerRestored:false,state:'not_observed'},lastNow=-Infinity;
 const fail=code=>{halt=true;reason=code;deny();};
 const check=()=>{if(halt)deny();const now=io.now();if(!Number.isFinite(now)||now<lastNow)fail('clock_invalid_or_backwards');lastNow=now;
  if(io.signal?.aborted||io.remaining(false)<=0)fail(io.signal?.aborted?'cancelled':'deadline_exceeded');};
 async function retain(name,value){await io.json(name,value);}
 async function api(op,token,expected,end=Infinity,onBoundary=()=>{}){
  check();if(io.now()>=end)fail('job_observation_deadline');const ordinal=++n,began=io.now();
  await retain('operations/'+String(ordinal).padStart(6,'0')+'-intent.json',{phase,request:op,state:'intent',noCredentialStored:true});
  check();if(io.now()>=end)fail('job_observation_deadline');requests++;onBoundary();
  let r;try{r=await io.request(c.origin,op,token,Math.max(1,Math.min(15000,Math.floor(Math.min(end-io.now(),io.remaining(false))))),io.signal);}
  catch{r={networkEntered:true,status:null,code:'boundary_threw_outcome_unknown',bodyComplete:false,bodyTruncated:false,rawEntityBase64:null,body:null};}
  const {body,...raw}=r;
  // Persist original response before interpreting it. Other in-flight requests
  // finish their receipt even after a sibling latches further dispatch off.
  try{await retain('operations/'+String(ordinal).padStart(6,'0')+'-observed.json',{...raw,elapsedMs:io.now()-began});}
  catch{halt=true;reason='response_persistence_unknown';throw Error('unconfirmed');}
  const durationMs=io.now()-began;
  const ok=r.code==='response_received'&&r.bodyComplete&&!r.bodyTruncated&&r.status===expected&&durationMs>=0&&Number.isFinite(durationMs)&&io.now()<end&&io.remaining(false)>0&&!io.signal?.aborted;
  if(!ok){halt=true;reason='http_failed_or_unknown';}
  return {ok,body:body??null,durationMs,raw};
 }
 async function expect(op,token,status){const r=await api(op,token,status);if(!r.ok||!plain(r.body))fail('asset_request_failed_or_unknown');return r.body;}
 const slots=n=>Array.from({length:n},(_,index)=>({index,submission:{state:'not_sent'},job:null}));
 const stageError=(s,where,index)=>{halt=true;s.errors.push({phase:where,index,code:reason});};
 async function pool(count,fn){let next=0;await Promise.all(Array.from({length:8},async()=>{while(!halt&&!io.signal?.aborted&&next<count){const i=next++;try{await fn(i);}catch{halt=true;}}}));}
 function associated(job,slot,stage){
  if(!plain(job)||job.id!==slot.submission.jobId||job.workspace!==c.workspace||job.created_by!==stage.actor.principal||!same(job.input,slot.input))return false;
  if(!['queued','running','failed','succeeded'].includes(job.status))return false;
  if(!['succeeded','failed'].includes(job.status))return true;
  if(job.status==='failed')return true;
  const rows=job.result?.results;
  return job.snapshot?.application?.id===stage.appId&&job.snapshot?.suite?.id===stage.suiteId&&same(job.snapshot.application.data,stage.applicationData)&&same(job.snapshot.suite.data,fixture.suite)&&
   job.result?.gate==='passed'&&job.result.score===100&&job.result.total===10&&job.result.passed===10&&job.result.errors===0&&job.result.criticalFailures===0&&Array.isArray(rows)&&rows.length===10&&
   new Set(rows.map(x=>x.caseId)).size===10&&rows.every(x=>fixture.suite.cases.some(c=>c.id===x.caseId)&&x.status==='passed');
 }
 async function submit(slot,stage,token,warm){
  const label=(warm?'warm':'measured')+'-'+slot.index;
  slot.input={appId:stage.appId,suiteId:stage.suiteId,candidate:'paired-'+c.runId+'-'+stage.index+'-'+label,commitRef:c.commit,source:'replay',promptVersion:'v1',scenario:'passing'};
  let r;try{r=await api({method:'POST',route:'/jobs',body:slot.input,key:'paired-'+c.runId+'-'+stage.index+'-'+label},token,202,Infinity,()=>{slot.submission={state:'unknown',commitState:'unknown'};});}
  catch{stageError(stage,'submit',slot.index);throw Error('unconfirmed');}
  const accepted=r.ok&&plain(r.body)&&id(r.body.id)&&r.body.status==='queued'&&r.body.replayed===false&&!seen.has(r.body.id);
  slot.submission={state:accepted?'accepted':!r.raw.networkEntered?'not_sent':r.raw.code==='response_received'&&r.raw.status!==202?'failed_response':'unknown',commitState:accepted?'accepted':!r.raw.networkEntered?'not_sent':'unknown',durationMs:r.durationMs,httpStatus:r.raw.status,jobId:accepted?r.body.id:null,response:r.body};
  if(!accepted){reason='submit_failed_or_unknown_or_duplicate';stageError(stage,'submit',slot.index);return;}
  seen.add(r.body.id);
 }
 async function observe(slot,stage,token){
  if(slot.submission.state!=='accepted'||halt)return;
  const end=io.now()+120000;
  for(let polls=0;polls<120;polls++){
   let r;try{r=await api({method:'GET',route:'/jobs/'+slot.submission.jobId},token,200,end);}
   catch{stageError(stage,'observe',slot.index);return;}
   if(r.body!==null)slot.job=structuredClone(r.body);
   if(!r.ok||!associated(slot.job,slot,stage)){reason='job_failed_or_unassociated';stageError(stage,'observe',slot.index);return;}
   if(['succeeded','failed'].includes(slot.job.status)){
    if(slot.job.status!=='succeeded'||!benchmarkDurations(slot.job).valid||!stage.targetBefore.workerIds.includes(slot.job.worker_id)){reason='job_failed_time_invalid_or_worker_unbound';stageError(stage,'job',slot.index);}return;
   }
   if(halt)return;check();await io.sleep(1000,false);check();
  }
  reason='job_observation_deadline';stageError(stage,'observe',slot.index);
 }
 try{
  c=validatePairedBenchmark(input);phase='reservation';await io.reserve(c);reserved=true;
  for(const [index,[round,replicas]]of [[1,1],[1,3],[2,3],[2,1]].entries())stages.push({index,round,replicas,requested:c.jobs,state:'not_started',tasks:slots(c.jobs),warmups:slots(5),reads:Array.from({length:200},(_,index)=>({index,state:'not_sent'})),errors:[],targetStable:false});
  phase='fixture';check();const f=await io.fixture();if(sha256(f.bytes)!==c.fixtureSHA256)fail('fixture_hash_changed');fixture=f.value;
  if(!plain(fixture?.application)||!plain(fixture?.suite)||fixture.suite.policy?.minScore!==95||fixture.suite.policy.maxLatencyMs!==null||fixture.suite.cases?.length!==10||new Set(fixture.suite.cases.map(x=>x.id)).size!==10)fail('fixture_invalid');
  phase='target-proof';check();target=await io.target(c);check();
  phase='target-prepare';await target.prepare();check();
  let auth;
  for(const s of stages){
   check();s.state='started';phase='scale-'+s.index;s.targetBefore=await target.scale(s.replicas);check();
   if(auth===undefined){phase='selected-credentials';auth=await io.authInputs(c);check();}
   phase='authenticate-'+s.index;const token=await io.authorize(auth,c,s.index);check();s.actor=declaredServiceActor(token,'contributor',c.workspace);
   phase='assets-'+s.index;s.applicationData={...fixture.application,name:'Paired replay '+c.runId+' stage '+s.index};
   const app=await expect({method:'POST',route:'/applications',body:s.applicationData},token,201);if(!id(app.id))fail('invalid_application');s.appId=app.id;created.push({kind:'application',id:app.id,stage:s.index});
   const suite=await expect({method:'POST',route:'/suites',body:fixture.suite},token,201);if(!id(suite.id)||suite.version!==1)fail('invalid_suite');s.suiteId=suite.id;created.push({kind:'suite',id:suite.id,stage:s.index});
   phase='warmups-'+s.index;
   for(const slot of s.warmups){check();await submit(slot,s,token,true);if(halt)break;await observe(slot,s,token);}
   check();phase='measured-'+s.index;const began=io.now();
   await pool(c.jobs,i=>submit(s.tasks[i],s,token,false));
   if(!halt)await pool(c.jobs,i=>observe(s.tasks[i],s,token));
   s.elapsedMs=io.now()-began;
   if(!halt){
    phase='history-'+s.index;await pool(200,async i=>{try{const r=await api({method:'GET',route:'/jobs',offset:(i%4)*25},token,200);s.reads[i]={index:i,state:r.ok&&Array.isArray(r.body)?'succeeded':'failed_or_unknown',durationMs:r.durationMs};if(s.reads[i].state!=='succeeded'){reason='history_failed_or_unknown';stageError(s,'history',i);}}
     catch{stageError(s,'history',i);}});
   }
   if(!halt){phase='target-end-'+s.index;s.targetAfter=await target.observeReady(s.replicas);s.targetStable=same(s.targetBefore,s.targetAfter);if(!s.targetStable){reason='worker_cohort_changed';stageError(s,'target',null);}}
   s.state=halt?'failed_or_unknown':'completed';await retain('stage-'+s.index+'.json',s);check();
   if(!summarizeBenchmarkStage(s).completeSuccessfulCohort)fail('incomplete_stage');
  }
  phase='runtime-stability';await io.verifyRuntime();check();
 }catch{halt=true;errors.push({phase,code:reason});}
 finally{
  if(target){try{restoration=await target.restore();}catch{restoration={workerRestored:false,controllerRestored:false,state:'restore_threw_unknown',retryAllowed:false};}}
 }
 const summary=summarizePairedBenchmark(stages,restoration),passed=Boolean(reserved&&!halt&&summary.passed&&!io.signal?.aborted&&io.remaining(true)>0);
 const report={...summary,passed,state:passed?'completed':reserved?'failed_or_unknown_retained':'refused_before_reservation',runId:c?.runId??null,origin:c?.origin??null,
  sourceCommit:c?.commit??null,image:c?.image??null,requests,stages,errors,created,retryAllowed:false,resumeAllowed:false,modelCallsRequested:0,actualProviderCallsIndependentlyMeasured:false,
  throughputRatio:passed?summary.throughputRatio:null,identityDeclarationIsNotAuthentication:true,cloudCostOrDeploymentAccepted:false};
 if(reserved||io.owned){try{terminalAttempted=true;await io.terminal(report);if(passed&&(io.signal?.aborted||io.remaining(true)<=0))return {...report,passed:false,evidenceState:'completion_deadline_or_cancellation'};}
  catch{return {...report,passed:false,evidenceState:'terminal_persistence_unknown',terminalAttempted};}}
 return report;
}
