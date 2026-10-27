// SIMULATION ONLY: immutable source, in-memory API/process/files/clock boundaries.
// This executes the original control flow, never kubectl, a provider or a target.
import {autoscaleSource,autoscaleFixtures} from './cloud-autoscale-source-pr1.mjs';
import {createHash} from 'node:crypto';
import net from 'node:net';
const denied=()=>{throw Error('Native network forbidden in frozen source simulation');};
net.Socket.prototype.connect=denied;net.Server.prototype.listen=denied;globalThis.fetch=denied;
const source=autoscaleSource;
if(createHash('sha256').update(source).digest('hex')!=='ac436fa21f4e5b1561de3352f83e78276b583574493c7eaed1dd00266ab2fe1f')throw Error('Frozen source changed');
export const fixtures=structuredClone(autoscaleFixtures);
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
export async function simulateFrozenAutoscale({fault=null}={}){
 const calls=[],commands=[],trace=[],printed=[],writes=new Map(),jobs=new Map(),epoch=Date.parse('2000-01-01T00:00:00Z');
 let clock=0,serial=0,auth=0,postCount=0,unknownIssued=false,eventsRead=false,released=false,observations=0,externalChange=false;
 const annotations={},initial={min:1,replicas:1,annotations:{}},state={min:1,replicas:1,ready:1,annotations};
 const uuid=()=> '40000000-0000-4000-8000-'+String(++serial).padStart(12,'0');
 class SimulatedDate extends Date{constructor(...args){super(...(args.length?args:[epoch+clock]));}static now(){return epoch+clock;}}
 const now=()=>new SimulatedDate().toISOString(),base='https://synthetic-autoscale.example.invalid';
 const process={env:{RG_ALLOW_CLOUD_SMOKE:'true',RG_CLOUD_ALLOWED_ORIGINS:base,RG_COMMIT:'1'.repeat(40)},argv:[],exitCode:0};
 const command=(program,args)=>{
  if(program!=='kubectl'||args[0]!=='-n'||args[1]!=='releaseguard')throw Error('Unexpected simulated native boundary');
  const a=args.slice(2);commands.push({program,args:[...args]});trace.push({type:'command',index:commands.length,args:[...a]});
  if(a[0]==='get'&&a[1]==='scaledobject')return JSON.stringify({metadata:{uid:'SIMULATED_CONTROLLER_UID'},spec:{minReplicaCount:state.min,maxReplicaCount:3}});
  if(a[0]==='get'&&a[1]==='deployment'){
   if(released){observations++;state.replicas=fault==='no-scale-out'?1:observations===1?3:1;state.ready=state.replicas;}
   return JSON.stringify({metadata:{uid:'SIMULATED_WORKER_UID',resourceVersion:String(commands.length)},spec:{replicas:state.replicas},status:{replicas:state.replicas,readyReplicas:state.ready}});
  }
  if(a[0]==='get'&&a[1]==='hpa')return JSON.stringify({metadata:{uid:'SIMULATED_HPA_UID',creationTimestamp:new Date(epoch).toISOString()},spec:{behavior:{scaleUp:{selectPolicy:annotations['autoscaling.keda.sh/paused-scale-out']==='true'?'Disabled':'Max'}}},status:{desiredReplicas:state.replicas,currentMetrics:[{type:'External',external:{metric:{name:'s0-rabbitmq-releaseguard-evaluate'},current:{averageValue:'0'}}}],conditions:[{type:'ScalingActive',status:'True'}]}});
  if(a[0]==='get'&&a[1]==='--raw')return JSON.stringify({kind:'ExternalMetricValueList',apiVersion:'external.metrics.k8s.io/v1beta1',items:[{metricName:fault==='foreign-metric'?'foreign-queue':'s0-rabbitmq-releaseguard-evaluate',metricLabels:{'scaledobject.keda.sh/name':fault==='foreign-metric'?'foreign-controller':'evaluation-worker'},namespace:fault==='foreign-metric'?'foreign':'releaseguard',timestamp:now(),value:'0'}]});
  if(a[0]==='get'&&a[1]==='events'){
   eventsRead=true;if(fault==='concurrent-replica-change'){externalChange=true;state.replicas=2;state.ready=2;annotations['external-owner']='another-actor';}
   return JSON.stringify({items:[{reason:'SuccessfulRescale',message:'SIMULATED observation only',lastTimestamp:now()}]});
  }
  if(a[0]==='patch'&&a[1]==='scaledobject'){
   if(eventsRead&&fault==='cleanup-command-failure')throw Error('SIMULATED cleanup command failed');
   state.min=JSON.parse(a.at(-1)).spec.minReplicaCount;if(state.min===0&&!annotations['autoscaling.keda.sh/paused-replicas'])state.replicas=state.ready=0;
   return 'SIMULATED patched';
  }
  if(a[0]==='annotate'&&a[1]==='scaledobject/evaluation-worker'){
   const item=a[2];if(item.endsWith('-'))delete annotations[item.slice(0,-1)];else{const eq=item.indexOf('=');annotations[item.slice(0,eq)]=item.slice(eq+1);}
   const pause=annotations['autoscaling.keda.sh/paused-replicas'];if(pause!==undefined){state.replicas=state.ready=Number(pause);}
   if(item==='autoscaling.keda.sh/paused-scale-out-'&&!eventsRead&&postCount===700&&state.min===1)released=true;
   return 'SIMULATED annotated';
  }
  throw Error('Unexpected simulated native command');
 };
 const required=async(route,token,data,key)=>{
  if(token!=='INSECURE_SIMULATED_TOKEN')throw Error('Unexpected simulated credential');
  calls.push({route,data:structuredClone(data),key});trace.push({type:'api',index:calls.length,route});clock++;
  if(route==='applications'&&data)return {id:uuid()};
  if(route==='suites'&&data){if(data.cases?.length!==10||data.policy?.minScore!==95)throw Error('Original fixture changed');return {id:uuid(),version:1};}
  if(route==='jobs'&&data){
   if(data.source!=='replay'||data.appId===undefined||data.suiteId===undefined)throw Error('Only original replay accepted by simulation');postCount++;
   const id=uuid();jobs.set(id,{id,input:structuredClone(data),status:'succeeded',attempts:1,worker_id:'SIMULATED_WORKER_'+postCount%3,result:{gate:'passed'}});
   if(fault==='unknown-after-accepted'&&!unknownIssued){unknownIssued=true;throw Error('SIMULATED accepted POST outcome unknown');}
   return {id};
  }
  if(route.startsWith('jobs/')){const j=structuredClone(jobs.get(route.slice(5)));if(!j)throw Error('Unexpected simulated job');if(fault==='duplicate-job-response')j.id=jobs.keys().next().value;return j;}
  throw Error('Unexpected simulated API route');
 };
 const run=new AsyncFunction('execFileSync','mkdir','writeFile','required','key','base','cloudToken','application','suite','process','Date','setTimeout','console',source.replace(/^import .*;\n/gm,''));
 await run(command,async()=>{},async(name,bytes)=>{trace.push({type:'write',name});writes.set(name,bytes);},required,()=> 'SIMULATED_KEY_'+uuid(),base,async()=>{auth++;return 'INSECURE_SIMULATED_TOKEN';},
  structuredClone(fixtures.application),structuredClone(fixtures.suite),process,SimulatedDate,(fn,ms)=>{clock+=ms;queueMicrotask(fn);return 1;},{log:value=>printed.push(String(value))});
 // Drain already-created source promises. This observes their original behavior;
 // it never resends or starts another source invocation.
 await new Promise(resolve=>setImmediate(resolve));
 const rawReport=writes.get('evidence/current/cloud-autoscale.json');if(!rawReport)throw Error('Original report missing');
 return {simulationOnly:true,actualCloudCalls:0,actualModelCalls:0,rawReport,report:JSON.parse(rawReport),calls,commands,trace,printed,initial,state:structuredClone(state),externalChange,postCount,auth,exitCode:process.exitCode};
}
