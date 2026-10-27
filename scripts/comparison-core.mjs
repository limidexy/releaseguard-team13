// Inactive coordinator. All filesystem, auth, clocks and HTTP capabilities are
// supplied by the guarded entry. No imported client, env defaults, retries or DB.
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual as same } from 'node:util';
import { comparisonReport,promptVersions,selectComparisonSuite,validateBaseline,validateComparisonJob } from './comparison-report.mjs';
const deny=()=>{throw Error('Comparison refused or unconfirmed');};
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
export function validateComparison(c){
 const fields=['origin','allowedOrigins','targetKind','runId','commit','image','workspace','source','suiteRevision','authMode','modelRequestBudget','deadlineMs'];
 if(!c||Object.keys(c).length!==fields.length||fields.some(k=>!Object.hasOwn(c,k))||
  !uuid(c.runId)||!/^[a-f0-9]{40}$/.test(c.commit??'')||!/^sha256:[a-f0-9]{64}$/.test(c.image??'')||
  c.workspace!=='comparison-'+c.runId||!['replay','real'].includes(c.source)||!['legacy','v2.1','v2.2'].includes(c.suiteRevision)||
  !['token','client-credentials','development'].includes(c.authMode)||!['cloud','local','isolated-acceptance'].includes(c.targetKind)||
  c.modelRequestBudget!==(c.source==='real'?20:0)||!Number.isInteger(c.deadlineMs)||c.deadlineMs<1000||c.deadlineMs>900000||
  !Array.isArray(c.allowedOrigins)||!c.allowedOrigins.length||c.allowedOrigins.length>8||new Set(c.allowedOrigins).size!==c.allowedOrigins.length||!c.allowedOrigins.includes(c.origin))deny();
 for(const value of c.allowedOrigins){let u;try{u=new URL(value);}catch{deny();}
  if(u.origin!==value||u.username||u.password||u.port==='5193'||c.targetKind==='cloud'&&(u.protocol!=='https:'||['localhost','127.0.0.1','0.0.0.0','[::1]','[::]'].includes(u.hostname))||
   c.targetKind!=='cloud'&&(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!/^\d+$/.test(u.port)||Number(u.port)<1024||u.port==='5193'||
    (c.targetKind==='isolated-acceptance'?u.port!=='5189':u.port==='5189')))deny();
 }
 if(c.targetKind!=='cloud'&&c.authMode==='client-credentials'||c.targetKind==='cloud'&&c.authMode==='development'||
  c.targetKind==='isolated-acceptance'&&(c.source!=='replay'||c.suiteRevision!=='legacy'||c.authMode!=='development'))deny();
 return structuredClone(c);
}
export async function runComparison(config,io,runtime){
 const c=validateComparison(config),states=promptVersions.map(promptVersion=>({promptVersion,state:'not_executed',modelRequestsReserved:0}));
 const runs=[],createdAt=new Date().toISOString(),start=io.now(),end=start+c.deadlineMs;let last=start;
 let phase='reservation',ordinal=0,requests=0,reserved=0,selected,baseline,baselineSHA256,appId,suiteId,status='failed_or_unknown',report,terminal=false;
 const issuedTokens=new Set();
 const remaining=()=>{const now=io.now(),ms=end-now;if(io.signal?.aborted||!Number.isFinite(ms)||ms<=0||now<start||now<last)deny();last=now;return Math.max(1,Math.floor(ms));};
 const request=async(op,token,knownSecrets)=>{
  remaining();if(ordinal>=1024)deny();const n=++ordinal;
  await io.intent(n,{kind:'request',...op,status:'started_or_unknown',automaticRetry:false});remaining();
  const r=await io.request(c.origin,op,token,Math.min(15000,remaining()),io.signal,knownSecrets);
  if(r?.networkEntered)requests++;await io.observed(n,r);remaining();
  await io.result(n,{status:r?.status??null,code:r?.code??'unknown',networkEntered:r?.networkEntered===true});remaining();
  if(r?.code!=='response_received'||!r.bodyComplete||r.bodyTruncated||r.credentialEchoWithheld||r.status!==(op.method==='GET'?200:op.route==='/jobs'?202:201))deny();
  return r.body;
 };
 const authenticate=async(name,auth)=>{
  remaining();const n=++ordinal;await io.intent(n,{kind:'authentication',name,authMode:c.authMode,status:'started_or_unknown',automaticRetry:false});remaining();
  const value=await io.authenticate(auth,c,name,n);remaining();
  if(typeof value!=='string'||!value.length||value.length>16384||!/^[-A-Za-z0-9._~+/]+=*$/.test(value))deny();
  issuedTokens.add(value);await io.result(n,{authentication:'token_returned_not_identity_attestation',tokenAndResponseBodyWithheld:true});remaining();return value;
 };
 try{
  await io.reserve(c);remaining();phase='inputs';
  const fixture=await io.fixture();selected=selectComparisonSuite(fixture,c.suiteRevision,runtime);
  const auth=await io.authInputs(c),knownSecrets=io.secrets(auth,c);remaining();
  if(!Array.isArray(knownSecrets)||knownSecrets.length!==1||typeof knownSecrets[0]!=='string'||!knownSecrets[0].length||knownSecrets[0].length>16384)deny();
  const secrets=()=>[...new Set([...knownSecrets,...issuedTokens])];
  const old=await io.baseline(knownSecrets);if(old){baseline=validateBaseline(old.value,selected.legacy,runtime);baselineSHA256=old.sha256;}
  phase='asset_authentication';const credential=await authenticate('assets',auth);
  phase='application';const app=await request({method:'POST',route:'/applications',body:fixture.application},credential,secrets());
  if(!uuid(app?.id)||!same(Object.fromEntries(Object.entries(app).filter(([k])=>k!=='id')),fixture.application))deny();appId=app.id;
  phase='suite';const s=await request({method:'POST',route:'/suites',body:selected.suite},credential,secrets());
  if(!uuid(s?.id)||s.version!==1||!same(Object.fromEntries(Object.entries(s).filter(([k])=>!['id','version'].includes(k))),selected.suite))deny();suiteId=s.id;
  for(const state of states){
   const {promptVersion}=state;phase=promptVersion+'_authentication';const token=await authenticate(promptVersion,auth);
   const input={appId,suiteId,candidate:'support-'+promptVersion+'-'+c.runId,commitRef:c.commit,source:c.source,promptVersion,scenario:'passing'};
   runtime.domain.jobSchema.parse(input);const key=randomUUID();phase=promptVersion+'_submission';
   const allocation=c.source==='real'?10:0;if(reserved+allocation>c.modelRequestBudget)deny();
   await io.retain(promptVersion+'-reservation.json',{promptVersion,input,key,modelRequestsReserved:allocation,totalReserved:reserved+allocation,
    budget:c.modelRequestBudget,status:'reserved_before_send',automaticRetry:false});remaining();reserved+=allocation;state.modelRequestsReserved=allocation;state.state='started_or_unknown';
   const q=await request({method:'POST',route:'/jobs',key,body:input},token,secrets());
   if(!uuid(q?.id)||q.status!=='queued'||q.replayed!==false||runs.some(j=>j.id===q.id))deny();
   state.id=q.id;phase=promptVersion+'_observation';
   for(;;){
    const job=await request({method:'GET',route:'/jobs/'+q.id},token,secrets());
    // Raw observed bytes were persisted first. Even a malformed/failed job stays
    // in the derived report as observed, never silently discarded or repaired.
    const previous=runs.findIndex(j=>j.id===q.id);if(previous<0)runs.push(structuredClone(job));else runs[previous]=structuredClone(job);
    state.jobAssociationValidated=false;state.resultValidated=false;
    validateComparisonJob(job,{id:q.id,input,workspace:c.workspace,application:fixture.application,suite:selected.suite},runtime);
    state.jobAssociationValidated=true;state.resultValidated=job.status==='succeeded';
    if(job.status==='failed'){state.state='failed';deny();}
    if(job.status==='succeeded'){
     await io.retain(promptVersion+'-job.json',job);remaining();
     if(job.result.errors!==0||c.source==='replay'&&job.result.gate!=='passed'){state.state='failed';deny();}
     state.state='completed';break;
    }
    await io.sleep(Math.min(c.source==='real'?2000:150,remaining()),io.signal);remaining();
   }
  }
  phase='report';report=comparisonReport({config:c,selected,runs,states,appId,suiteId,baseline,baselineSHA256,createdAt},runtime);
  remaining();await io.retain('report.json',report);remaining();status='completed';
 }catch{status='failed_or_unknown';}
 finally{
  if(io.reservationOwned){
   if(!report&&selected){try{report=comparisonReport({config:c,selected,runs,states,appId,suiteId,baseline,baselineSHA256,createdAt},runtime);
     report.error={phase,code:'failed_or_unknown',automaticRetry:false};await io.retain('report.json',report);}catch{}}
   const value={runId:c.runId,status,phase,requests,modelRequestBudget:c.modelRequestBudget,modelRequestsReserved:reserved,
    providerCallsIndependentlyMeasured:false,states,automaticRetry:false,semanticConclusion:'NOT_ASSESSED',shadowOnly:true,reviewer:'calibration_pending'};
   try{await io.terminal(value);if(status==='completed')remaining();terminal=true;}catch{status='evidence_unknown';}
  }
 }
 return {runId:c.runId,status,terminalWritten:terminal,requests,modelRequestsReserved:reserved,states,report};
}
