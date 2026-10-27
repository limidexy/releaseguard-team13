// Read-only evidence protocol. Import is inert; external boundaries are supplied
// by the guarded CLI. Collection success never means free billing or shutdown.
import {isDeepStrictEqual as same} from 'node:util';
import {isAbsolute,basename} from 'node:path';
import {sha256,strictComparisonJSON} from './comparison-files.mjs';
const deny=()=>{throw Error('Cloud evidence refused');};
const text=(v,n=200)=>typeof v==='string'&&v.length>0&&v.length<=n&&!/[\x00-\x1f\x7f]/.test(v);
const name=v=>typeof v==='string'&&/^[a-z][a-z0-9-]{0,61}[a-z0-9]$/.test(v);
const id=v=>typeof v==='string'&&/^[a-zA-Z0-9-]{1,100}$/.test(v);
const date=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT/.test(v)&&Number.isFinite(Date.parse(v));
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function exact(v,keys){if(!v||Object.getPrototypeOf(v)!==Object.prototype||Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))deny();}
export const evidenceRoles=Object.freeze(['cloud-acceptance.json','cloud-benchmark.json','cloud-benchmark-derived.json','cloud-autoscale.json',
 'cloud-autoscale-first-capacity-failed.json','cloud-autoscale-second-cold-metric-failed.json','cloud-autoscale-worker-pause.json','cloud-backup-restore.json',
 'cloud-power-state.json','prompt-comparison-real-1791722840080.json']);
