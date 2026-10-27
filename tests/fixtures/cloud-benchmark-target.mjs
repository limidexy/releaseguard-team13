// Disposable in-memory Kubernetes API boundary. JSON patches are applied
// atomically to a copy, with real UID/resourceVersion/spec tests and side effects.
// Never uses kubeconfig, listeners, native commands, cloud or existing resources.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as same} from 'node:util';
const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':x&&typeof x==='object'?'{'+Object.entries(x).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}':JSON.stringify(x);
const digest=x=>createHash('sha256').update(canonical(x)).digest('hex');
const clone=x=>structuredClone(x),owner='releaseguard.io/paired-benchmark',pausedKey='autoscaling.keda.sh/paused';
export function targetFixture({initialPaused=false,initialReplicas=1,fault=null}={}){
 const worker={apiVersion:'apps/v1',kind:'Deployment',metadata:{name:'worker',namespace:'releaseguard',uid:'synthetic-worker-uid',resourceVersion:'1',generation:1,annotations:{unrelated:'original'}},
  spec:{replicas:initialReplicas,selector:{matchLabels:{app:'worker'}},template:{metadata:{labels:{app:'worker'}},spec:{containers:[{name:'worker',image:'registry.example.invalid/releaseguard:v0',
   resources:{requests:{cpu:'100m',memory:'64Mi'},limits:{cpu:'500m',memory:'384Mi'}}}]}}},status:{}};
 const controller={apiVersion:'keda.sh/v1alpha1',kind:'ScaledObject',metadata:{name:'evaluation-worker',namespace:'releaseguard',uid:'synthetic-controller-uid',resourceVersion:'1',annotations:{unrelated:'original',...(initialPaused?{[pausedKey]:'true'}:{})}},
  spec:{scaleTargetRef:{name:'worker',kind:'Deployment'},minReplicaCount:1,maxReplicaCount:5,triggers:[{type:'rabbitmq',metadata:{queueName:'releaseguard.evaluate',value:'10'}}]},status:{conditions:[{type:'Paused',status:initialPaused?'True':'False'}]}};
 const hpaSpec={scaleTargetRef:{apiVersion:'apps/v1',kind:'Deployment',name:'worker'},minReplicas:1,maxReplicas:5,metrics:[{type:'External',external:{metric:{name:'synthetic-queue'},target:{type:'AverageValue',averageValue:'10'}}}]};
 const state={worker,controller,hpas:{metadata:{resourceVersion:'1'},items:[]},pods:{metadata:{resourceVersion:'1'},items:[]},replicaSets:{metadata:{resourceVersion:'1'},items:[
  {apiVersion:'apps/v1',kind:'ReplicaSet',metadata:{name:'worker-rs',namespace:'releaseguard',uid:'synthetic-rs-uid',ownerReferences:[{kind:'Deployment',uid:worker.metadata.uid,controller:true}]}}]}};
 const spec=clone(worker.spec);delete spec.replicas;
 const config={runId:'31111111-1111-4111-8111-111111111111',namespace:'releaseguard',workerName:'worker',controllerName:'evaluation-worker',workerUID:worker.metadata.uid,controllerUID:controller.metadata.uid,
  workerSpecSHA256:digest(spec),controllerSpecSHA256:digest(controller.spec),initialReplicas,imageDigest:'sha256:'+'a'.repeat(64),nodeNames:['synthetic-node-a','synthetic-node-b']};
 let clock=0,serial=0,patched=0,usedFault=false;const events=[];
 function reconcile(){
  const n=state.worker.spec.replicas;
  state.worker.status={observedGeneration:state.worker.metadata.generation,replicas:n,readyReplicas:n,updatedReplicas:n,availableReplicas:n};
  const old=state.pods.items;state.pods.items=Array.from({length:n},(_,i)=>old[i]??{
   apiVersion:'v1',kind:'Pod',metadata:{name:'worker-pod-'+(++serial),namespace:'releaseguard',uid:'synthetic-pod-uid-'+serial,ownerReferences:[{kind:'ReplicaSet',uid:'synthetic-rs-uid',controller:true}]},
   spec:{nodeName:config.nodeNames[i%2],containers:clone(state.worker.spec.template.spec.containers)},
   status:{conditions:[{type:'Ready',status:'True'}],containerStatuses:[{name:'worker',ready:true,containerID:'containerd://synthetic-'+serial,imageID:'registry.example.invalid/releaseguard@'+config.imageDigest,state:{running:{startedAt:'2026-10-11T00:00:00Z'}}}]}
  });
  const p=state.controller.metadata.annotations??{},full=p[pausedKey]==='true'||Object.hasOwn(p,'autoscaling.keda.sh/paused-replicas');
  const partial=p['autoscaling.keda.sh/paused-scale-in']==='true'||p['autoscaling.keda.sh/paused-scale-out']==='true';
  state.controller.status.conditions=[{type:'Paused',status:full||partial?'True':'False'}];
  state.hpas.items=full?[]:[{apiVersion:'autoscaling/v2',kind:'HorizontalPodAutoscaler',metadata:{name:'keda-hpa-evaluation-worker',namespace:'releaseguard',uid:'synthetic-hpa-uid',ownerReferences:[{kind:'ScaledObject',uid:controller.metadata.uid,controller:true}]},spec:clone(hpaSpec)}];
 }
 function apply(kind,ops){
  const copy=clone(state[kind]);
  for(const op of ops){
   const keys=op.path.slice(1).split('/').map(x=>x.replace(/~1/g,'/').replace(/~0/g,'~'));let parent=copy;
   for(const k of keys.slice(0,-1)){if(parent[k]===undefined)throw Error('Synthetic patch missing parent');parent=parent[k];}
   const key=keys.at(-1);
   if(op.op==='test'){if(!same(parent[key],op.value))throw Error('Synthetic409 compare-and-swap conflict');}
   else if(op.op==='remove'){if(!Object.hasOwn(parent,key))throw Error('Synthetic patch absent path');delete parent[key];}
   else if(['replace','add'].includes(op.op)){if(op.op==='replace'&&!Object.hasOwn(parent,key))throw Error('Synthetic replace missing path');parent[key]=clone(op.value);}
   else throw Error('Unexpected patch operation');
  }
  const prior=state[kind];copy.metadata.resourceVersion=String(Number(prior.metadata.resourceVersion)+1);
  if(kind==='worker'&&copy.spec.replicas!==prior.spec.replicas)copy.metadata.generation++;
  state[kind]=copy;reconcile();return clone(state[kind]);
 }
 reconcile();
 const io={now:()=>clock,remaining:()=>10000-clock,sleep:async ms=>{clock+=ms;},read:async(kind,cleanup)=>{
  events.push({type:'read',kind,cleanup});
  if(fault==='hpa-persists'&&kind==='hpas'&&state.controller.metadata.annotations[owner])return {items:[{kind:'HorizontalPodAutoscaler',metadata:{namespace:'releaseguard',ownerReferences:[{kind:'ScaledObject',uid:controller.metadata.uid,controller:true}]},spec:clone(hpaSpec)}]};
  if(fault==='pause-condition-missing'&&kind==='controller'&&state.controller.metadata.annotations[owner]){const x=clone(state.controller);x.status.conditions=[];return x;}
  if(fault==='missing-observed-generation'&&kind==='worker'){const x=clone(state.worker);delete x.status.observedGeneration;return x;}
  return clone(state[kind]);
 },patch:async(kind,ops,cleanup)=>{
  events.push({type:'patch',kind,ops:clone(ops),cleanup});patched++;
  const scaling=kind==='worker'&&ops.some(p=>p.path==='/spec/replicas'&&p.value===3);
  if(!usedFault&&scaling&&fault==='rv-race'){usedFault=true;state.worker.metadata.resourceVersion=String(Number(state.worker.metadata.resourceVersion)+1);}
  if(!usedFault&&kind==='controller'&&fault==='pause-unknown-before'){usedFault=true;throw Error('Synthetic transport unknown');}
  if(!usedFault&&scaling&&fault==='scale-unknown-before'){usedFault=true;throw Error('Synthetic transport unknown');}
  const result=apply(kind,ops);
  if(!usedFault&&(scaling&&fault==='scale-unknown-after'||kind==='controller'&&fault==='pause-unknown-after')){usedFault=true;throw Error('Synthetic transport unknown');}
  return result;
 }};
 return {config,io,state,events,reconcile,apply,patches:()=>patched,advance:ms=>{clock+=ms;}};
}
