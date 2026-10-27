// Inactive controlled-backlog lifecycle. The HPA stays alive during the
// one-direction hold; this is not the manual benchmark's full-pause lifecycle.
// JSON-patch CAS is per object, not a distributed lock or hard-kill recovery.
import {isDeepStrictEqual as same} from 'node:util';
import {benchmarkTargetHash} from './cloud-benchmark-target.mjs';
const deny=()=>{throw Error('Automatic target unconfirmed');},copy=x=>structuredClone(x);
const owner='releaseguard.io/controlled-backlog',step=owner+'-step';
const pauses=['autoscaling.keda.sh/paused','autoscaling.keda.sh/paused-replicas','autoscaling.keda.sh/paused-scale-in','autoscaling.keda.sh/paused-scale-out'];
const ann=x=>x.metadata.annotations??{},ptr=k=>k.replace(/~/g,'~0').replace(/\//g,'~1');
const pauseMap=x=>Object.fromEntries(pauses.filter(k=>Object.hasOwn(ann(x),k)).map(k=>[k,ann(x)[k]]));
const stamp=x=>({spec:copy(x.spec),owner:ann(x)[owner],step:ann(x)[step],pauses:pauseMap(x)});
function patch(before,changes,min){
 const p=[{op:'test',path:'/metadata/uid',value:before.metadata.uid},{op:'test',path:'/metadata/resourceVersion',value:before.metadata.resourceVersion},{op:'test',path:'/spec',value:before.spec}];
 if(!before.metadata.annotations)p.push({op:'add',path:'/metadata/annotations',value:{}});
 for(const [k,v]of Object.entries(changes)){
  if(Object.hasOwn(ann(before),k))p.push({op:'test',path:'/metadata/annotations/'+ptr(k),value:ann(before)[k]});
  if(v===undefined){if(Object.hasOwn(ann(before),k))p.push({op:'remove',path:'/metadata/annotations/'+ptr(k)});}
  else p.push({op:Object.hasOwn(ann(before),k)?'replace':'add',path:'/metadata/annotations/'+ptr(k),value:v});
 }
 if(min!==undefined)p.push({op:'replace',path:'/spec/minReplicaCount',value:min});return p;
}
export function validateAutoscaleTarget(c){
 const name=x=>typeof x==='string'&&/^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/.test(x);
 if(c.workerName!=='worker'||c.controllerName!=='evaluation-worker'||c.metricName!=='s0-rabbitmq-releaseguard-evaluate'||!name(c.namespace)||
  !['source-three','main-five'].includes(c.controllerProfile)||!/^sha256:[a-f0-9]{64}$/.test(c.imageDigest??'')||
  !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(c.runId??'')||
  ![c.workerUID,c.controllerUID].every(v=>typeof v==='string'&&/^[A-Za-z0-9-]{1,100}$/.test(v))||
  ![c.workerSpecSHA256,c.controllerSpecSHA256].every(v=>/^[a-f0-9]{64}$/.test(v??''))||c.initialReplicas!==1||
  !Array.isArray(c.nodeNames)||c.nodeNames.length!==2||new Set(c.nodeNames).size!==2||!c.nodeNames.every(name))deny();
 return c;
}
export function autoscaleTarget(input,io){
 const c=validateAutoscaleTarget(input),max=c.controllerProfile==='source-three'?3:5;
 let original,accepted,attempted,preflighted=false,mutationAttempted=false,workerMarked=false,workerMarkAttempted=false,started=false,released=false,finalized=false,finalResult;
 let hpaUID,finalOneObserved=false;const knownPods=new Map(),commands=[];
 let lastClock=-Infinity;
 const check=clean=>{const now=io.now();if(!Number.isFinite(now)||now<lastClock||io.remaining(clean)<=0)deny();lastClock=now;};
 const read=async(kind,clean=false)=>{check(clean);const x=await io.read(kind,clean);check(clean);return x;};
 function bound(x,kind){
  const w=kind==='worker';if(x?.apiVersion!==(w?'apps/v1':'keda.sh/v1alpha1')||x.kind!==(w?'Deployment':'ScaledObject')||
   x.metadata?.name!==(w?c.workerName:c.controllerName)||x.metadata.namespace!==c.namespace||x.metadata.uid!==(w?c.workerUID:c.controllerUID)||x.metadata.deletionTimestamp||
   typeof x.metadata.resourceVersion!=='string'||!/^\S{1,100}$/.test(x.metadata.resourceVersion))deny();
  if(w){if(benchmarkTargetHash('worker',x.spec)!==c.workerSpecSHA256||!Number.isInteger(x.spec.replicas)||x.spec.replicas<0||x.spec.replicas>max)deny();
   const a=x.spec.template?.spec?.containers;if(a?.length!==1||a[0].name!=='worker'||a[0].image?.split('@')[1]!==c.imageDigest||
    !['500m','0.5'].includes(a[0].resources?.limits?.cpu)||a[0].resources?.limits?.memory!=='384Mi'||x.spec.selector?.matchLabels?.app!=='worker')deny();
  }else{
   const normalized=copy(x.spec);normalized.minReplicaCount=1;
   if(benchmarkTargetHash('controller',normalized)!==c.controllerSpecSHA256)deny();
   const s=x.spec,t=s.triggers?.[0],p=s.advanced?.horizontalPodAutoscalerConfig?.behavior?.scaleDown;
   const slow=c.controllerProfile==='source-three'?60:120;
   if(s.scaleTargetRef?.name!==c.workerName||s.scaleTargetRef.kind!==undefined&&s.scaleTargetRef.kind!=='Deployment'||s.maxReplicaCount!==max||s.pollingInterval!==5||s.cooldownPeriod!==slow||
    p?.stabilizationWindowSeconds!==slow||!same(p.policies,[{type:'Pods',value:max===3?2:1,periodSeconds:max===3?30:60}])||
    ![0,1].includes(s.minReplicaCount)||s.triggers?.length!==1||t.type!=='rabbitmq'||t.metadata?.protocol!=='http'||t.metadata.mode!=='QueueLength'||t.metadata.value!=='10'||
    t.metadata.queueName!=='releaseguard.evaluate'||t.metadata.excludeUnacknowledged!=='false'||t.metadata.unsafeSsl!=='false'||
    t.authenticationRef?.name!=='rg-rabbit-scaler'||max===3&&t.metadata.vhostName!=='releaseguard')deny();
  }return x;
 }
 function ownedController(x){bound(x,'controller');if(![accepted,attempted].some(v=>v&&same(v,stamp(x))))deny();return x;}
 function ownedWorker(x){bound(x,'worker');if(ann(x)[owner]!==c.runId||ann(x)[step]!=='worker-observe')deny();return x;}
 async function mutate(kind,before,changes,min,clean=false){
  check(clean);const expected=copy(before);expected.metadata.annotations={...ann(before)};
  for(const [k,v]of Object.entries(changes))if(v===undefined)delete expected.metadata.annotations[k];else expected.metadata.annotations[k]=v;
  if(min!==undefined)expected.spec.minReplicaCount=min;
  if(kind==='controller'){attempted=stamp(expected);mutationAttempted=true;}else workerMarkAttempted=true;
  const ops=patch(before,changes,min);commands.push({kind,step:changes[step]??null,cleanup:clean});
  const r=await io.patch(kind,ops,clean);check(clean);bound(r,kind);
  if(!same(stamp(r),stamp(expected)))deny();if(kind==='controller'){accepted=stamp(r);attempted=null;}return r;
 }
 async function wait(fn,ms=30000,clean=false){const end=io.now()+ms;for(let n=0;n<360;n++){check(clean);if(io.now()>=end)deny();const r=await fn();if(r)return r;await io.sleep(1000,clean);}deny();}
 function list(x){if(!Array.isArray(x?.items)||x.items.length>1000||x.metadata?.continue)deny();return x.items;}
 async function hpa(held,clean=false,bindNew=false,pendingAllowed=false){
  const selected=list(await read('hpas',clean)).filter(x=>x.spec?.scaleTargetRef?.name===c.workerName);
  if(selected.length===0&&pendingAllowed)return null;
  if(selected.length!==1)deny();const h=selected[0],m=h.spec?.metrics?.[0];
  if(h.apiVersion!=='autoscaling/v2'||h.kind!=='HorizontalPodAutoscaler'||h.metadata?.name!=='keda-hpa-'+c.controllerName||h.metadata.namespace!==c.namespace||
   !h.metadata.uid||h.metadata.deletionTimestamp||!h.metadata.ownerReferences?.some(o=>o.uid===c.controllerUID&&o.kind==='ScaledObject'&&o.controller===true)||
   h.spec.scaleTargetRef.kind!=='Deployment'||h.spec.maxReplicas!==max||h.spec.minReplicas!==1||h.spec.metrics.length!==1||m.type!=='External'||
   m.external?.metric?.name!==c.metricName||!same(m.external.metric.selector?.matchLabels,{'scaledobject.keda.sh/name':c.controllerName})||
   m.external.target?.type!=='AverageValue'||String(m.external.target.averageValue)!=='10'||
   (h.spec.behavior?.scaleUp?.selectPolicy==='Disabled')!==held)deny();
  if(bindNew){if(!hpaUID)hpaUID=h.metadata.uid;}
  if(hpaUID&&h.metadata.uid!==hpaUID)deny();return h;
 }
 async function cohort(clean=false,owned=true){
  const w=owned?ownedWorker(await read('worker',clean)):bound(await read('worker',clean),'worker'),n=w.spec.replicas;
  const pods=list(await read('pods',clean)),sets=list(await read('replicaSets',clean));
  const rs=new Set(sets.filter(r=>r.metadata?.namespace===c.namespace&&r.metadata.ownerReferences?.some(o=>o.uid===c.workerUID&&o.kind==='Deployment'&&o.controller===true)).map(r=>r.metadata.uid));
  if(!Number.isInteger(w.metadata.generation)||!Number.isInteger(w.status?.observedGeneration)||w.status.observedGeneration<w.metadata.generation||
   ['replicas','readyReplicas','updatedReplicas','availableReplicas'].some(k=>(w.status?.[k]??0)!==n)||pods.length!==n)return null;
  const rows=[];for(const p of pods){const status=p.status?.containerStatuses?.find(x=>x.name==='worker'),v=p.spec?.containers;
   if(p.metadata?.namespace!==c.namespace||p.metadata.deletionTimestamp||!p.metadata?.uid||typeof p.metadata.name!=='string'||!c.nodeNames.includes(p.spec?.nodeName)||
    !p.metadata.ownerReferences?.some(o=>o.kind==='ReplicaSet'&&rs.has(o.uid)&&o.controller===true)||v?.length!==1||!same(v[0],w.spec.template.spec.containers[0])||
    !p.status?.conditions?.some(x=>x.type==='Ready'&&x.status==='True')||!status?.ready||!status.state?.running||!status.containerID||status.imageID?.match(/sha256:[a-f0-9]{64}$/)?.[0]!==c.imageDigest)return null;
   const row={name:p.metadata.name,uid:p.metadata.uid,node:p.spec.nodeName,imageID:status.imageID,containerID:status.containerID};
   if(knownPods.has(row.name)&&knownPods.get(row.name).uid!==row.uid)deny();rows.push(row);
  }
  if(new Set(rows.map(x=>x.uid)).size!==n||new Set(rows.map(x=>x.name)).size!==n)deny();
  for(const row of rows)knownPods.set(row.name,row);return {desired:n,ready:n,pods:rows};
 }
 async function metric(){
  const r=await read('metric'),items=list(r);if(r.kind!=='ExternalMetricValueList'||r.apiVersion!=='external.metrics.k8s.io/v1beta1'||items.length!==1)deny();const x=items[0];
  const age=io.wallNow()-Date.parse(x.timestamp);if(x.metricName!==c.metricName||x.metricLabels?.['scaledobject.keda.sh/name']!==c.controllerName||
   x.namespace!==undefined&&x.namespace!==c.namespace||!Number.isFinite(age)||age< -5000||age>60000||! /^(?:0|[1-9][0-9]{0,9})(?:\.[0-9]{1,6})?m?$/.test(x.value))deny();
  const value=Number(x.value.replace(/m$/,''))/(x.value.endsWith('m')?1000:1);if(!Number.isFinite(value))deny();return {value,raw:copy(r)};
 }
 async function initial(){
   const s=bound(await read('controller'),'controller'),w=bound(await read('worker'),'worker');
   if(s.spec.minReplicaCount!==1||w.spec.replicas!==1||[s,w].some(x=>Object.hasOwn(ann(x),owner)||Object.hasOwn(ann(x),step))||
    ![{}, {[pauses[1]]:'1'}].some(v=>same(v,pauseMap(s)))||!await cohort(false,false))deny();
   // Initial paused-one is the original CD postcondition. Its HPA may be absent.
   if(Object.hasOwn(ann(s),pauses[1])){if(list(await read('hpas')).some(x=>x.spec?.scaleTargetRef?.name===c.workerName))deny();}else await hpa(false);
   return s;
 }
 return {
  // Shared read-only inspection for the separate fault-stimulus consumer.
  // No lifecycle preparation, annotation mutation, scale or signal occurs here.
  async inspectCurrent(clean=false){
   const controller=bound(await read('controller',clean),'controller'),worker=bound(await read('worker',clean),'worker');
   if(controller.spec.minReplicaCount!==1)deny();let members=await cohort(clean,false);
   if(members&&(members.desired!==worker.spec.replicas||members.ready!==(worker.status?.readyReplicas??0)))members=null;
   const full=Object.hasOwn(pauseMap(controller),pauses[1]);let hp=null;
   if(full){if(list(await read('hpas',clean)).some(x=>x.spec?.scaleTargetRef?.name===c.workerName))deny();}
   else hp=await hpa(false,clean,true,true);
   return {controller:copy(controller),worker:copy(worker),cohort:members,hpa:copy(hp)};
  },
  async preflight(){if(preflighted||started)deny();const s=await initial();original=copy(s);accepted=stamp(s);preflighted=true;return {controllerUID:c.controllerUID,workerUID:c.workerUID,profile:c.controllerProfile};},
  async prepare(){
   if(started||!preflighted)deny();started=true;const s=await initial();if(!same(stamp(s),stamp(original)))deny();
   const changes=Object.fromEntries(pauses.map(k=>[k,k===pauses[1]?'0':undefined]));changes[owner]=c.runId;changes[step]='zero';
   await mutate('controller',s,changes,0);
   // Observe actual zero Pods and controller outcome, not just an annotation.
   await wait(async()=>{ownedController(await read('controller'));const r=await cohort(false,false);return r?.desired===0&&r;});
   const zero=bound(await read('worker'),'worker');if(zero.spec.replicas!==0||Object.hasOwn(ann(zero),owner)||Object.hasOwn(ann(zero),step))deny();
   await mutate('worker',zero,{[owner]:c.runId,[step]:'worker-observe'});workerMarked=true;
   const cur=ownedController(await read('controller'));await mutate('controller',cur,{[pauses[1]]:undefined,[pauses[3]]:'true',[step]:'hold'},0);
   const start=io.now();let warms=0;while(io.now()-start<150000){if(++warms>31)deny();const current=ownedController(await read('controller'));if(ann(current)[step]!=='hold')deny();await io.sleep(Math.min(5000,150000-(io.now()-start)),false);}
   await hpa(true,false,true);const zeroHeld=await cohort();if(zeroHeld?.desired!==0)deny();const m=await metric();if(m.value!==0)deny();
   return {metricWarmupMs:io.now()-start,initialMetric:m.raw,hpaUID,controllerProfile:c.controllerProfile,maxReplicas:max,originalPausedOne:Object.hasOwn(pauseMap(original),pauses[1]),workerPodsObserved:0,
    consumerObservationScope:'Owned Worker Deployment and Pods only; other broker consumers are not independently measured. Exclusive trial acknowledgement is an operator declaration.'};
  },
  async held(){const s=ownedController(await read('controller'));if(ann(s)[step]!=='hold')deny();await hpa(true);const r=await cohort();if(r?.desired!==0)deny();return metric();},
  async release(){const s=ownedController(await read('controller'));if(released||ann(s)[step]!=='hold')deny();await this.held();
   await mutate('controller',s,{[pauses[3]]:undefined,[step]:'automatic'},1);released=true;await wait(async()=>{ownedController(await read('controller'));return hpa(false);});},
  async sample(){if(!released)deny();ownedController(await read('controller'));const r=await cohort(),h=await hpa(false);const m=await metric();
   const sample={at:new Date(io.wallNow()).toISOString(),desired:null,ready:null,...(r??{}),hpaDesired:h.status?.desiredReplicas??null,currentMetrics:h.status?.currentMetrics??null,conditions:h.status?.conditions??null,metric:m.raw};
   if(r?.desired===1&&r.ready===1&&h.status?.desiredReplicas===1)finalOneObserved=true;return sample;},
  async events(){const r=await read('events');return list(r).filter(e=>e.involvedObject?.uid===hpaUID&&e.involvedObject.namespace===c.namespace).map(copy);},
  workers:()=>[...knownPods.values()].map(copy),
  async finish(success,postcondition){
   if(finalized)return copy(finalResult??{state:'unknown_no_retry'});finalized=true;finalResult={state:'failed_or_unknown_retained',originalStateRestored:false,pausedOneHandoff:false,retryAllowed:false};
   try{
    if(!mutationAttempted)return {...finalResult,state:'no_mutation',originalStateRestored:true};
    const s=ownedController(await read('controller',true)),w=bound(await read('worker',true),'worker');
    if(workerMarked||workerMarkAttempted){ownedWorker(w);}else if(ann(w)[owner]!==undefined||ann(w)[step]!==undefined)deny();
    // No direct replica write. An unexpected2 is not attributable to us merely
    // because it shares a workspace. Preserve it and require manual recovery.
    if(released?!finalOneObserved||w.spec.replicas!==1:![0,1].includes(w.spec.replicas))deny();
    if(workerMarked||workerMarkAttempted)await mutate('worker',w,{[owner]:undefined,[step]:undefined},undefined,true);
    const latest=ownedController(await read('controller',true)),handoff=success&&postcondition==='paused-one-for-cd';
    const changes=Object.fromEntries(pauses.map(k=>[k,handoff?(k===pauses[1]?'1':undefined):ann(original)[k]]));changes[owner]=handoff?c.runId:undefined;changes[step]=handoff?'handoff':undefined;
    await mutate('controller',latest,changes,original.spec.minReplicaCount,true);
    await wait(async()=>{const now=bound(await read('controller',true),'controller'),r=await cohort(true,false);
     if(!same(now.spec,original.spec)||!same(pauseMap(now),handoff?{[pauses[1]]:'1'}:pauseMap(original))||ann(now)[owner]!==changes[owner]||ann(now)[step]!==changes[step])deny();
     const full=Object.hasOwn(pauseMap(now),pauses[1]);if(full){if(list(await read('hpas',true)).some(h=>h.spec?.scaleTargetRef?.name===c.workerName))return false;}
     else await hpa(false,true);
     return r?.desired===1&&r;
    },30000,true);
    finalResult={state:handoff?'owned_paused_one_handoff':'restored',originalStateRestored:!handoff,pausedOneHandoff:handoff,finalReplicas:1,retryAllowed:false,notDeploymentOrZeroNodesProof:true};return copy(finalResult);
   }catch{return {...finalResult,manualRecoveryMayBeRequired:true};}
  },
  details:()=>({hpaUID,commands:copy(commands),workerMarked,finalOneObserved}),
 };
}