export const evidenceWarning='Zero compute nodes does not stop storage, static IP, load balancer, registry or other retained-resource credit consumption. Billing data can lag.';
export function validateEvidenceConfiguration(v,powerOnly=false){
 exact(v,['mode','runId','deadlineMs','sources','cloud']);
 if(!['archive-offline','collect-readonly'].includes(v.mode)||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v.runId??'')||
  !Number.isInteger(v.deadlineMs)||v.deadlineMs<1000||v.deadlineMs>600000||powerOnly&&v.mode!=='collect-readonly')deny();
 const roles=powerOnly?[]:evidenceRoles.filter(k=>k!=='cloud-benchmark-derived.json'&&(v.mode==='archive-offline'||k!=='cloud-power-state.json'));
 exact(v.sources,roles);const paths=new Set();
 for(const x of Object.values(v.sources)){
  exact(x,['path','sha256','experimentId','observedAt','sourceCommit']);
  if(!text(x.path,4096)||!isAbsolute(x.path)||!x.path.endsWith('.json')||paths.has(x.path)||!sha(x.sha256)||!text(x.experimentId,200)||
   x.observedAt!==null&&!date(x.observedAt)||x.sourceCommit!==null&&!/^[a-f0-9]{40}$/.test(x.sourceCommit))deny();paths.add(x.path);
 }
 if(v.mode==='archive-offline'){if(v.cloud!==null)deny();}
 else{
  const c=v.cloud;exact(c,['project','zone','cluster','clusterId','namespace','namespaceUid','context','account','gcloudExecutable','kubectlExecutable','pluginExecutable','gcloudConfigDirectory','kubeconfigFile']);
  if(!name(c.project)||!name(c.cluster)||!name(c.namespace)||!/^[a-z]+-[a-z]+\d-[a-z]$/.test(c.zone)||!id(c.clusterId)||!id(c.namespaceUid)||
   c.context!==`gke_${c.project}_${c.zone}_${c.cluster}`||!text(c.account)||!/^[a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+$/.test(c.account))deny();
  for(const [key,base]of [['gcloudExecutable','gcloud'],['kubectlExecutable','kubectl'],['pluginExecutable','gke-gcloud-auth-plugin']])if(!text(c[key],4096)||!isAbsolute(c[key])||basename(c[key])!==base)deny();
  for(const key of ['gcloudConfigDirectory','kubeconfigFile'])if(!text(c[key],4096)||!isAbsolute(c[key]))deny();
  if(!c.kubeconfigFile.endsWith('.json'))deny();
 }
 return structuredClone(v);
}
export function credentialLike(value){return /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+\S+|\b(?:gsk_|sk-proj-)[A-Za-z0-9_-]{12,}|"(?:access_token|refresh_token|client_secret|password|private_key|client-key-data)"\s*:)/i.test(value);}
export function validateEvidenceSource(bytes,descriptor){
 if(bytes.length>2*1024*1024||sha256(bytes)!==descriptor.sha256||credentialLike(bytes.toString('utf8')))deny();
 const value=strictComparisonJSON(bytes);if(!value||typeof value!=='object'||Array.isArray(value))deny();
 if(value.at!==undefined&&descriptor.observedAt!==null&&value.at!==descriptor.observedAt||value.sourceCommit!==undefined&&descriptor.sourceCommit!==null&&value.sourceCommit!==descriptor.sourceCommit||
  value.experimentId!==undefined&&value.experimentId!==descriptor.experimentId||value.runId!==undefined&&value.runId!==descriptor.experimentId)deny();
 return value;
}
// All reported stages stay visible. Invalid/missing numbers never disappear from
// the denominator; failed cohorts can be archived but cannot establish benefit.
export function deriveEvidenceBenchmark(b,sourceSHA256){
 const stages=Array.isArray(b.stages)?b.stages:[],expected=[[1,1],[1,3],[2,3],[2,1]];
 const paired=stages.length===4&&stages.every((s,i)=>s?.round===expected[i][0]&&s?.replicas===expected[i][1]);
 const observations=stages.map((s,i)=>({index:i,round:s?.round??null,replicas:s?.replicas??null,reportedJobsPerSecond:s?.jobsPerSecond??null,
  numericValid:typeof s?.jobsPerSecond==='number'&&Number.isFinite(s.jobsPerSecond)&&s.jobsPerSecond>=0,requested:s?.requested??null,completed:s?.completed??null,failed:s?.failed??null,errors:s?.errors??null}));
 const numeric=paired&&observations.every(s=>s.numericValid),summaries=[1,3].map(replicas=>{
  const values=observations.filter(s=>s.replicas===replicas).map(s=>s.reportedJobsPerSecond).sort((a,b)=>a-b);
  return {replicas,rounds:values.length,medianJobsPerSecond:numeric?(values[0]/2+values[1]/2):null,minJobsPerSecond:numeric?values[0]:null,maxJobsPerSecond:numeric?values[1]:null};
 });
 const complete=paired&&stages.every(s=>Number.isInteger(s.requested)&&s.requested>0&&s.completed===s.requested&&s.failed===0&&Array.isArray(s.errors)&&s.errors.length===0);
 const first=summaries[0].medianJobsPerSecond,second=summaries[1].medianJobsPerSecond,ratio=numeric&&first>0?second/first:null;
 return {formatVersion:1,source:'cloud-benchmark.json',sourceSHA256,observedAt:b.at??null,sourceCommit:b.sourceCommit??null,
  derivation:'Arithmetic mean of the two central observations for even-count median. Original raw observations and old aggregates are unchanged.',
  observations,pairedShapeVerified:paired,numericComplete:numeric,completeSuccessfulCohort:complete,summaries,throughputRatio:Number.isFinite(ratio)?ratio:null,
  scalingBenefitProven:false,maximumCapacityProven:false,limitations:'Two short paired rounds only; descriptive arithmetic, not stable/proportional/sustained scaling. Failed or unknown cohorts are not successful comparisons.'};
}
export function validateEvidenceKubeconfig(k,c){
 if(k?.apiVersion!=='v1'||k.kind!=='Config'||k['current-context']!==c.context||k.contexts?.length!==1||k.clusters?.length!==1||k.users?.length!==1)deny();
 const context=k.contexts[0],cluster=k.clusters[0],user=k.users[0];
 if(context.name!==c.context||context.context?.cluster!==cluster.name||context.context?.user!==user.name||context.context.namespace!==undefined&&context.context.namespace!==c.namespace)deny();
 const node=cluster.cluster;if(!node||Object.keys(node).some(x=>!['server','certificate-authority-data','insecure-skip-tls-verify'].includes(x))||node['insecure-skip-tls-verify']===true)deny();
 const server=new URL(node.server);if(server.protocol!=='https:'||server.username||server.password||server.port||server.pathname!=='/'||server.search||server.hash||/^(?:localhost|127\.|0\.|\[::1\])/.test(server.hostname))deny();
 const ca=node['certificate-authority-data'];if(typeof ca!=='string'||!ca.length||ca.length>65536||Buffer.from(ca,'base64').toString('base64')!==ca)deny();
 const auth=user.user;if(!auth||Object.keys(auth).some(x=>x!=='exec'))deny();const e=auth.exec;
 if(!e||!['client.authentication.k8s.io/v1','client.authentication.k8s.io/v1beta1'].includes(e.apiVersion)||e.command!==c.pluginExecutable||
  e.args!==undefined&&(!Array.isArray(e.args)||e.args.length)||e.env!==undefined&&(!Array.isArray(e.env)||e.env.length)||e.interactiveMode!==undefined&&e.interactiveMode!=='Never')deny();
 return {server:server.origin,caSHA256:sha256(Buffer.from(ca,'base64'))};
}
export function evidenceGroup(c,url){
 if(typeof url!=='string')deny();const m=/^https:\/\/www.googleapis.com\/compute\/v1\/projects\/([a-z0-9-]+)\/zones\/([a-z0-9-]+)\/(?:instanceGroups|instanceGroupManagers)\/([a-z0-9-]+)$/.exec(url);
 if(!m||m[1]!==c.project||m[2]!==c.zone||!name(m[3]))deny();return {name:m[3],zone:m[2]};
}
const clusterProjection='json(name,id,selfLink,location,status,currentNodeCount,endpoint,masterAuth.clusterCaCertificate,nodePools.name,nodePools.status,nodePools.instanceGroupUrls,nodePools.config.machineType,nodePools.config.diskSizeGb,nodePools.autoscaling)';
export function evidenceCommand(c,kind,ref){
 const g=args=>({command:c.gcloudExecutable,args:[...args,'--project='+c.project,'--account='+c.account,'--quiet']}),k=args=>({command:c.kubectlExecutable,args:['--kubeconfig='+c.kubeconfigFile,'--context='+c.context,'--request-timeout=20s',...args]});
 if(kind==='cluster')return g(['container','clusters','describe',c.cluster,'--zone='+c.zone,'--format='+clusterProjection]);
 if(kind==='instances')return g(['compute','instances','list','--format=json(name,status,zone,selfLink)']);
 if(kind==='mig'||kind==='members'){const r=evidenceGroup(c,ref);return g(['compute','instance-groups','managed',kind==='mig'?'describe':'list-instances',r.name,'--zone='+r.zone,
  '--format='+(kind==='mig'?'json(name,selfLink,instanceGroup,targetSize,status.isStable,currentActions)':'json(instance,instanceStatus,currentAction)')]);}
 if(kind==='namespace')return k(['get','namespace',c.namespace,'-o','json']);
 if(kind==='nodes')return k(['get','nodes','-o','json']);
 if(kind==='pvcs')return k(['-n',c.namespace,'get','pvc','-o','json']);
 deny();
}
function clusterGroups(value,c,kube){
 if(value?.name!==c.cluster||value.id!==c.clusterId||value.location!==c.zone||value.status!=='RUNNING'||
  !['zones','locations'].some(part=>value.selfLink==='https://container.googleapis.com/v1/projects/'+c.project+'/'+part+'/'+c.zone+'/clusters/'+c.cluster)||
  kube.server!=='https://'+value.endpoint||sha256(Buffer.from(value.masterAuth?.clusterCaCertificate??'','base64'))!==kube.caSHA256||!Array.isArray(value.nodePools)||!value.nodePools.length||value.nodePools.length>10)deny();
 const groups=[],poolNames=new Set();for(const p of value.nodePools){if(!name(p?.name)||poolNames.has(p.name)||!Array.isArray(p.instanceGroupUrls)||!p.instanceGroupUrls.length)deny();poolNames.add(p.name);
  for(const url of p.instanceGroupUrls){evidenceGroup(c,url);if(groups.includes(url))deny();groups.push(url);}}
 if(groups.length>20)deny();return groups.sort();
}
export async function collectEvidencePower(c,kube,call,clock){
 const began=clock(),first=await call('cluster'),groups=clusterGroups(first,c,kube),states=[];
 const instances=await call('instances');if(!Array.isArray(instances)||instances.length>10000)deny();
 for(const x of instances)if(!name(x?.name)||!text(x.status)||x.selfLink!=='https://www.googleapis.com/compute/v1/projects/'+c.project+'/zones/'+x.zone?.split('/').at(-1)+'/instances/'+x.name||
  !x.zone?.startsWith('https://www.googleapis.com/compute/v1/projects/'+c.project+'/zones/'))deny();
 const namespace=await call('namespace');if(namespace?.apiVersion!=='v1'||namespace.kind!=='Namespace'||namespace.metadata?.name!==c.namespace||namespace.metadata.uid!==c.namespaceUid)deny();
 const nodes=await call('nodes'),pvcs=await call('pvcs');if(nodes?.apiVersion!=='v1'||nodes.kind!=='NodeList'||!text(nodes.metadata?.resourceVersion)||pvcs?.apiVersion!=='v1'||pvcs.kind!=='PersistentVolumeClaimList'||!text(pvcs.metadata?.resourceVersion)||
  !Array.isArray(nodes.items)||!Array.isArray(pvcs.items)||nodes.items.length>10000||pvcs.items.length>10000)deny();
 for(const n of nodes.items)if(typeof n?.spec?.providerID!=='string'||!n.spec.providerID.startsWith('gce://'+c.project+'/'+c.zone+'/'))deny();
 for(const p of pvcs.items)if(p?.metadata?.namespace!==c.namespace||!id(p.metadata.uid)||!text(p.metadata.name))deny();
 for(const ref of groups){
  const before=await call('mig',ref),members=await call('members',ref),after=await call('mig',ref),r=evidenceGroup(c,ref);
  const valid=x=>x?.name===r.name&&x.instanceGroup===ref&&evidenceGroup(c,x.selfLink).name===r.name&&Number.isInteger(x.targetSize)&&x.targetSize>=0&&typeof x.status?.isStable==='boolean';
  if(!valid(before)||!valid(after)||!Array.isArray(members)||members.length>10000)deny();
  for(const x of members)if(typeof x?.instance!=='string'||!x.instance.startsWith('https://www.googleapis.com/compute/v1/projects/'+c.project+'/zones/'+c.zone+'/instances/'))deny();
  states.push({ref,before,after,members,unchanged:same(before,after)});
 }
 const last=await call('cluster'),lastGroups=clusterGroups(last,c,kube),ended=clock();
 const actionsClear=x=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length>0&&Object.values(x).every(n=>Number.isInteger(n)&&n===0);
 const stable=ended>=began&&same(groups,lastGroups)&&same(first.nodePools,last.nodePools)&&last.nodePools.every(p=>p.status==='RUNNING')&&states.every(x=>x.unchanged&&x.after.status.isStable&&actionsClear(x.before.currentActions)&&actionsClear(x.after.currentActions)),
  active=nodes.items.length>0||states.some(x=>x.members.length>0||x.after.targetSize>0),countConflict=[first.currentNodeCount,last.currentNodeCount].some(n=>n!==undefined&&n!==null&&n!==0);
 const stopped=active?false:stable&&!countConflict?true:null;
 return {formatVersion:1,project:c.project,cluster:c.cluster,zone:c.zone,clusterId:c.clusterId,namespace:c.namespace,namespaceUid:c.namespaceUid,
  computeStopped:stopped,computeScope:'Selected cluster only; bounded non-atomic observations, not future absence or a project-wide stop guarantee',
  collectedAt:new Date().toISOString(),window:{monotonicBeganMs:began,monotonicEndedMs:ended},stableObserved:stable,legacyCurrentNodeCount:{first:first.currentNodeCount??null,last:last.currentNodeCount??null,deprecated:true},
  nodePools:last.nodePools,managedGroups:states,kubernetesNodeListVersion:nodes.metadata.resourceVersion,kubernetesNodes:nodes.items,pvcListVersion:pvcs.metadata.resourceVersion,instances,dataVolumes:pvcs.items.map(p=>({name:p.metadata.name,uid:p.metadata.uid,status:p.status?.phase??null,capacity:p.status?.capacity??null})),
  paidUpgradeAuthorized:false,credentialOwnershipIndependentlyVerified:false,shutdownActionExecuted:false,warning:evidenceWarning};
}
export async function runEvidenceProtocol(c,io){
 const {powerOnly=false,kube=null}=io;
 let phase='reservation',sequence=0,terminalAttempted=false;const sources=new Map(),entries=[];
 const terminal=async value=>{terminalAttempted=true;await io.json('terminal.json',{...value,fileAloneIsNotProofOfSuccessfulExitOrPhysicalDurability:true});};
 try{
  await io.reserve({formatVersion:1,runId:c.runId,mode:c.mode,powerOnly,state:'started'});
  const check=()=>{if(io.signal?.aborted||io.remaining()<=0)deny();};
  phase='selected-sources';for(const [role,descriptor]of Object.entries(c.sources)){check();const bytes=await io.read(descriptor.path);check();const value=validateEvidenceSource(bytes,descriptor);sources.set(role,{descriptor,bytes,value});}
  let power;
  if(c.mode==='collect-readonly'){
   phase='readonly-collection';const call=async(kind,ref)=>{
    check();const number=String(++sequence).padStart(4,'0'),command=evidenceCommand(c.cloud,kind,ref);
    await io.json('operations/'+number+'-intent.json',{kind,state:'intent',...command});check();const raw=await io.command(command);
    const out=typeof raw?.stdout==='string'?raw.stdout:'',err=typeof raw?.stderr==='string'?raw.stderr:'',withheld=credentialLike(out+'\n'+err);
    await io.json('operations/'+number+'-observed.json',{kind,status:Number.isInteger(raw?.status)?raw.status:null,signal:raw?.signal??null,errorCode:raw?.error?'COMMAND_FAILED_OR_UNKNOWN':null,truncated:raw?.outputTruncated===true,
     stdoutSHA256:sha256(out),stderrSHA256:sha256(err),rawStdout:withheld?null:out,rawStderr:withheld?null:err,credentialLikeContentWithheld:withheld,
     processEncoding:'UTF8 decoded stdout/stderr, not provider wire or original subprocess byte attestation; replacement characters rejected'});
    check();if(raw?.status!==0||raw.signal||raw.error||raw.outputTruncated||withheld||out.includes('\ufffd')||err.includes('\ufffd')||Buffer.byteLength(out)+Buffer.byteLength(err)>2*1024*1024)deny();
    const result=strictComparisonJSON(Buffer.from(out));await io.json('operations/'+number+'-result.json',{kind,state:'parsed'});return result;
   };
   power=await collectEvidencePower(c.cloud,kube,call,io.clock);check();await io.json('cloud-power-state.json',power);
  }
  phase='archive';if(!powerOnly){
   for(const [role,{descriptor,bytes}]of sources){check();await io.put(role,bytes);entries.push({role,sha256:sha256(bytes),size:bytes.length,provenance:descriptor,sourceBinding:'operator-selected identity checked where present; not independent attestation',rawUnchanged:true});}
   if(c.mode==='collect-readonly')entries.push({role:'cloud-power-state.json',sha256:sha256(JSON.stringify(power,null,2)+'\n'),size:Buffer.byteLength(JSON.stringify(power,null,2)+'\n'),provenance:{experimentId:c.runId,observedAt:power.collectedAt},rawUnchanged:false,newReadOnlyObservation:true});
   const benchmark=sources.get('cloud-benchmark.json'),derived=deriveEvidenceBenchmark(benchmark.value,sha256(benchmark.bytes));check();
   const derivedBytes=Buffer.from(JSON.stringify(derived,null,2)+'\n');await io.put('cloud-benchmark-derived.json',derivedBytes);
   entries.push({role:'cloud-benchmark-derived.json',sha256:sha256(derivedBytes),size:derivedBytes.length,sourceSHA256:sha256(benchmark.bytes),derived:true});
   if(entries.length!==10||!same(entries.map(x=>x.role).sort(),[...evidenceRoles].sort()))deny();
   await io.verifyArchives(entries);
   await io.json('archive-manifest.json',{formatVersion:1,runId:c.runId,entries,notOneExperiment:true,historicalPowerClaimRevalidated:false,
    historicalFailuresAndOldAggregatesPreserved:true,hashesAreNotSignatures:true,warning:evidenceWarning});
  }
  phase='source-stability';for(const [,{descriptor,bytes}]of sources){check();if(sha256(await io.read(descriptor.path))!==sha256(bytes))deny();}
  check();await io.verifyRuntime();check();const result={formatVersion:1,runId:c.runId,status:'completed',mode:c.mode,powerOnly,readOnlyCommands:sequence,sourceFiles:sources.size,
   computeStopped:c.mode==='collect-readonly'?power.computeStopped:null,historicalPowerClaimRevalidated:false,archiveFiles:entries.length,modelCallsRequested:0,shutdownActionExecuted:false,
   meaning:'Evidence workflow completed, not provider quality, free quota, shutdown execution or deployment acceptance',warning:evidenceWarning};
  await terminal(result);return result;
 }catch{
  const result={formatVersion:1,runId:c.runId,status:io.owned?'failed_or_unknown_retained':'refused_before_reservation',phase,readOnlyCommandIntents:sequence,retryAllowed:false,resumeAllowed:false};
  if(io.owned&&!terminalAttempted)try{await terminal(result);}catch{return {...result,evidenceState:'terminal_persistence_unknown'};}
  else if(terminalAttempted)return {...result,evidenceState:'terminal_persistence_unknown'};
  return result;
 }
}
