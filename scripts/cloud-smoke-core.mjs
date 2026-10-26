// Full replay smoke protocol. Runtime IO is injected and import is inert.
// Creates only this run's app/suite/replay job; never reviews, deploys or retries.
import { isDeepStrictEqual } from 'node:util';
const id=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v),plain=v=>v&&Object.getPrototypeOf(v)===Object.prototype;
const deny=()=>{throw Error('Invalid explicit cloud smoke configuration');};
function origin(v){if(typeof v!=='string'||v.length>2048||/[\x00-\x20\x7f]/.test(v))deny();const u=new URL(v);if(u.protocol!=='https:'||u.origin!==v||u.username||u.password||u.port==='5193'||['localhost','127.0.0.1','0.0.0.0','[::1]'].includes(u.hostname))deny();return v;}
export function validateCloudSmoke(input){
 const keys=['allowReplaySmoke','origin','allowedOrigins','runId','commit','image','authMode'];
 if(!plain(input)||Object.keys(input).length!==keys.length||keys.some(k=>!Object.hasOwn(input,k))||input.allowReplaySmoke!==true)deny();
 origin(input.origin);if(!Array.isArray(input.allowedOrigins)||!input.allowedOrigins.length||input.allowedOrigins.length>20)deny();for(const v of input.allowedOrigins)origin(v);if(!input.allowedOrigins.includes(input.origin))deny();
 if(!id(input.runId)&&!/^cd-[1-9][0-9]{0,19}-[1-9][0-9]{0,5}$/.test(input.runId??'')||!/^[-a-zA-Z0-9_]{8,70}$/.test(input.runId??'')||
  !/^[a-f0-9]{40}$/.test(input.commit??'')||typeof input.image!=='string'||input.image.length>500||!/^[-a-zA-Z0-9.:/_]+@sha256:[a-f0-9]{64}$/.test(input.image)||!['token','client-credentials'].includes(input.authMode))deny();
 return {...input,allowedOrigins:[...input.allowedOrigins]};
}
export async function runCloudReplaySmoke(input,io){
 let c,phase='configuration',reserved=false,terminalAttempted=false,n=0,requests=0,observedBytes=0,code='unconfirmed',created={},start;
 const steps=[];
 const terminal=async r=>{terminalAttempted=true;await io.terminal(r);if(r.passed)check();return r;};
 const check=()=>{if(io.signal?.aborted){code='cancelled';throw Error('stopped');}const elapsed=io.now()-start;if(!Number.isFinite(elapsed)||elapsed<0||elapsed>=180000){code='deadline_exceeded_or_clock_invalid';throw Error('stopped');}};
 try{
  c=validateCloudSmoke(input);phase='reservation';await io.reserve(c);reserved=true;start=io.now();
  async function step(name,detail,fn){phase=name;check();const ordinal=++n;await io.intent(ordinal,{name,...detail});check();const value=await fn(ordinal);check();await io.result(ordinal,{name,state:'completed'});steps.push(name);return value;}
  const fixture=await step('fixture',{},()=>io.fixture());
  if(!plain(fixture?.application)||!plain(fixture?.suite)||fixture.suite.policy?.minScore!==95||!Array.isArray(fixture.suite.cases)||fixture.suite.cases.length!==10||new Set(fixture.suite.cases.map(v=>v.id)).size!==10)throw Error('invalid fixture');
  const token=await step('authentication',{mode:c.authMode},()=>io.authorize(c));
  if(typeof token!=='string'||token.length>16384||!/^[-A-Za-z0-9._~+/]+=*$/.test(token))throw Error('invalid token');
  async function api(name,path,method,body,expected,key,deadline=start+180000){
   const op={path,method,...(body?{body}:{}),...(key?{key}:{})};
   return step(name,{request:op},async ordinal=>{
    if(io.now()>=deadline){code='job_observation_deadline';throw Error('late dispatch');}
    requests++;const r=await io.request(c.origin,op,token,Math.max(1,Math.min(15000,Math.floor(Math.min(start+180000,deadline)-io.now()))),io.signal);
    await io.observed(ordinal,r);check();observedBytes+=r.decodedEntityBytes;
    if(!Number.isSafeInteger(observedBytes)||observedBytes>8*1024*1024){code='evidence_size_limit';throw Error('bounded');}
    if(io.now()>=deadline){code='job_observation_deadline';throw Error('late response');}
    if(r.code!=='response_received'||!r.bodyComplete||r.bodyTruncated||r.status!==expected||!plain(r.body)){code='api_response_not_confirmed';throw Error('unconfirmed');}
    return r.body;
   });
  }
  const applicationData={...fixture.application,name:'Cloud smoke '+c.runId};
  const application=await api('create-application','applications','POST',applicationData,201);
  if(!id(application.id))throw Error('invalid application');created.applicationId=application.id;
  const suite=await api('create-suite','suites','POST',fixture.suite,201);if(!id(suite.id))throw Error('invalid suite');created.suiteId=suite.id;
  const candidate='smoke-'+c.runId,key='smoke-'+c.runId,inputJob={appId:application.id,suiteId:suite.id,candidate,commitRef:c.commit,source:'replay',promptVersion:'v1',scenario:'passing'};
  const queued=await api('submit-replay','jobs','POST',inputJob,202,key);if(!id(queued.id)||queued.status!=='queued')throw Error('invalid job');created.jobId=queued.id;
  const observeStart=io.now();let job;
  for(let i=0;i<240;i++){
   if(io.now()-observeStart>=120000){code='job_observation_deadline';throw Error('not complete');}
   job=await api('observe-'+i,'jobs/'+queued.id,'GET',null,200,undefined,observeStart+120000);
   if(job.id!==queued.id||!isDeepStrictEqual(job.input,inputJob))throw Error('job association');
   if(['succeeded','failed'].includes(job.status))break;
   if(!['queued','running'].includes(job.status))throw Error('invalid state');
   check();await io.sleep(500,io.signal);
  }
  const ids=fixture.suite.cases.map(v=>v.id),sameCases=rows=>Array.isArray(rows)&&rows.length===10&&new Set(rows.map(v=>v.caseId??v.id)).size===10&&rows.every(v=>ids.includes(v.caseId??v.id));
  if(job?.status!=='succeeded'||job.snapshot?.application?.id!==application.id||job.snapshot?.suite?.id!==suite.id||!isDeepStrictEqual(job.snapshot.application.data,applicationData)||!isDeepStrictEqual(job.snapshot.suite.data,fixture.suite)||!sameCases(job.snapshot.suite.data.cases)||
   job.result?.gate!=='passed'||job.result.score!==100||job.result.total!==10||job.result.passed!==10||job.result.errors!==0||job.result.criticalFailures!==0||!sameCases(job.result.results)||job.result.results.some(v=>v.status!=='passed')){code='replay_not_passed';throw Error('not passed');}
  phase='final-evidence';check();await io.retainJob(job);check();
  return await terminal({formatVersion:1,state:'completed',passed:true,runId:c.runId,origin:c.origin,commit:c.commit,image:c.image,declaredIdentityNotLiveAttestation:true,
   source:'replay',modelCallsRequested:0,actualProviderCallsIndependentlyMeasured:false,created,steps,requests,independentReviewOrDeployment:false,
   limitations:'One selected-actor replay flow only; not human approval, model quality, live identity/TLS, maximum capacity, scaling or deployment proof.'});
 }catch{
  if(io.reservationOwned===true)reserved=true;
  const r={formatVersion:1,state:reserved?'failed_or_unknown_retained':'refused_before_reservation',passed:false,phase,code,runId:c?.runId??null,created,steps,requests,resumeAllowed:false,retryAllowed:false};
  if(terminalAttempted)return {...r,evidenceState:'terminal_persistence_unknown'};
  if(reserved){try{return await terminal(r);}catch{return {...r,evidenceState:'terminal_persistence_unknown'};}}
  return r;
 }
}
