// Inactive operator CLI. No Docker/network/credential operation on import.
// A separately authorized invocation may touch only an already-running disposable target.
import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cpus, platform, arch } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { join, dirname } from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
if(typeof import.meta.main!=='boolean')throw Error('Mixed load requires Node24.2+ entry detection');
function deny(){throw Error('Mixed workload denied');}
async function syncDir(path){const h=await open(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{await h.sync();}finally{await h.close();}}
async function directory(path,privateMode=true){
 try{await mkdir(path,{mode:0o700});await syncDir(dirname(path));}catch(e){if(e.code!=='EEXIST')throw e;}
 const s=await lstat(path);if(!s.isDirectory()||s.isSymbolicLink()||(privateMode&&(s.mode&0o077)))deny();
}
async function persist(path,value){
 const h=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 try{await h.writeFile(JSON.stringify(value,null,2)+'\n');await h.sync();}finally{await h.close();}
 await syncDir(dirname(path));
}
async function main(){
 let runDir,phase='guard',entry=0;
 const id=process.env.RG_MIXED_LOAD_RUN_ID;
 const startedAt=new Date().toISOString();
 const began=performance.now(),deadline=began+600000;
 const remaining=()=>{const n=Math.floor(deadline-performance.now());if(n<=0)deny();return n;};
 try{
  if(process.env.RG_MIXED_LOAD_INTEGRATION!=='1'||!uuid.test(id??'')||process.env.CI||process.env.GITHUB_ACTIONS||
   !['darwin','linux'].includes(process.platform)||process.argv.length!==2)deny();
  const seconds=Number(process.env.RG_LOAD_SECONDS??20);
  if(!Number.isInteger(seconds)||seconds<5||seconds>30)deny();
  const env={...process.env,RG_CONTRACTS_INTEGRATION:'1'};
  const {contractTarget,validateContractEnvironment}=await import('./contract-target.mjs');
  const {endpoint}=validateContractEnvironment(env); // No commands/credential reads before all guards.
  let parent=root;
  for(const segment of ['evidence','private','mixed-load']){parent=join(parent,segment);await directory(parent,segment!=='evidence');}
  const proposed=join(parent,id);await mkdir(proposed,{mode:0o700});runDir=proposed;await syncDir(parent);
  await directory(join(runDir,'events'));
  const record=value=>persist(join(runDir,'events',String(++entry).padStart(6,'0')+'.json'),value);
  phase='reservation';await persist(join(runDir,'reserved.json'),{runId:id,status:'reserved',realProviderCalls:0,createdAt:new Date().toISOString()});
  // Only read-only Docker commands are possible in this tool; all IDs are proven below.
  const execute=(bin,args,options)=>{
   remaining();
   if(bin!=='docker'||args[0]!=='--context'||args[1]!=='default')deny();
   const op=args[2];
   if(!['context','version','compose','inspect','exec','stats'].includes(op))deny();
   if(op==='compose'&&JSON.stringify(args.slice(-4,-1))!==JSON.stringify(['ps','--all','--quiet']))deny();
   return execFileSync(bin,args,{...options,timeout:Math.min(options?.timeout??30000,remaining()),stdio:'pipe'});
  };
  const target=contractTarget(env,execute);
  phase='target_proof';const proof=await target.prove();await persist(join(runDir,'target.json'),{project:target.project,containers:proof,observations:target.observations});
  remaining();
  const command=(...args)=>execute('docker',['--context','default',...args],{cwd:root,env,encoding:'utf8',maxBuffer:1024*1024});
  const inspectFormat='{"Id":{{json .Id}},"Image":{{json .Image}},"Labels":{{json .Config.Labels}},"State":{{json .State}},"Ports":{{json .NetworkSettings.Ports}}}';
  function recheck(){
   for(const[service,expected]of Object.entries(proof)){
    const s=JSON.parse(command('inspect','--format',inspectFormat,expected.id));
    if(s.Id!==expected.id||s.Image!==expected.image||s.Labels?.['com.docker.compose.project']!==target.project||s.Labels?.['com.docker.compose.service']!==service||
     !s.State?.Running||s.State.Paused||s.State.Health?.Status!=='healthy')deny();
   }
  }
  const limitsCode="console.log(JSON.stringify({limit:Number(process.env.MAX_JOBS_PER_MINUTE??1000)}))";
  const limit=JSON.parse(target.inside('evaluation',limitsCode)).limit;
  if(!Number.isInteger(limit)||limit<1||limit>1000000)deny();
  phase='credential';
  const credential=await lstat(join(root,'.env'));
  if(!credential.isFile()||credential.isSymbolicLink()||credential.size>65536||(credential.mode&0o077))deny();
  // The existing local development mechanism, contributor roles only. Never a cloud reviewer.
  process.chdir(root);
  const {token}=await import('./dev-tokens.mjs');
  const {application,suite}=await import('./fixtures.mjs');
  if(application.runnerUrl!=='http://support:8080/execute'||suite.cases.length!==10||suite.policy.minScore!==95)deny();
  const {runMixedLoad,seedQuota}=await import('./mixed-load-core.mjs');
  const seedPace=seedQuota({limit,check:remaining,clock:{now:()=>performance.now(),sleep:ms=>delay(Math.min(ms,remaining()))}});
  const telemetry=async()=>{
   recheck();
   const containers=command('stats','--no-stream','--format','{{json .}}',...Object.values(proof).map(s=>s.id)).trim().split('\n').filter(Boolean).map(JSON.parse);
   const code="import pg from 'pg';const c=new pg.Client({connectionString:process.env.DATABASE_URL});try{await c.connect();console.log(JSON.stringify((await c.query(\"SELECT datname,xact_commit,xact_rollback,blks_read,blks_hit,tup_returned,tup_fetched,tup_inserted,tup_updated,deadlocks FROM pg_stat_database WHERE datname=current_database()\")).rows[0]))}finally{await c.end()}";
   return{at:new Date().toISOString(),containers,database:JSON.parse(target.inside('evaluation',code))};
  };
  const rowCount=async workspace=>{
   if(!/^mixed-(?:100|1000)-[0-9a-f-]{36}$/.test(workspace))deny();
   const code="import pg from 'pg';const c=new pg.Client({connectionString:process.env.DATABASE_URL});try{await c.connect();console.log((await c.query('SELECT count(*) FROM jobs WHERE workspace=$1',"+JSON.stringify([workspace])+")).rows[0].count)}finally{await c.end()}";
   const value=Number(target.inside('evaluation',code));if(!Number.isSafeInteger(value)||value<0)deny();return value;
  };
  const transport=async(path,credential,body,key)=>{
   remaining();
   if(!/^(?:applications|suites|jobs(?:\?limit=25&offset=\d+|\/[0-9a-f-]{36}|\/submissions\/[0-9a-f-]{36})?)$/.test(path)||
    (body!==undefined&&!['applications','suites','jobs'].includes(path))||
    (path==='jobs'&&body!==undefined&&(body.source!=='replay'||body.scenario!=='passing')))deny();
   const response=await fetch(endpoint.origin+'/api/v2/'+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+credential,...(body===undefined?{}:{'content-type':'application/json'}),...(key?{'idempotency-key':key}:{})},
    body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(Math.min(15000,remaining()))});
   try{return{status:response.status,data:await response.json()};}catch{return{status:response.status,outcome:'invalid_json'};}
  };
  phase='workload';
  const report=await runMixedLoad({runId:id,seconds,deadlineMs:deadline,assets:{application,suite},key:randomUUID,
   clock:{now:()=>performance.now(),sleep:ms=>delay(Math.min(ms,remaining()))},
   token:(subject,role,workspace)=>token('local-demo-'+subject,role,workspace),record,transport,seedPace,telemetry,rowCount});
  Object.assign(report,{runId:id,startedAt,finishedAt:new Date().toISOString(),host:{platform:platform(),arch:arch(),logicalCpus:cpus().length},target:{project:target.project,endpoint:endpoint.origin,containers:proof},configuredJobsPerMinute:limit,
   recorder:'Per-request durable intents/responses affect closed-loop offered load. API durations exclude file persistence; do not splice with historical in-memory-recorder measurements.',
   identity:'Existing local developer-token mechanism; fixed contributor identities, not real cloud reviewers. Seed pacing is conservative over61s; hard server429 remains a failure, no cap/identity workaround.',
   scope:'Operator run on a proven pre-existing disposable target only. No create/build/up/scale/pause/stop/delete, no model calls or approvals. Health/configuration proof is not cloud or performance acceptance.'});
  phase='report';await persist(join(runDir,'report.json'),report);
  phase='terminal';await persist(join(runDir,'terminal.json'),{runId:id,status:report.passed?'completed':'failed',realProviderCalls:0,report:'report.json'});
  console.log(JSON.stringify({runId:id,status:report.passed?'completed':'failed',realProviderCalls:0}));
  if(!report.passed)process.exitCode=1;
 }catch{
  if(runDir&&phase!=='terminal'){try{await persist(join(runDir,'terminal.json'),{runId:id,status:'incomplete_or_failed',phase,realProviderCalls:0});}catch{}}
  console.error('Mixed workload denied or incomplete. Preserve this private run and do not retry its ID.');process.exitCode=1;
 }
}
if(import.meta.main)await main();
