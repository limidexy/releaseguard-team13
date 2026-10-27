// Owned manual-comparison lifecycle. No default IO, environment or command.
// Each supplied read/patch boundary must persist its intent and observation.
// Per-object UID/resourceVersion tests are not a multi-object transaction,
// cryptographic ownership, hard-kill cleanup or a live KEDA compatibility proof.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as same} from 'node:util';
const deny=()=>{throw Error('Benchmark target unconfirmed');};
const owner='releaseguard.io/paired-benchmark',stepKey=owner+'-step';
const pauseKeys=['autoscaling.keda.sh/paused','autoscaling.keda.sh/paused-replicas','autoscaling.keda.sh/paused-scale-in','autoscaling.keda.sh/paused-scale-out'];
const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':x&&typeof x==='object'?'{'+Object.entries(x).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}':JSON.stringify(x);
export function benchmarkTargetHash(kind,spec){const copy=structuredClone(spec);if(kind==='worker')delete copy.replicas;return createHash('sha256').update(canonical(copy)).digest('hex');}
const ann=x=>x.metadata.annotations??{},pointer=k=>k.replace(/~/g,'~0').replace(/\//g,'~1');
const pauseMap=x=>Object.fromEntries(pauseKeys.filter(k=>Object.hasOwn(ann(x),k)).map(k=>[k,ann(x)[k]]));
const paused=x=>x.status?.conditions?.find(c=>c.type==='Paused')?.status==='True';
const fullPause=x=>ann(x)[pauseKeys[0]]==='true'||Object.hasOwn(ann(x),pauseKeys[1]);
function patchFor(before,changes,replicas){
 const p=[{op:'test',path:'/metadata/uid',value:before.metadata.uid},{op:'test',path:'/metadata/resourceVersion',value:before.metadata.resourceVersion},{op:'test',path:'/spec',value:before.spec}];
 if(!before.metadata.annotations)p.push({op:'add',path:'/metadata/annotations',value:{}});
 for(const [key,value]of Object.entries(changes)){
  if(Object.hasOwn(ann(before),key))p.push({op:'test',path:'/metadata/annotations/'+pointer(key),value:ann(before)[key]});
  if(value===undefined){if(Object.hasOwn(ann(before),key))p.push({op:'remove',path:'/metadata/annotations/'+pointer(key)});}
  else p.push({op:Object.hasOwn(ann(before),key)?'replace':'add',path:'/metadata/annotations/'+pointer(key),value});
 }
 if(replicas!==undefined)p.push({op:'replace',path:'/spec/replicas',value:replicas});
 return p;
}
export function benchmarkTarget(c,io){
 const name=x=>typeof x==='string'&&x.length<=63&&/^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(x),sha=x=>/^sha256:[a-f0-9]{64}$/.test(x??'');
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(c.runId??'')||!name(c.namespace)||c.workerName!=='worker'||!name(c.controllerName)||
  ![c.workerUID,c.controllerUID].every(x=>typeof x==='string'&&x.length>0&&x.length<=100)||![c.workerSpecSHA256,c.controllerSpecSHA256].every(x=>/^[a-f0-9]{64}$/.test(x??''))||
  !Number.isInteger(c.initialReplicas)||c.initialReplicas<0||c.initialReplicas>5||!sha(c.imageDigest)||!Array.isArray(c.nodeNames)||c.nodeNames.length!==2||new Set(c.nodeNames).size!==2||!c.nodeNames.every(name))deny();
 let originalWorker,originalController,originalHpas,prepareAttempted=false,prepared=false,pauseAttempted=false,pauseAck=false,workerAttempted=false,
  confirmed=null,attempted=null,sequence=0,restoreAttempted=false,restoreResult;
 const detail={prepared:false,pauseAttempted:false,pauseAcknowledged:false,workerMutationAttempted:false,restorationAttempted:false,restored:false};
 const check=cleanup=>{if(!Number.isFinite(io.now())||io.remaining(cleanup)<=0)deny();};
 const read=async(kind,cleanup=false)=>{check(cleanup);const x=await io.read(kind,cleanup);check(cleanup);return x;};
 function bound(x,kind){
  const worker=kind==='worker',uid=worker?c.workerUID:c.controllerUID,n=worker?c.workerName:c.controllerName;
  if(x?.metadata?.name!==n||x.metadata.namespace!==c.namespace||x.metadata.uid!==uid||x.metadata.deletionTimestamp||
   typeof x.metadata.resourceVersion!=='string'||!x.metadata.resourceVersion.length||x.metadata.resourceVersion.length>100||/[\x00-\x20\x7f]/.test(x.metadata.resourceVersion)||
   x.kind!==(worker?'Deployment':'ScaledObject')||x.apiVersion!==(worker?'apps/v1':'keda.sh/v1alpha1')||
   benchmarkTargetHash(kind,x.spec)!==(worker?c.workerSpecSHA256:c.controllerSpecSHA256))deny();
  if(worker){const containers=x.spec?.template?.spec?.containers,selected=containers?.find(v=>v.name==='worker');
   if(!Array.isArray(containers)||containers.length!==1||!selected||!['500m','0.5'].includes(selected.resources?.limits?.cpu)||selected.resources?.limits?.memory!=='384Mi'||x.spec.selector?.matchLabels?.app!=='worker'||
    c.initialReplicas===0&&selected.image?.split('@')[1]!==c.imageDigest)deny();}
  return x;
 }
 function hpas(list){
  if(!Array.isArray(list?.items)||list.items.length>1000||list.metadata?.continue)deny();
  const selected=list.items.filter(h=>h?.spec?.scaleTargetRef?.name===c.workerName&&h.spec.scaleTargetRef.kind==='Deployment');
  if(selected.some(h=>h.metadata?.namespace!==c.namespace||h.kind!=='HorizontalPodAutoscaler'||h.metadata.deletionTimestamp||
   !h.metadata.ownerReferences?.some(o=>o.kind==='ScaledObject'&&o.uid===c.controllerUID&&o.controller===true)))deny();return selected;
 }
 function ourController(x){bound(x,'controller');if(ann(x)[owner]!==c.runId||ann(x)[pauseKeys[0]]!=='true'||pauseKeys.slice(1).some(k=>Object.hasOwn(ann(x),k)))deny();return x;}
 function workerPair(x){
  bound(x,'worker');if(ann(x)[owner]!==c.runId)deny();
  const pair=[confirmed,attempted].find(p=>p&&ann(x)[stepKey]===p.step&&x.spec.replicas===p.replicas);if(!pair)deny();return pair;
 }
 async function wait(test,cleanup=false){
  const end=io.now()+150000;for(let n=0;n<300;n++){check(cleanup);if(io.now()>=end)deny();const value=await test();if(value)return value;await io.sleep(500,cleanup);}deny();
 }
 async function pausedProof(cleanup=false){const controller=ourController(await read('controller',cleanup)),selected=hpas(await read('hpas',cleanup));return paused(controller)&&selected.length===0;}
 async function ready(n,cleanup=false,owned=true){
  const worker=bound(await read('worker',cleanup),'worker');if(owned)workerPair(worker);
  if(worker.spec.replicas!==n)deny();
  const pods=await read('pods',cleanup),sets=await read('replicaSets',cleanup);
  if(!Array.isArray(pods?.items)||!Array.isArray(sets?.items)||pods.metadata?.continue||sets.metadata?.continue)deny();
  const setIds=new Set(sets.items.filter(r=>r.metadata?.namespace===c.namespace&&r.metadata.ownerReferences?.some(o=>o.kind==='Deployment'&&o.uid===c.workerUID&&o.controller===true)).map(r=>r.metadata.uid));
  if(pods.items.length!==n||pods.items.some(p=>p.metadata?.namespace!==c.namespace||p.metadata.deletionTimestamp||
   !p.metadata.ownerReferences?.some(o=>o.kind==='ReplicaSet'&&setIds.has(o.uid)&&o.controller===true)))return null;
  const snapshots=[];for(const p of pods.items){
   const s=p.status?.containerStatuses?.find(s=>s.name==='worker'),container=p.spec?.containers?.find(x=>x.name==='worker');
   if(!name(p.metadata.name)||typeof p.metadata.uid!=='string'||!p.metadata.uid||!c.nodeNames.includes(p.spec?.nodeName)||p.spec.hostname!==undefined&&p.spec.hostname!==p.metadata.name||
    !p.status?.conditions?.some(x=>x.type==='Ready'&&x.status==='True')||!s?.ready||!s.state?.running||typeof s.containerID!=='string'||!s.containerID||
    typeof s.imageID!=='string'||s.imageID.match(/sha256:[a-f0-9]{64}$/)?.[0]!==c.imageDigest||!container||
    !same(container.resources,worker.spec.template.spec.containers.find(x=>x.name==='worker')?.resources))return null;
   snapshots.push({name:p.metadata.name,uid:p.metadata.uid,node:p.spec.nodeName,containerID:s.containerID,imageID:s.imageID});
  }
  if(new Set(snapshots.map(x=>x.uid)).size!==n||new Set(snapshots.map(x=>x.name)).size!==n)deny();
  if(!Number.isInteger(worker.metadata.generation)||!Number.isInteger(worker.status?.observedGeneration)||worker.status.observedGeneration<worker.metadata.generation||
   ['replicas','readyReplicas','updatedReplicas','availableReplicas'].some(k=>(worker.status?.[k]??0)!==n))return null;
  return {replicas:n,workerUID:c.workerUID,workerIds:snapshots.map(x=>x.name).sort(),pods:snapshots.sort((a,b)=>a.name.localeCompare(b.name))};
 }
 async function mutate(kind,before,changes,replicas,cleanup=false){
  check(cleanup);const patch=patchFor(before,changes,replicas);const x=await io.patch(kind,patch,cleanup);check(cleanup);bound(x,kind);
  for(const [key,value]of Object.entries(changes))if(value===undefined?Object.hasOwn(ann(x),key):ann(x)[key]!==value)deny();
  if(replicas!==undefined&&x.spec.replicas!==replicas)deny();return x;
 }
 return {
  details:()=>structuredClone(detail),
  async prepare(){
   if(prepareAttempted)deny();prepareAttempted=true;
   const w=bound(await read('worker'),'worker'),s=bound(await read('controller'),'controller'),initialHpas=hpas(await read('hpas'));
   if(w.spec.replicas!==c.initialReplicas||[w,s].some(x=>Object.hasOwn(ann(x),owner)||Object.hasOwn(ann(x),stepKey))||
    s.spec.scaleTargetRef?.name!==c.workerName||s.spec.scaleTargetRef.kind!==undefined&&s.spec.scaleTargetRef.kind!=='Deployment'||
    Object.entries(pauseMap(s)).some(([k,v])=>k===pauseKeys[1]?!/^[0-5]$/.test(v):!['true','false'].includes(v))||
    (fullPause(s)?initialHpas.length!==0||!paused(s)||Object.hasOwn(ann(s),pauseKeys[1])&&Number(ann(s)[pauseKeys[1]])!==c.initialReplicas:
    initialHpas.length!==1||c.initialReplicas!==s.spec.minReplicaCount))deny();
   if(!await ready(c.initialReplicas,false,false))deny();
   originalWorker=structuredClone(w);originalController=structuredClone(s);originalHpas=structuredClone(initialHpas);
   const changes=Object.fromEntries(pauseKeys.map(k=>[k,k===pauseKeys[0]?'true':undefined]));changes[owner]=c.runId;
   pauseAttempted=true;detail.pauseAttempted=true;
   await mutate('controller',s,changes);pauseAck=true;detail.pauseAcknowledged=true;
   await wait(()=>pausedProof());
   const current=bound(await read('worker'),'worker');if(current.spec.replicas!==c.initialReplicas||Object.hasOwn(ann(current),owner)||Object.hasOwn(ann(current),stepKey))deny();
   attempted={step:c.runId+':0',replicas:c.initialReplicas};workerAttempted=true;detail.workerMutationAttempted=true;
   await mutate('worker',current,{[owner]:c.runId,[stepKey]:attempted.step});confirmed=attempted;prepared=true;detail.prepared=true;
   return {initialReplicas:c.initialReplicas,controllerPaused:true,originalHpaCount:initialHpas.length};
  },
  async scale(n){
   if(!prepared||restoreAttempted||![1,3].includes(n)||!await pausedProof())deny();const w=await read('worker');workerPair(w);
   if(confirmed.replicas!==n){
    attempted={step:c.runId+':'+(++sequence),replicas:n};
    await mutate('worker',w,{[stepKey]:attempted.step},n);confirmed=attempted;
   }
   const snapshot=await wait(()=>ready(n));if(!await pausedProof())deny();return snapshot;
  },
  async observeReady(n){if(!prepared||restoreAttempted||!await pausedProof())deny();const snapshot=await ready(n);if(!snapshot)deny();return snapshot;},
  async restore(){
   if(restoreAttempted)return structuredClone(restoreResult??{workerRestored:false,controllerRestored:false,state:'restoration_outcome_unknown_no_retry'});
   restoreAttempted=true;detail.restorationAttempted=true;
   restoreResult={workerRestored:!workerAttempted,controllerRestored:!pauseAttempted,state:'restore_unconfirmed',retryAllowed:false};
   try{
    if(!pauseAttempted){detail.restored=true;return {...restoreResult,state:'no_mutation'};}
    const s=ourController(await read('controller',true));
    if(!pauseAck)pauseAck=true; // Exact owned marker observed; never resend the unknown pause.
    let w=bound(await read('worker',true),'worker');
    if(workerAttempted){workerPair(w);await mutate('worker',w,{[owner]:undefined,[stepKey]:undefined},c.initialReplicas,true);await wait(()=>ready(c.initialReplicas,true,false),true);}
    else if(w.spec.replicas!==c.initialReplicas||Object.hasOwn(ann(w),owner)||Object.hasOwn(ann(w),stepKey))deny();
    restoreResult.workerRestored=true;
    const current=ourController(await read('controller',true)),changes={};
    for(const key of pauseKeys)changes[key]=Object.hasOwn(ann(originalController),key)?ann(originalController)[key]:undefined;
    changes[owner]=undefined;await mutate('controller',current,changes,undefined,true);
    await wait(async()=>{
     const now=bound(await read('controller',true),'controller'),hp=hpas(await read('hpas',true));
     if(Object.hasOwn(ann(now),owner)||!same(pauseMap(now),pauseMap(originalController)))deny();
     return paused(now)===paused(originalController)&&hp.length===originalHpas.length&&hp.every((h,i)=>same(h.spec,originalHpas[i].spec));
    },true);
    const final=bound(await read('worker',true),'worker');if(final.spec.replicas!==c.initialReplicas||Object.hasOwn(ann(final),owner)||Object.hasOwn(ann(final),stepKey))deny();
    restoreResult={...restoreResult,controllerRestored:true,state:'restored',finalReplicas:final.spec.replicas};detail.restored=true;return structuredClone(restoreResult);
   }catch{return {...restoreResult,state:'failed_or_unknown_retained',manualRecoveryMayBeRequired:true};}
  },
 };
}
