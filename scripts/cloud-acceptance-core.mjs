// Full acceptance protocol. No environment, network or filesystem at import.
// A valid denied-review command CAN mutate a broken target: separate explicit
// acknowledgement is mandatory. This module never runs against a target in CI.
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { validateCloudSmoke } from './cloud-smoke-core.mjs';
const plain=v=>v&&Object.getPrototypeOf(v)===Object.prototype,id=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const deny=()=>{throw Error('Acceptance refused');};
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>JSON.stringify(k)+':'+canonical(x)).join(',')+'}':JSON.stringify(v);
const digest=v=>createHash('sha256').update(canonical(v)).digest('hex');
export function validateCloudAcceptance(v){
 const keys=['allowAcceptance','allowNegativeReviewProbe','origin','allowedOrigins','runId','commit','image','workspace','authMode'];
 if(!plain(v)||Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k))||v.allowAcceptance!==true||v.allowNegativeReviewProbe!==true||!id(v.runId)||typeof v.workspace!=='string'||!/^[-A-Za-z0-9_/]{1,100}$/.test(v.workspace)||!['tokens','client-credentials'].includes(v.authMode))deny();
 const checked=validateCloudSmoke({allowReplaySmoke:true,origin:v.origin,allowedOrigins:v.allowedOrigins,runId:v.runId,commit:v.commit,image:v.image,authMode:'token'});
 return {...v,allowedOrigins:checked.allowedOrigins};
}
// A fail-closed configuration check ONLY, not JWT verification/authentication.
// The real server must still validate signatures/issuer/audience/expiry/roles.
export function declaredServiceActor(token,role,workspace){
 if(typeof token!=='string'||token.length>16384||!/^[-A-Za-z0-9_]+\.[-A-Za-z0-9_]+\.[-A-Za-z0-9_]{16,}$/.test(token))deny();
 const [head,payload]=token.split('.'),h=JSON.parse(Buffer.from(head,'base64url')),p=JSON.parse(Buffer.from(payload,'base64url'));
 if(!plain(h)||!['RS256','HS256'].includes(h.alg)||!plain(p)||p.service!==true||p.role!==role||p.workspace!==workspace||typeof p.sub!=='string'||!p.sub.length||p.sub.length>150||typeof p.principal!=='string'||!p.principal.length||p.principal.length>150)deny();
 return {sub:p.sub,principal:p.principal,workspace:p.workspace,role:p.role};
}
export async function runCloudAcceptance(input,io){
 let c,phase='configuration',reserved=false,terminalAttempted=false,start,n=0,requests=0,observedBytes=0,code='unconfirmed';const steps=[],checks=[],created={};
 const check=()=>{const elapsed=io.now()-start;if(io.signal?.aborted){code='cancelled';deny();}if(!Number.isFinite(elapsed)||elapsed<0||elapsed>=180000){code='deadline_exceeded_or_clock_invalid';deny();}};
 const terminal=async r=>{terminalAttempted=true;await io.terminal(r);if(r.passed)check();return r;};
 try{
  c=validateCloudAcceptance(input);phase='reservation';await io.reserve(c);reserved=true;start=io.now();
  async function step(name,detail,fn){phase=name;check();const ordinal=++n;await io.intent(ordinal,{name,...detail});check();const value=await fn(ordinal);check();await io.result(ordinal,{name,state:'completed'});steps.push(name);return value;}
  const fixture=await step('fixture',{},()=>io.fixture());
  if(!plain(fixture?.application)||!plain(fixture?.suite)||fixture.suite.policy?.minScore!==95||fixture.suite.cases?.length!==10||new Set(fixture.suite.cases.map(x=>x.id)).size!==10)deny();
  const auth=await step('selected-credentials',{},()=>io.authInputs(c));
  const contributor=await step('authenticate-contributor',{mode:c.authMode},ordinal=>io.authenticate('contributor',auth.contributor,c,ordinal));
  const viewer=await step('authenticate-viewer',{mode:c.authMode},ordinal=>io.authenticate('viewer',auth.viewer,c,ordinal));
  code='invalid_declared_service_identity';const actor=declaredServiceActor(contributor,'contributor',c.workspace),observer=declaredServiceActor(viewer,'viewer',c.workspace);if(actor.sub===observer.sub||contributor===viewer)deny();code='unconfirmed';
  const parts=contributor.split('.');parts[2]=(parts[2][0]==='A'?'B':'A')+parts[2].slice(1);const credentials={contributor,viewer,tampered:parts.join('.'),selectedClientSecrets:c.authMode==='client-credentials'?[auth.contributor.clientSecret,auth.viewer.clientSecret]:[]};
  async function api(name,path,method,body,expected,key,deadline=start+180000){
   const op={name,path,method,...(body?{body}:{}),...(key?{key}:{})};
   return step(name,{request:op},async ordinal=>{
    if(io.now()>=deadline){code='observation_deadline';deny();}requests++;
    const r=await io.request(c.origin,op,credentials,Math.max(1,Math.min(15000,Math.floor(Math.min(deadline,start+180000)-io.now()))),io.signal,c.allowNegativeReviewProbe);
    await io.observed(ordinal,r);check();observedBytes+=r.decodedEntityBytes;
    if(!Number.isSafeInteger(observedBytes)||observedBytes>8*1024*1024){code='evidence_size_limit';deny();}
    if(io.now()>=deadline){code='observation_deadline';deny();}
    if(r.code!=='response_received'||!r.bodyComplete||r.bodyTruncated||r.status!==expected||name!=='admin'&&!plain(r.body)){code='api_response_not_confirmed';deny();}return r.body;
   });
  }
  const passed=name=>checks.push({name,passed:true});
  await api('anonymous','applications','GET',null,401);passed('Unauthenticated API is rejected');
  await api('tampered','applications','GET',null,401);passed('Tampered JWT is rejected');
  await api('viewer','applications','POST',fixture.application,403);passed('Viewer cannot write');
  const applicationData={...fixture.application,name:'Cloud acceptance '+c.runId},a=await api('application','applications','POST',applicationData,201);if(!id(a.id))deny();created.applicationId=a.id;
  const s=await api('suite','suites','POST',fixture.suite,201);if(!id(s.id))deny();created.suiteId=s.id;
  const jobInput={appId:a.id,suiteId:s.id,candidate:'acceptance-'+c.runId,commitRef:c.commit,source:'replay',promptVersion:'v1',scenario:'passing'},key='acceptance-'+c.runId;
  const q=await api('submit','jobs','POST',jobInput,202,key);if(!id(q.id)||q.status!=='queued'||q.replayed!==false)deny();created.jobId=q.id;
  // Deliberate second planned idempotency assertion, NEVER a failed-call retry.
  const duplicate=await api('duplicate','jobs','POST',jobInput,200,key);if(duplicate.id!==q.id||duplicate.replayed!==true)deny();passed('Duplicate submission returns the same job');
  const began=io.now();let job;
  for(let i=0;i<240;i++){
   if(io.now()-began>=120000){code='observation_deadline';deny();}job=await api('observe','jobs/'+q.id,'GET',null,200,undefined,began+120000);
   if(job.id!==q.id||job.workspace!==c.workspace||job.created_by!==actor.principal||!isDeepStrictEqual(job.input,jobInput))deny();
   if(['succeeded','failed'].includes(job.status))break;if(!['queued','running'].includes(job.status))deny();check();await io.sleep(500,io.signal);
  }
  phase='replay-evidence';const expectedIds=fixture.suite.cases.map(x=>x.id),rows=job?.result?.results;
  if(job?.status!=='succeeded'||job.snapshot?.application?.id!==a.id||job.snapshot?.suite?.id!==s.id||!isDeepStrictEqual(job.snapshot.application.data,applicationData)||!isDeepStrictEqual(job.snapshot.suite.data,fixture.suite)||job.result?.gate!=='passed'||job.result.score!==100||job.result.total!==10||job.result.passed!==10||job.result.errors!==0||job.result.criticalFailures!==0||!Array.isArray(rows)||rows.length!==10||new Set(rows.map(x=>x.caseId)).size!==10||rows.some(x=>!expectedIds.includes(x.caseId)||x.status!=='passed'))deny();
  passed('Ten-case replay executes and gate passes');await step('retain-job',{},()=>io.retain('job.json',job));
  const note='Automated trial acceptance; pending independent human review.',release=await api('release','releases','POST',{jobId:q.id,note},201);
  if(!id(release.id)||release.status!=='pending'||release.version!==1)deny();created.releaseId=release.id;
  const before=await api('before','evidence/'+release.id,'GET',null,200),r=before.release,audit=before.audit;
  if(!plain(r)||r.id!==release.id||r.job_id!==q.id||r.workspace!==c.workspace||r.created_by!==job.created_by||r.requested_by!==actor.principal||r.status!=='pending'||r.version!==1||r.reviewed_by!==null||r.reviewed_at!==null||r.review_note!==null||r.request_note!==note||!isDeepStrictEqual(r.evidence,job)||before.evidenceDigest!==digest(job)||!Array.isArray(audit)||audit.length!==1||audit[0].action!=='ReleaseRequested'||audit[0].actor!==actor.sub||audit[0].workspace!==c.workspace||audit[0].entity_id!==release.id||!isDeepStrictEqual(audit[0].details,{jobId:q.id,note,previousJobId:null,previousReleaseId:null,evidenceDigest:digest(job)}))deny();
  await step('retain-before',{},()=>io.retain('before.json',before));
  await api('deniedReview','releases/'+release.id+'/review','POST',{decision:'approved',version:1,note:'Automated negative authorization check'},403);passed('Service identity cannot approve a release');
  const after=await api('after','evidence/'+release.id,'GET',null,200);if(!isDeepStrictEqual(after,before))deny();await step('retain-after',{},()=>io.retain('after.json',after));passed('Audit evidence remains pending, not fabricated approval');
  await api('crossOrigin','applications','POST',fixture.application,403);passed('Cross-origin mutation rejected');
  await api('admin','auth/admin/','GET',null,404);passed('Public identity administration is blocked');
  return await terminal({formatVersion:1,state:'completed',passed:true,runId:c.runId,origin:c.origin,commit:c.commit,image:c.image,created,steps,checks,requests,source:'replay',modelCallsRequested:0,actualProviderCallsIndependentlyMeasured:false,declaredIdentityNotLiveAttestation:true,humanApproval:false,limitations:'HTTP acceptance of this explicit run only; not live identity attestation, semantic model quality, load/scaling, deployment or human approval. Hashes are not signatures.'});
 }catch{
  if(io.reservationOwned===true)reserved=true;const r={formatVersion:1,state:reserved?'failed_or_unknown_retained':'refused_before_reservation',passed:false,phase,code,runId:c?.runId??null,created,steps,checks,requests,retryAllowed:false,resumeAllowed:false};
  if(terminalAttempted)return {...r,evidenceState:'terminal_persistence_unknown'};if(reserved){try{return await terminal(r);}catch{return {...r,evidenceState:'terminal_persistence_unknown'};}}return r;
 }
}
