// Inactive complete six-service lifecycle. All effects are supplied explicitly.
// No default entry, environment, credential, process or network reads on import.
// Per-object conditional changes are not a fleet transaction. Unknown writes
// stop candidate work and are never resent or forcibly recovered.
import {isDeepStrictEqual as same} from 'node:util';
import {isAbsolute,basename} from 'node:path';
import {deploymentRoles as roles,deploymentOwnerAnnotation as marker,captureDeploymentObject as capture,deploymentObjectRef as ref,planDeploymentClaim,planDeploymentUpdate,planDeploymentRestore,planDeploymentRelease,verifyDeploymentPreview,verifyDeploymentChange} from './deploy-object-core.mjs';
import {validateCloudSmoke} from './cloud-smoke-core.mjs';
const deny=()=>{throw Error('Deployment lifecycle refused or unconfirmed');},copy=x=>structuredClone(x),plain=x=>x&&Object.getPrototypeOf(x)===Object.prototype;
const exact=(x,keys)=>{if(!plain(x)||!same(Object.keys(x).sort(),[...keys].sort()))deny();};
const image=x=>typeof x==='string'&&x.length<=500&&/^[-A-Za-z0-9.:/_]+@sha256:[a-f0-9]{64}$/.test(x),commit=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
export function validateDeploy(input){
 exact(input,['allowDeployment','isolatedAdminWindow','runId','deadlineMs','sourceCommit','image','proveRollback','cloud','render','allowedOrigins','authFile']);
 if(input.allowDeployment!==true||input.isolatedAdminWindow!==true||!image(input.image)||!commit(input.sourceCommit)||typeof input.proveRollback!=='boolean'||!Number.isInteger(input.deadlineMs)||input.deadlineMs<900000||input.deadlineMs>1800000||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(input.runId??''))deny();
 const x=input.cloud;exact(x,['project','zone','cluster','clusterId','namespace','namespaceUid','context','account','gcloudExecutable','kubectlExecutable','pluginExecutable','gcloudConfigDirectory','kubeconfigFile']);
 if(!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(x.project??'')||!/^[a-z][a-z0-9-]{0,61}[a-z0-9]$/.test(x.cluster??'')||!/^[-A-Za-z0-9]{1,100}$/.test(x.clusterId??'')||!/^[-A-Za-z0-9]{1,100}$/.test(x.namespaceUid??'')||x.namespace!=='releaseguard'||!/^[a-z]+-[a-z]+\d-[a-z]$/.test(x.zone??'')||x.context!==`gke_${x.project}_${x.zone}_${x.cluster}`||!/^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+$/.test(x.account??''))deny();
 for(const [key,name]of [['gcloudExecutable','gcloud'],['kubectlExecutable','kubectl'],['pluginExecutable','gke-gcloud-auth-plugin']])if(typeof x[key]!=='string'||!isAbsolute(x[key])||basename(x[key])!==name)deny();
 for(const path of [x.gcloudConfigDirectory,x.kubeconfigFile,input.authFile])if(typeof path!=='string'||!isAbsolute(path)||/[\x00-\x1f\x7f]/.test(path))deny();
 if(!x.kubeconfigFile.endsWith('.json')||!input.authFile.endsWith('.json')||basename(input.authFile).startsWith('.env'))deny();
 const r=input.render;exact(r,['origin','issuer','jwks','clockSkewBoundMs','internalCA','trialSmall','environment']);
 if(!Number.isInteger(r.clockSkewBoundMs)||r.clockSkewBoundMs<0||r.clockSkewBoundMs>=10000||typeof r.internalCA!=='boolean'||typeof r.trialSmall!=='boolean'||!['gcp-trial','unconfirmed'].includes(r.environment))deny();
 for(const v of [r.issuer,r.jwks]){if(typeof v!=='string'||/[\x00-\x20\x7f]/.test(v))deny();const u=new URL(v);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)deny();}
 validateCloudSmoke({allowReplaySmoke:true,origin:r.origin,allowedOrigins:input.allowedOrigins,runId:input.runId,commit:input.sourceCommit,image:input.image,authMode:'client-credentials'});
 return copy(input);
}
export const deployRefs=Object.freeze([ref('ConfigMap','rg-config'),...roles.flatMap(name=>[ref('Deployment',name),ref('Service',name)])]);
const key=r=>r.kind+'/'+r.name;
function healthy(d){
 const n=d.spec?.replicas,status=d.status,generation=d.metadata?.generation;
 if(!Number.isInteger(n)||n<1||!Number.isInteger(generation)||generation<1||
    !['observedGeneration','replicas','readyReplicas','availableReplicas','updatedReplicas'].every(k=>Number.isInteger(status?.[k])&&status[k]>=0)||
    status.observedGeneration<generation)return false;
 // Minimum availability is not a completed rollout: old/surge replicas must
 // not allow a smoke check or final success against a mixed-version fleet.
 if(['replicas','readyReplicas','availableReplicas','updatedReplicas'].some(k=>status[k]!==n))return false;
 // terminatingReplicas is version/feature-dependent. Never invent it when
 // absent, but do not disregard an explicit outstanding termination either.
 for(const k of ['terminatingReplicas','unavailableReplicas'])if(Object.hasOwn(status,k)&&status[k]!==0)return false;
 if(status.conditions!==undefined){
  if(!Array.isArray(status.conditions))return false;
  if(status.conditions.some(c=>c?.type==='Progressing'&&(c.status==='False'||c.reason==='ProgressDeadlineExceeded')||c?.type==='ReplicaFailure'&&c.status==='True'))return false;
 }
 return true;
}
function identity(d){const containers=d.spec?.template?.spec?.containers;if(!Array.isArray(containers)||containers.length!==1||containers[0].name!==d.metadata.name||!image(containers[0].image)||!commit(d.metadata.annotations?.['releaseguard/source']))deny();return {role:d.metadata.name,image:containers[0].image,source:d.metadata.annotations['releaseguard/source']};}
function manifests(documents,c){
 if(!Array.isArray(documents)||documents.length!==13)deny();const map=new Map();
 for(const original of documents){const d=copy(original),r=ref(d.kind,d.metadata?.name);if(d.apiVersion!==r.apiVersion||d.metadata?.namespace!==r.namespace||Object.keys(d.metadata).some(k=>!['name','namespace','labels','annotations'].includes(k))||d.metadata.annotations&&Object.hasOwn(d.metadata.annotations,marker)||map.has(key(r)))deny();
  if(r.kind==='Deployment'){if(d.spec?.template?.spec?.containers?.length!==1||d.spec.template.spec.containers[0].name!==r.name||d.spec.template.spec.containers[0].image!==c.image)deny();d.metadata.annotations={...d.metadata.annotations,'releaseguard/source':c.sourceCommit};}
  d.metadata.annotations={...d.metadata.annotations,[marker]:c.runId};map.set(key(r),d);
 }
 if(!deployRefs.every(r=>map.has(key(r))))deny();return map;
}
function creationProjection(snapshot){
 const s=copy(snapshot);delete s.uid;delete s.resourceVersion;delete s.observationSHA256;delete s.checksum;
 if(s.ref.kind==='Service')for(const k of ['clusterIP','clusterIPs','ipFamilies','ipFamilyPolicy'])delete s.fields.spec.value[k];
 s.context.managedFields.value=s.context.managedFields.value.map(e=>{const v=copy(e);delete v.time;return v;}).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
 return s;
}
function createdSnapshot(r,actual,preview,runId){
 const s=capture(r,actual),p=copy(preview);p.metadata={...p.metadata,uid:'preview-only',resourceVersion:'preview-only'};
 if(s.fields.annotations.value?.[marker]!==runId||!same(creationProjection(s),creationProjection(capture(r,p))))deny();return s;
}
export async function runDeploy(input,io){
 let c,phase='configuration',sequence=0,reserved=false,terminalAttempted=false,start,changed=false;const rows=[],stages=[],errors=[];
 const terminal=async value=>{terminalAttempted=true;await io.json('terminal.json',value);return value;};
 const check=clean=>{const elapsed=io.now()-start;if(!Number.isFinite(elapsed)||elapsed<0||elapsed>=c.deadlineMs-(clean?0:360000)||(!clean&&io.signal?.aborted)||io.cleanupSignal?.aborted)deny();};
 async function call(name,detail,fn,{clean=false,row,mutation=false}={}){
  phase=name;check(clean);const n=String(++sequence).padStart(4,'0'),prefix=clean?'cleanup-operation-':'operations/';await io.json(prefix+n+'-intent.json',{name,...detail,mutation,noRetry:true});check(clean);
  if(mutation){row.unknown=true;changed=true;}
  const value=await fn();await io.json(prefix+n+'-observed.json',{name,value});check(clean);return value;
 }
 async function get(row,clean=false){const d=await call('get',{ref:row.ref},()=>io.get(row.ref,clean),{clean});return d===null?null:{raw:d,snapshot:capture(row.ref,d)};}
 async function owned(row,clean=false){const current=await get(row,clean);if(!current||!row.last)deny();planDeploymentRelease(row.last,current.snapshot,c.runId);return current;}
 async function patch(row,plan,clean=false){if(!plan)return row.last;
  const rawPreview=await call('patch-preview',{ref:row.ref,plan},()=>io.previewPatch(plan,clean),{clean}),preview={planChecksum:plan.checksum,observation:rawPreview};
  verifyDeploymentPreview(plan,preview);
  const actual=await call('patch',{ref:row.ref,planChecksum:plan.checksum},()=>io.patch(plan,clean),{clean,row,mutation:true});
  row.last=verifyDeploymentChange(plan,actual,preview);row.unknown=false;row.owned=row.last.fields.annotations.exists&&row.last.fields.annotations.value[marker]===c.runId;return row.last;
 }
 async function rollout(clean=false){
  for(const row of rows.filter(r=>r.ref.kind==='Deployment')){let ready=false;for(let i=0;i<480;i++){
   const current=await get(row,clean),expected=row.last??row.baseline;if(!current||!expected||current.snapshot.uid!==expected.uid||!same(current.snapshot.fields,expected.fields))deny();
   if(healthy(current.raw)){ready=true;break;}await io.sleep(500,clean);check(clean);
  }if(!ready)deny();}
 }
 async function smoke(label,selected,clean=false){
  const result=await call('smoke-'+label,{commit:selected.source,image:selected.image,source:'replay'},()=>io.smoke(label,selected,clean),{clean});
  if(result?.passed!==true||result.source!=='replay'||result.modelCallsRequested!==0||result.commit!==selected.source||result.image!==selected.image||result.independentReviewOrDeployment!==false)deny();stages.push({name:label,passed:true,jobId:result.created?.jobId??null});
 }
 async function applyCandidate(){
  for(const row of rows){check(false);const current=await get(row);
   if(!current){if(row.baseline||row.ref.kind==='Deployment')deny();row.present=false;continue;}
   if(row.owned){planDeploymentRelease(row.last,current.snapshot,c.runId);}
   else{if(!row.baseline||current.snapshot.uid!==row.baseline.uid||!same(current.snapshot.fields,row.baseline.fields))deny();await patch(row,planDeploymentClaim(current.snapshot,c.runId));}
  }
  // Keep the original image-before-SSA sequence, now with conditional patches.
  // It avoids treating an Update/Apply manager transition as interchangeable.
  for(const row of rows.filter(r=>r.ref.kind==='Deployment')){
   const current=await owned(row),desired=copy(current.raw);desired.spec.template.spec.containers[0].image=c.image;desired.metadata.annotations['releaseguard/source']=c.sourceCommit;
   await patch(row,planDeploymentUpdate(current.snapshot,desired,c.runId));
  }
  for(const row of rows){const doc=row.desired;
   if(!row.last){const preview=await call('create-preview',{ref:row.ref,document:doc},()=>io.previewCreate(doc)),actual=await call('create',{ref:row.ref},()=>io.create(doc),{row,mutation:true});
    row.last=createdSnapshot(row.ref,actual,preview,c.runId);row.created=true;row.owned=true;row.unknown=false;
   }else{
    const current=await owned(row),desired=await call('apply-preview',{ref:row.ref,document:doc},()=>io.previewApply(doc));
    await patch(row,planDeploymentUpdate(current.snapshot,desired,c.runId));
   }
  }
  await rollout();
 }
 async function restore(clean){
  let complete=true;
  for(const row of [...rows].reverse()){
   if(row.unknown){row.recovery='unknown_mutation_retained';complete=false;try{const observed=await get(row,clean);await io.json((clean?'cleanup-':'')+'unknown-'+key(row.ref).replace('/','-').toLowerCase()+'.json',{ref:row.ref,observation:observed?.raw??null,ownershipNotProven:true,noResend:true});}catch{}continue;}
   if(!row.last)continue;
   if(!row.owned){if(row.recovery!=='restored'&&row.recovery!=='deleted'){row.recovery='ownership_released_not_restored';complete=false;}continue;}
   try{
    const current=await owned(row,clean);
    if(row.baseline){await patch(row,planDeploymentRestore(row.baseline,row.last,current.snapshot,c.runId),clean);row.recovery='restored';}
    else{
     const deleted=await call('delete-created',{ref:row.ref,uid:current.snapshot.uid,resourceVersion:current.snapshot.resourceVersion},()=>io.deleteCreated(current.snapshot,clean),{clean,row,mutation:true});
     if(!(deleted?.kind==='Status'&&deleted.status==='Success')&&!(deleted?.kind===row.ref.kind&&deleted.metadata?.uid===current.snapshot.uid))deny();if(await get(row,clean)!==null)deny();row.unknown=false;row.owned=false;row.last=null;row.recovery='deleted';
    }
   }catch{complete=false;row.recovery=row.unknown?'unknown_mutation_retained':'foreign_or_unconfirmed_not_overwritten';}
  }
  return complete;
 }
 try{
  c=validateDeploy(input);start=io.now();phase='reservation';await io.reserve(c);reserved=true;check(false);await io.verifyRuntime();
  await call('target-preflight',{},()=>io.preflight());const docs=manifests(await call('render',{},()=>io.render(c)),c);
  for(const reference of deployRefs){const row={ref:reference,baseline:null,last:null,owned:false,created:false,unknown:false,desired:docs.get(key(reference)),recovery:null};rows.push(row);const current=await get(row);
   if(current){if(current.snapshot.fields.annotations.exists&&Object.hasOwn(current.snapshot.fields.annotations.value,marker))deny();row.baseline=current.snapshot;row.before=current.raw;
    if(reference.kind==='Deployment'&&(!healthy(current.raw)||!identity(current.raw)))deny();
   }else if(reference.kind==='Deployment')deny();
  }
  if(c.proveRollback&&rows.filter(r=>r.ref.kind==='Deployment').some(r=>identity(r.before).image===c.image))deny();
  await io.json('before.json',{rows:rows.map(r=>({ref:r.ref,snapshot:r.baseline,observation:r.before??null}))});
  const previous=identity(rows.find(r=>r.ref.kind==='Deployment'&&r.ref.name==='worker').before),candidate={source:c.sourceCommit,image:c.image};
  await applyCandidate();await smoke('candidate',candidate);
  if(c.proveRollback){if(!await restore(false))deny();await rollout();await smoke('previous',previous);await applyCandidate();await smoke('restored-candidate',candidate);}
  for(const row of rows){const current=await owned(row);if(row.ref.kind==='Deployment'){const i=identity(current.raw);if(i.image!==c.image||i.source!==c.sourceCommit||!healthy(current.raw))deny();}}
  await io.verifyRuntime();
  // Release only our marker. A partial release is explicitly not a fleet
  // transaction and cannot be reported as a successful recovery on failure.
  for(const row of rows){const current=await owned(row);await patch(row,planDeploymentRelease(row.last,current.snapshot,c.runId));row.recovery='released';}
  for(const row of rows){const current=await get(row);if(!current||current.snapshot.uid!==row.last.uid||!same(current.snapshot.fields,row.last.fields)||current.snapshot.fields.annotations.exists&&Object.hasOwn(current.snapshot.fields.annotations.value,marker)||row.ref.kind==='Deployment'&&!healthy(current.raw))deny();}
  check(false);const result={formatVersion:1,state:'completed',passed:true,runId:c.runId,sourceCommit:c.sourceCommit,image:c.image,stages,rollbackTested:c.proveRollback,objects:rows.map(r=>({ref:r.ref,uid:r.last.uid,created:r.created,ownerMarkerReleased:!r.owned})),modelCallsRequested:0,sourceIdentityOperatorDeclared:true,actualModelCallsIndependentlyMeasured:false,independentHumanApproval:false,actualAPIServerCompatibilityProven:false,perObjectNotFleetAtomic:true};
  return await terminal(result);
 }catch{
  if(io.owned===true)reserved=true;errors.push({phase,code:'FAILED_OR_UNKNOWN_RETAINED'});let recoveredPrevious=false;
  if(c&&reserved&&changed){try{const complete=await restore(true);if(complete){await rollout(true);await smoke('failure-recovery',identity(rows.find(r=>r.ref.kind==='Deployment'&&r.ref.name==='worker').before),true);recoveredPrevious=true;}}catch{errors.push({phase:'failure-recovery',code:'RECOVERY_UNCONFIRMED'});}}
  const result={formatVersion:1,state:reserved?'failed_or_unknown_retained':'refused_before_reservation',passed:false,runId:c?.runId??null,errors,stages,recoveredPrevious,objects:rows.map(r=>({ref:r.ref,uid:r.last?.uid??null,unknown:r.unknown,owned:r.owned,recovery:r.recovery})),resumeAllowed:false,retryAllowed:false,modelCallsRequested:0};
  if(terminalAttempted)return {...result,evidenceState:'terminal_persistence_unknown'};
  if(reserved)try{return await terminal(result);}catch{return {...result,evidenceState:'terminal_persistence_unknown'};}return result;
 }
}
