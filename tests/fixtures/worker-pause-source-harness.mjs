// SIMULATION ONLY. Frozen original source executes with in-memory process,
// API, filesystem and watchdog/clock boundaries. Never sends an OS signal,
// starts a child process, opens a socket or calls a cloud/model/database.
import {workerPauseSource,workerPauseFixtureText} from './worker-pause-source-pr1.mjs';
import {createHash} from 'node:crypto';
import net from 'node:net';
const denied=()=>{throw Error('Native network forbidden in source simulation');};
net.Socket.prototype.connect=denied;net.Server.prototype.listen=denied;globalThis.fetch=denied;
const source=workerPauseSource;
const state={sourceSHA256:'546cbe47e714cbdf4d151c7b50fa4b2aa7b40eedac82740ccf792375384f3663'};
if(createHash('sha256').update(source).digest('hex')!=='546cbe47e714cbdf4d151c7b50fa4b2aa7b40eedac82740ccf792375384f3663')throw Error('Frozen source changed');
const fixtureBytes=Buffer.from(workerPauseFixtureText);
if(createHash('sha256').update(fixtureBytes).digest('hex')!=='f2861c2608b7f97b510d5e8c0cd4706000bfd6efd3d58142cc90c474b9e688d2')throw Error('Frozen fixture changed');
const fixture=JSON.parse(fixtureBytes);
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
export async function simulateWorkerPause({fault=null}={}){
 const epoch=Date.parse('2000-01-01T00:00:00Z'),base='https://synthetic-worker-pause.example.invalid',calls=[],commands=[],trace=[],prints=[],writes=new Map(),jobs=new Map(),timers=new Map();
 let clock=0,serial=0,timerSerial=0,auth=0,postCount=0,observations=0,stopCount=0,resumeCount=0,unknownUsed=false,externalChange=false;
 const actual={paused:false,uid:'SIMULATED_ORIGINAL_POD_UID',replicas:1,annotations:{'autoscaling.keda.sh/paused-replicas':'1'}};
 class SimulatedDate extends Date{constructor(...args){super(...(args.length?args:[epoch+clock]));}static now(){return epoch+clock;}}
 const uuid=()=> '50000000-0000-4000-8000-'+String(++serial).padStart(12,'0'),at=()=>new SimulatedDate().toISOString();
 function advance(ms){clock+=ms;for(const [id,t]of [...timers])if(t.due<=clock){timers.delete(id);t.fn();}}
 const native=(program,args)=>{
  if(program!=='kubectl'||args[0]!=='-n'||args[1]!=='releaseguard')throw Error('Unexpected simulated command');
  const a=args.slice(2);commands.push({program,args:[...args],at:at()});trace.push({type:'command',index:commands.length,args:[...a]});
  if(a[0]==='annotate'){
   if(a[2]==='autoscaling.keda.sh/paused-replicas=1'&&fault==='cleanup-failure')throw Error('SIMULATED cleanup failure');
   if(a[2].endsWith('-'))delete actual.annotations[a[2].slice(0,-1)];else actual.annotations['autoscaling.keda.sh/paused-replicas']='1';return 'SIMULATED annotated';
  }
  if(a[0]==='get'&&a[1]==='hpa')return JSON.stringify({metadata:{name:'keda-hpa-evaluation-worker',namespace:fault==='foreign-hpa'?'foreign':'releaseguard',uid:fault==='foreign-hpa'?'FOREIGN_HPA':'SIMULATED_HPA_UID'},
   status:{desiredReplicas:actual.replicas,conditions:[{type:'ScalingActive',status:'True'}],currentMetrics:[{type:'External',external:{metric:{name:'SIMULATED_QUEUE'},current:{averageValue:'0'}}}]}});
  if(a[0]==='get'&&a[1]==='deployment'){
   observations++;actual.replicas=observations===1?3:1;return JSON.stringify({spec:{replicas:actual.replicas},status:{readyReplicas:actual.replicas}});
  }
  if(a[0]==='get'&&a[1]==='pods')return JSON.stringify({items:[{metadata:{name:'simulated-worker-pod',namespace:'releaseguard',uid:actual.uid},status:{conditions:[{type:'Ready',status:'True'}]}}]});
  if(a[0]==='exec'&&a[1]==='simulated-worker-pod'&&a[2]==='--'&&a[3]==='node'&&a[4]==='-e'){
   if(a[5]==="process.kill(1,'SIGSTOP')"){
    stopCount++;actual.paused=true;if(fault==='pod-name-reuse'){actual.uid='FOREIGN_REUSED_POD_UID';externalChange=true;}return 'SIMULATED stop acknowledged';
   }
   if(a[5]==="process.kill(1,'SIGCONT')"){
    resumeCount++;actual.paused=false;trace.push({type:'resume',targetUID:actual.uid,at:at()});
    if(fault==='unknown-resume-after'&&!unknownUsed){unknownUsed=true;throw Error('SIMULATED resume applied but response unknown');}return 'SIMULATED resume acknowledged';
   }
  }
  throw Error('Unexpected simulated boundary');
 };
 const required=async(route,token,data,key)=>{
  if(token!=='INSECURE_SIMULATED_TOKEN')throw Error('Unexpected simulated credential');
  calls.push({route,data:structuredClone(data),key});trace.push({type:'api',index:calls.length,route});advance(40);
  if(route==='applications'&&data)return {id:uuid()};
  if(route==='suites'&&data){if(data.cases?.length!==10||data.policy.minScore!==95)throw Error('Fixture changed');return {id:uuid(),version:1};}
  if(route==='jobs'&&data){postCount++;if(data.source!=='replay')throw Error('Nonreplay refused');const id=uuid();jobs.set(id,{id,status:'succeeded',attempts:1,worker_id:'SIMULATED_WORKER_'+postCount%3,result:{gate:'passed'}});
   if(fault==='unknown-post'&&!unknownUsed){unknownUsed=true;throw Error('SIMULATED accepted POST outcome unknown');}return {id};
  }
  if(route.startsWith('jobs/')){const j=structuredClone(jobs.get(route.slice(5)));if(!j)throw Error('Unexpected job');if(fault==='duplicate-job')j.id=jobs.keys().next().value;return j;}
  throw Error('Unexpected simulated route');
 };
 const process={env:{RG_ALLOW_CLOUD_SMOKE:'true',RG_CLOUD_ALLOWED_ORIGINS:base,RG_COMMIT:'1'.repeat(40)},argv:[],exitCode:0};
 const fn=new AsyncFunction('execFileSync','mkdir','writeFile','base','required','key','cloudToken','application','suite','process','Date','setTimeout','clearTimeout','console',source.replace(/^import .*;\n/gm,''));
 await fn(native,async()=>{},async(path,bytes)=>{trace.push({type:'write',path});writes.set(path,bytes);},base,required,()=> 'SIMULATED_KEY_'+uuid(),async()=>{auth++;return 'INSECURE_SIMULATED_TOKEN';},
  structuredClone(fixture.application),structuredClone(fixture.suite),process,SimulatedDate,(callback,ms)=>{const id=++timerSerial;if(ms===17000)timers.set(id,{due:clock+ms,fn:callback});else{advance(ms);queueMicrotask(callback);}return id;},id=>timers.delete(id),{log:value=>prints.push(String(value))});
 await new Promise(resolve=>setImmediate(resolve));
 const rawReport=writes.get('evidence/current/cloud-autoscale-worker-pause.json');if(!rawReport)throw Error('Original report missing');
 return {simulationOnly:true,actualOSSignals:0,actualCloudCalls:0,actualModelCalls:0,actualDatabaseCalls:0,sourceSHA256:state.sourceSHA256,rawReport,report:JSON.parse(rawReport),calls,commands,trace,prints,
  actual:structuredClone(actual),postCount,auth,stopCount,resumeCount,externalChange,exitCode:process.exitCode,clockMs:clock};
}
