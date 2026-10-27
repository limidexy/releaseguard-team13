import {benchmarkSource,benchmarkFixtures} from './cloud-benchmark-source-pr1.mjs';
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
export async function legacyBenchmark({fault=null,jobs=20}={}){
 const calls=[],commands=[],writes=new Map(),jobMap=new Map();let serial=0,clock=0,replicas=1,scales=0,history=0,unknownIssued=false,tokens=0,externalChange=false;
 const id=()=> '20000000-0000-4000-8000-'+(++serial).toString(16).padStart(12,'0');
 const base='https://synthetic-benchmark.example.invalid';
 const process={argv:[],env:{RG_ALLOW_CLOUD_SMOKE:'true',RG_CLOUD_ALLOWED_ORIGINS:base,RG_JOBS:String(jobs),RG_COMMIT:'1'.repeat(40)},exitCode:0};
 const command=(name,args)=>{
  commands.push({name,args:[...args]});
  const a=args.slice(2);
  if(name!=='kubectl'||args[0]!=='-n'||args[1]!=='releaseguard')throw Error('Unexpected native boundary');
  if(a[0]==='get'&&a[1]==='deployment'&&a[2]==='worker')return JSON.stringify({metadata:{uid:'synthetic-worker-uid',resourceVersion:'1'},spec:{replicas}});
  if(a[0]==='scale'&&a[1]==='deployment/worker'){scales++;replicas=Number(a[2].split('=').at(-1));return 'scaled';}
  if(a[0]==='rollout'&&a[1]==='status')return 'rolled out';
  throw Error('Unexpected native command');
 };
 const required=async(route,token,data,key)=>{
  if(token!=='INSECURE_SYNTHETIC_ONLY')throw Error('Wrong synthetic identity');
  calls.push({route,data:structuredClone(data),key});
  if(route==='applications'&&data)return {id:id(),data:structuredClone(data)};
  if(route==='suites'&&data)return {id:id(),version:1,data:structuredClone(data)};
  if(route==='jobs'&&data){
   const jobId=id(),at=Date.parse('2026-10-11T00:00:00Z'),badTime=fault==='negative-server-time';
   const job={id:jobId,workspace:'synthetic-only',input:structuredClone(data),attempts:1,status:fault==='failed-warmup'&&data.candidate==='cloud-load-warm-0'?'failed':'succeeded',
    created_at:new Date(at).toISOString(),started_at:new Date(at+10).toISOString(),finished_at:new Date(at+(badTime?-10:20)).toISOString(),
    worker_id:'synthetic-worker-'+(serial%replicas),result:{gate:'passed'}};
   jobMap.set(jobId,job);
   if(fault==='unknown-after-accepted'&&!unknownIssued&&!data.candidate.includes('warm-')){unknownIssued=true;throw Error('INSECURE_SYNTHETIC_UNKNOWN_AFTER_ACCEPTED');}
   return {id:jobId};
  }
  if(route.startsWith('jobs/')){const job=jobMap.get(route.slice(5));if(!job)throw Error('Unknown synthetic job');return structuredClone(job);}
  if(route.startsWith('jobs?')){history++;if(fault==='concurrent-replica-change'&&history===800){replicas=2;externalChange=true;}return [];}
  throw Error('Unexpected fake HTTP route');
 };
 const cloudToken=async()=>{tokens++;return 'INSECURE_SYNTHETIC_ONLY';};
 await new AsyncFunction('execFileSync','mkdir','writeFile','base','required','key','cloudToken','application','suite','process','performance','console',benchmarkSource.replace(/^import .*;\n/gm,''))(
  command,async()=>{},async(path,value)=>{writes.set(path,value);},base,required,()=> 'synthetic-key-'+(++serial),cloudToken,
  structuredClone(benchmarkFixtures.application),structuredClone(benchmarkFixtures.suite),process,{now:()=>clock+=10},{log:()=>{}});
 const report=JSON.parse(writes.get('evidence/current/cloud-benchmark.json'));
 return {report,calls,commands,tokens,replicas,externalChange,exitCode:process.exitCode,writes,jobMap,scales};
}
