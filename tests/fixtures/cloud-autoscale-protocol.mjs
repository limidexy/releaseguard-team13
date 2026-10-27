// Owned simulation only. Actual HTTP adapter, CAS patch interpreter, and full
//700-job consumer execute; scheduling/queue/clock/API/issuer are synthetic.
import {protocolBoundary} from './cloud-benchmark-protocol.mjs';
import {benchmarkTargetHash} from '../../scripts/cloud-benchmark-target.mjs';
import {autoscaleTarget} from '../../scripts/cloud-autoscale-target.mjs';
export {token} from './cloud-benchmark-protocol.mjs';
const owner='releaseguard.io/controlled-backlog',step=owner+'-step',pause='autoscaling.keda.sh/paused-replicas';
export function autoscaleBoundary(options={}){
 let observedWorkers=[];
 const b=protocolBoundary({...options,mutateJob:(j,row,f)=>{
  j.worker_id=observedWorkers[(row.index-1)%observedWorkers.length]??j.worker_id;
  options.mutateJob?.(j,row,f);
 }}),{f}=b;
 const oldConfig=b.c,originalWorker=f.state.worker,originalController=f.state.controller;
 originalWorker.spec.template.spec.containers[0].image=oldConfig.image;
 f.state.pods.items=[]; // Recreate synthetic Pods from the selected image, not the earlier fixture template.
 originalController.spec={scaleTargetRef:{name:'worker',kind:'Deployment'},pollingInterval:5,cooldownPeriod:60,minReplicaCount:1,maxReplicaCount:3,
  advanced:{horizontalPodAutoscalerConfig:{behavior:{scaleDown:{stabilizationWindowSeconds:60,policies:[{type:'Pods',value:2,periodSeconds:30}]}}}},
  triggers:[{type:'rabbitmq',metadata:{protocol:'http',mode:'QueueLength',value:'10',vhostName:'releaseguard',queueName:'releaseguard.evaluate',excludeUnacknowledged:'false',unsafeSsl:'false'},authenticationRef:{name:'rg-rabbit-scaler'}}]};
 if(options.profile==='main-five'){
  Object.assign(originalController.spec,{maxReplicaCount:5,cooldownPeriod:120});originalController.spec.advanced.horizontalPodAutoscalerConfig.behavior.scaleDown={stabilizationWindowSeconds:120,policies:[{type:'Pods',value:1,periodSeconds:60}]};delete originalController.spec.triggers[0].metadata.vhostName;
 }
 if(options.initialPaused)originalController.metadata.annotations[pause]='1';
 const selected={...oldConfig.target,workerSpecSHA256:benchmarkTargetHash('worker',originalWorker.spec),controllerSpecSHA256:benchmarkTargetHash('controller',originalController.spec),metricName:'s0-rabbitmq-releaseguard-evaluate',controllerProfile:options.profile??'source-three'};
 const {allowPairedReplay,jobs,...rest}=oldConfig;
 b.c={...rest,target:selected,allowControlledBacklog:true,isolation:{exclusiveQueueAndWorker:true,acknowledgement:'I_CONTROL_THIS_ISOLATED_QUEUE_AND_WORKER_TARGET'},postcondition:options.postcondition??'restore-original'};
 const c=b.c;let observations=0,wasFull=false,hpaSerial=0,unknownUsed=false;
 function reconcile(){
  const s=f.state.controller,a=s.metadata.annotations??{},full=Object.hasOwn(a,pause);
  if(full)f.state.worker.spec.replicas=Number(a[pause]);
  else if(a['autoscaling.keda.sh/paused-scale-out']==='true')f.state.worker.spec.replicas=0;
  else if(a[step]==='automatic'&&observations===0)f.state.worker.spec.replicas=1;
  else if(!a[owner]&&s.spec.minReplicaCount===1&&f.state.worker.spec.replicas===0)f.state.worker.spec.replicas=1;
  f.reconcile();
  if(full){f.state.hpas.items=[];wasFull=true;return;}
  if(wasFull||!hpaSerial){hpaSerial++;wasFull=false;}
  const held=a['autoscaling.keda.sh/paused-scale-out']==='true',max=s.spec.maxReplicaCount;
  f.state.hpas.items=[{apiVersion:'autoscaling/v2',kind:'HorizontalPodAutoscaler',metadata:{name:'keda-hpa-evaluation-worker',namespace:c.cloud.namespace,uid:'synthetic-auto-hpa-'+hpaSerial,
   ownerReferences:[{kind:'ScaledObject',uid:s.metadata.uid,controller:true}]},spec:{scaleTargetRef:{apiVersion:'apps/v1',kind:'Deployment',name:'worker'},minReplicas:1,maxReplicas:max,
    metrics:[{type:'External',external:{metric:{name:selected.metricName,selector:{matchLabels:{'scaledobject.keda.sh/name':selected.controllerName}}},target:{type:'AverageValue',averageValue:'10'}}}],
    behavior:{scaleUp:{selectPolicy:held?'Disabled':'Max'}}},status:{desiredReplicas:f.state.worker.spec.replicas,currentMetrics:[],conditions:[{type:'ScalingActive',status:'True'}]}}];
 }
 const originalJSON=b.io.json;
 b.io.json=async(name,v)=>{if(options.persistFault===name)throw Error('Synthetic persistence failure');return originalJSON(name,v);};
 const wallNow=()=>Date.parse('2000-01-01T00:00:00Z')+f.io.now();b.io.wallNow=wallNow;
 const targetIO={now:f.io.now,wallNow,remaining:b.io.remaining,sleep:b.io.sleep,
  read:async(kind,cleanup)=>{
   f.events.push({type:'read',kind,cleanup});
   const a=f.state.controller.metadata.annotations??{};
   if(kind==='worker'&&a[step]==='automatic'&&!cleanup){observations++;f.state.worker.spec.replicas=options.noScale?1:observations===1?3:1;f.state.worker.metadata.resourceVersion=String(Number(f.state.worker.metadata.resourceVersion)+1);reconcile();}
   if(kind==='metric'){
    const foreign=options.foreignMetric;
    return {apiVersion:'external.metrics.k8s.io/v1beta1',kind:'ExternalMetricValueList',items:[{metricName:foreign?'foreign-queue':selected.metricName,metricLabels:{'scaledobject.keda.sh/name':foreign?'foreign-controller':selected.controllerName},namespace:foreign?'foreign':c.cloud.namespace,timestamp:new Date(wallNow()-(options.staleMetric?120000:0)).toISOString(),value:String(a[step]==='hold'?b.jobs.size:0)}]};
   }
   if(kind==='events'){
    if(options.externalReplica){f.state.worker.spec.replicas=2;f.state.worker.metadata.resourceVersion='999';reconcile();}
    return {items:[{involvedObject:{uid:'synthetic-auto-hpa-'+hpaSerial,namespace:c.cloud.namespace},reason:'SuccessfulRescale',message:'SIMULATION ONLY',lastTimestamp:new Date(wallNow()).toISOString()},{involvedObject:{uid:'foreign',namespace:c.cloud.namespace},reason:'Foreign',message:'Must not be attributed'}]};
   }
   if(kind==='hpas'&&options.foreignHPA){const v=structuredClone(f.state.hpas);if(v.items[0])v.items[0].metadata.ownerReferences[0].uid='foreign';return v;}
   if(kind==='worker'&&options.missingObservedGeneration){const v=structuredClone(f.state.worker);delete v.status.observedGeneration;return v;}
   if(kind==='worker'&&f.state.worker.spec.replicas>=3)observedWorkers=f.state.pods.items.map(p=>p.metadata.name);
   return structuredClone(f.state[kind]);
  },
  patch:async(kind,ops,cleanup)=>{
   f.events.push({type:'patch',kind,ops:structuredClone(ops),cleanup});
   if(cleanup&&options.cleanupFailure)throw Error('Synthetic cleanup failure');
   const zero=kind==='controller'&&ops.some(p=>p.path==='/spec/minReplicaCount'&&p.value===0)&&ops.some(p=>p.value==='zero');
   if(zero&&options.unknownBefore&&!unknownUsed){unknownUsed=true;throw Error('Synthetic unknown before mutation');}
   f.apply(kind,ops);reconcile();
   if(zero&&options.unknownAfter&&!unknownUsed){unknownUsed=true;throw Error('Synthetic unknown after mutation');}
   return structuredClone(f.state[kind]);
  }};
 b.io.target=async()=>{if(options.targetRefused)throw Error('Synthetic identity refusal');return autoscaleTarget({...c.target,runId:c.runId,namespace:c.cloud.namespace,imageDigest:c.image.split('@')[1]},targetIO);};
 reconcile();return {...b,targetIO,reconcile,get observedWorkers(){return [...observedWorkers];},nativeRead:targetIO.read,nativePatch:targetIO.patch};
}
