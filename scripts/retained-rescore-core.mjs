// Complete imported-rescore protocol; importing does no filesystem/auth/network.
import { createHash } from 'node:crypto';
import { isDeepStrictEqual as same } from 'node:util';
import { prepareRetained,retainedId,validateImported } from './retained-rescore-input.mjs';
const deny=()=>{throw Error('Retained rescore refused or unconfirmed');};
export function validateRetainedConfig(c){
 const keys=['allowImportedRescore','origin','allowedOrigins','workspace','runId','commit','image','authMode','suiteRevision','deadlineMs'];
 if(!c||Object.getPrototypeOf(c)!==Object.prototype||Object.keys(c).length!==keys.length||keys.some(k=>!Object.hasOwn(c,k))||c.allowImportedRescore!==true||!retainedId(c.runId)||
  !/^[a-f0-9]{40}$/.test(c.commit??'')||!/^sha256:[a-f0-9]{64}$/.test(c.image??'')||!['token','client-credentials'].includes(c.authMode)||!['v2.1','v2.2'].includes(c.suiteRevision)||
  !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(c.workspace??'')||!Number.isInteger(c.deadlineMs)||c.deadlineMs<1000||c.deadlineMs>600000||
  !Array.isArray(c.allowedOrigins)||!c.allowedOrigins.length||c.allowedOrigins.length>8||new Set(c.allowedOrigins).size!==c.allowedOrigins.length||!c.allowedOrigins.includes(c.origin))deny();
 for(const text of c.allowedOrigins){let u;try{u=new URL(text);}catch{deny();}if(u.protocol!=='https:'||u.origin!==text||u.username||u.password||u.port==='5193'||['localhost','127.0.0.1','0.0.0.0','[::1]','[::]'].includes(u.hostname))deny();}
 return structuredClone(c);
}
export async function runRetainedRescore(config,io,runtime){
 const c=validateRetainedConfig(config),start=io.now(),end=start+c.deadlineMs;let last=start,n=0,requests=0,phase='reservation',status='failed_or_unknown',terminalWritten=false,report,source,selected,sourceHash,suiteId;
 const states=[],before=[];const check=()=>{const now=io.now();if(io.signal?.aborted||!Number.isFinite(now)||now<start||now<last||now>=end)deny();last=now;return Math.max(1,Math.floor(end-now));};
 const api=async(op,token,secrets)=>{check();if(n>=1024)deny();const ordinal=++n;await io.intent(ordinal,{kind:'request',...op,status:'started_or_unknown',automaticRetry:false});check();
  const r=await io.request(c.origin,op,token,Math.min(15000,check()),io.signal,secrets);if(r?.networkEntered)requests++;await io.observed(ordinal,r);check();
  await io.result(ordinal,{status:r?.status??null,code:r?.code??'unknown',networkEntered:r?.networkEntered===true});check();
  if(r?.code!=='response_received'||!r.bodyComplete||r.bodyTruncated||r.credentialEchoWithheld||r.status!==(op.method==='GET'?200:op.route==='/suites'?201:202))deny();return r.body;};
 const makeReport=()=>({schemaVersion:'1.0',runId:c.runId,kind:'CLOUD_IMPORTED_RESCORE',origin:c.origin,workspace:c.workspace,sourceCommit:c.commit,image:c.image,identityDeclaredNotLiveAttestation:true,
  sourceReportSha256:sourceHash,sourceReportOriginal:structuredClone(source),evaluatorVersion:selected.evaluatorVersion,definition:structuredClone(selected.definition),suiteId:suiteId??null,
  denominator:10,modelCallsRequested:0,actualProviderCallsIndependentlyMeasured:false,sourceDeclaration:'real (retained claim, not independent provider verification)',
  latencyMeaning:'Copied retained sample latency, not new cloud/provider latency. New imported Worker duration is separate, not capacity evidence.',
  shadowOnly:true,reviewer:'calibration_pending',semanticConclusion:'NOT_ASSESSED',
  runs:structuredClone(states),originalJobsBefore:structuredClone(before),originalJobsUnchangedObserved:false,passed:false,protocolPassed:false,
  passMeaning:'Only complete target-input/snapshot/output/evaluator/unchanged-source contract verification, not a passing rule gate or semantic quality.',
  limitation:'Posthoc imported re-scoring of retained claims, NOT a new/blind provider test, model improvement, independent human approval or deployment. Original scores/answers/reasons are retained unchanged; missing/unexecuted cases stay in the ten-case denominator. Commit/image declarations and hashes are not runtime attestation or signatures.'});
 try{
  await io.reserve(c);check();phase='inputs';const auth=await io.authInputs(c),known=io.secrets(auth,c);
  if(!Array.isArray(known)||known.length!==1||typeof known[0]!=='string'||!known[0].length||known[0].length>16384)deny();
  const input=await io.source(known);source=input.value;sourceHash=input.sha256;if(!/^[a-f0-9]{64}$/.test(sourceHash??''))deny();
  selected=prepareRetained(source,c,runtime);states.push(...selected.runs);
  await io.retain('source-metadata.json',{sha256:sourceHash,retainedSourceClaim:'real',originalProviderExecutionIndependentlyVerified:false});check();
  phase='authentication';await io.intent(++n,{kind:'authentication',mode:c.authMode,status:'started_or_unknown',automaticRetry:false});check();
  const token=await io.authenticate(auth,c,n);check();if(typeof token!=='string'||token.length>16384||!/^[-A-Za-z0-9._~+/]+=*$/.test(token))deny();
  await io.result(n,{authentication:'token_returned_not_identity_attestation',tokenAndResponseBodyWithheld:true});check();const secrets=[...new Set([...known,token])];
  await io.retainSource(input,secrets);check();
  phase='original_jobs_before';for(const original of source.runs){const value=await api({method:'GET',route:'/jobs/'+original.id},token,secrets);before.push(structuredClone(value));if(!same(value,original))deny();}
  await io.retain('original-jobs-before.json',before);check();phase='child_suite';
  const child=await api({method:'POST',route:'/suites',body:selected.definition},token,secrets);
  if(!retainedId(child?.id)||child.id===source.suiteId||child.version!==selected.parentVersion+1||
   !same(Object.fromEntries(Object.entries(child).filter(([k])=>!['id','version'].includes(k))),selected.definition))deny();suiteId=child.id;
  for(const state of states){
   phase='import_'+state.promptVersion;const input={appId:source.appId,suiteId,candidate:'retained-'+state.promptVersion+'-rescore-'+c.suiteRevision+'-'+c.runId,commitRef:c.commit,source:'imported',outputs:structuredClone(state.outputs)};
   runtime.domain.jobSchema.parse(input);const key='rescore-'+createHash('sha256').update(sourceHash+state.originalJobId+suiteId+selected.evaluatorVersion+c.runId).digest('hex');
   state.state='started_or_unknown';await io.retain(state.promptVersion+'-reservation.json',{originalJobId:state.originalJobId,input,key,sourceReportSha256:sourceHash,automaticRetry:false});check();
   const q=await api({method:'POST',route:'/jobs',body:input,key},token,secrets);if(!retainedId(q?.id)||source.runs.some(j=>j.id===q.id)||states.some(s=>s.importedId===q.id)||q.status!=='queued'||q.replayed!==false)deny();state.importedId=q.id;
   for(;;){
    phase='observe_'+state.promptVersion;const job=await api({method:'GET',route:'/jobs/'+q.id},token,secrets);state.importedJob=structuredClone(job);state.resultValidated=false;
    validateImported(job,{id:q.id,input,workspace:c.workspace,application:selected.application,suiteId,version:child.version,definition:selected.definition,expectedResult:state.expectedResult});
    if(job.status==='failed'){state.state='failed';deny();}
    if(job.status==='succeeded'){state.resultValidated=true;state.state='completed';await io.retain(state.promptVersion+'-imported-job.json',job);check();break;}
    await io.sleep(Math.min(500,check()),io.signal);check();
   }
  }
  phase='original_jobs_after';const after=[];for(const original of source.runs){const value=await api({method:'GET',route:'/jobs/'+original.id},token,secrets);after.push(structuredClone(value));if(!same(value,original))deny();}
  await io.retain('original-jobs-after.json',after);check();phase='report';report=makeReport();Object.assign(report,{originalJobsUnchangedObserved:true,passed:true,protocolPassed:true,
   allDerivedRuleGatesPassed:states.every(s=>s.importedJob?.result?.gate==='passed')});await io.retain('report.json',report);check();status='completed';
 }catch{status='failed_or_unknown';}
 finally{
  if(io.reservationOwned){
   if(!report&&selected){try{report=makeReport();report.error={phase,code:'failed_or_unknown',automaticRetry:false};await io.retain('report.json',report);}catch{}}
   try{await io.terminal({runId:c.runId,status,phase,requests,modelCallsRequested:0,actualProviderCallsIndependentlyMeasured:false,automaticRetry:false,
    states:states.map(s=>({originalJobId:s.originalJobId,promptVersion:s.promptVersion,state:s.state,importedId:s.importedId??null,resultValidated:s.resultValidated})),shadowOnly:true,reviewer:'calibration_pending'});if(status==='completed')check();terminalWritten=true;}
   catch{status='evidence_unknown';}
  }
 }
 return {runId:c.runId,status,terminalWritten,requests,report};
}
