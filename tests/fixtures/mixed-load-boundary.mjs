// Owned offline boundary only. No command/socket/fetch fallback is ever allowed.
import fs from 'node:fs/promises';
import fss from 'node:fs';
import child from 'node:child_process';
import net from 'node:net';
import timers from 'node:timers/promises';
import {syncBuiltinESMExports} from 'node:module';
import {resolve,basename,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
const supplied=process.env.RG_MIXED_FIXTURE_ROOT;
if(!supplied||!basename(supplied).startsWith('rg-mixed-load-'))throw Error('Not owned');
const root=await fs.realpath(supplied),mode=process.env.RG_MIXED_FIXTURE_MODE??'guard';
const read=fs.readFile.bind(fs),open=fs.open.bind(fs),write=fs.writeFile.bind(fs),append=fss.appendFileSync.bind(fss);
const project=process.env.COMPOSE_PROJECT_NAME;
let port='55871';try{port=new URL(process.env.RELEASEGUARD_URL??'http://127.0.0.1:5189').port;}catch{}
let proven=false,now=0,credentialReads=0;
const intents=new Map(),jobs=new Map(),keys=new Map();
const services=['postgres','rabbitmq','registry','evaluation','governance','support','worker','gateway'];
const states=new Map(services.map((service,i)=>[service,{Id:String(i+1).padStart(64,'0'),Image:'sha256:'+'a'.repeat(64),
 Labels:{'com.docker.compose.project':project,'com.docker.compose.service':service},State:{Running:true,Paused:false,Health:{Status:'healthy'}},
 Ports:service==='gateway'?{'8080/tcp':[{HostIp:mode==='binding'?'0.0.0.0':'127.0.0.1',HostPort:port}]}:{}}]));
if(mode==='foreign')states.get('registry').Labels['com.docker.compose.project']='releaseguard-team13';
function trace(value){append(join(root,'boundary-trace.jsonl'),JSON.stringify(value)+'\n');}
function blocked(kind){console.error('BOUNDARY_ATTEMPT:'+kind);throw Error('Owned fake boundary blocked');}
function credential(path){
 const p=path instanceof URL?fileURLToPath(path):String(path);
 if(!p.endsWith('/.env')&&p!=='.env')return;
 if(mode==='guard'||!proven||resolve(p)!==resolve(root,'.env'))blocked('credential');
 credentialReads++;trace({credentialReads});
}
fs.readFile=async(path,...args)=>{credential(path);return read(path,...args);};
const readSync=fss.readFileSync.bind(fss);
fss.readFileSync=(path,...args)=>{credential(path);return readSync(path,...args);};
fs.open=async(path,...args)=>{
 const h=await open(path,...args),p=String(path),originalWrite=h.writeFile.bind(h),originalSync=h.sync.bind(h);let value;
 h.writeFile=async bytes=>{try{value=JSON.parse(String(bytes));}catch{};return originalWrite(bytes);};
 h.sync=async()=>{
  if(mode==='intent-sync-failure'&&value?.kind==='request_intent'&&value.body?.source==='replay')throw Error('OWNED_FAKE_SECRET_ERROR');
  await originalSync();if(value?.kind==='request_intent'&&value.key)intents.set(value.key,value);
 };
 if(mode==='terminal-collision'&&p.endsWith('/report.json'))await write(join(root,'evidence/private/mixed-load',process.env.RG_MIXED_LOAD_RUN_ID,'terminal.json'),'original-terminal\n',{flag:'wx'});
 return h;
};
Object.defineProperty(performance,'now',{value:()=>now,configurable:true});
timers.setTimeout=async ms=>{now+=ms;await Promise.resolve();};
net.Socket.prototype.connect=function(){blocked('TCP');};
for(const name of ['spawn','spawnSync','exec','execSync','execFile','fork'])child[name]=()=>blocked('process');
child.execFileSync=(bin,all,options)=>{
 if(mode==='guard')blocked('process');
 if(bin!=='docker'||all[0]!=='--context'||all[1]!=='default')blocked('command');
 const[op,...args]=all.slice(2);trace({command:op});
 if(op==='context')return JSON.stringify(mode==='remote'?'ssh://unrelated':'unix:///synthetic/docker.sock');
 if(op==='version')return 'synthetic-offline-engine';
 if(op==='compose'){
  if(args.at(-4)!=='ps'||args.at(-3)!=='--all'||args.at(-2)!=='--quiet')blocked('mutation');
  const service=args.at(-1),s=states.get(service);return mode==='replicas'&&service==='worker'?s.Id+'\n'+'f'.repeat(64):s.Id;
 }
 if(op==='inspect'){
  const s=[...states.values()].find(x=>x.Id===args.at(-1));if(!s)blocked('foreign-container');return JSON.stringify(s);
 }
 if(op==='stats'){
  if(args.slice(3).some(id=>![...states.values()].some(s=>s.Id===id)))blocked('foreign-stats');
  return [...states.values()].map(s=>JSON.stringify({ID:s.Id,CPUPerc:'1.0%',MemUsage:'synthetic'})).join('\n');
 }
 if(op!=='exec')blocked('mutation');
 const service=services.find(s=>states.get(s).Id===args[0]);const code=args.at(-1);
 if(service==='support'&&code==="if(process.env.ALLOW_REAL_MODEL!=='false')process.exit(1)"){
  if(mode==='model')throw Error('OWNED_FAKE_SECRET_ERROR');proven=true;trace({proven:true});return '';
 }
 if(!proven||service!=='evaluation')blocked('unproven-exec');
 if(code.includes('MAX_JOBS_PER_MINUTE'))return JSON.stringify({limit:mode==='low-quota'?100:1000});
 if(code.includes('pg_stat_database'))return JSON.stringify({datname:'synthetic-evaluation',xact_commit:jobs.size,xact_rollback:0,blks_read:0,blks_hit:100,tup_returned:jobs.size,tup_fetched:0,tup_inserted:jobs.size,tup_updated:0,deadlocks:0});
 if(code.includes("SELECT count(*) FROM jobs WHERE workspace=$1")){
  const ws=code.match(/\["(mixed-[^"]+)"\]/)?.[1];if(!ws)blocked('unparameterized-count');
  return String([...jobs.values()].filter(j=>j.workspace===ws).length);
 }
 blocked('arbitrary-exec');
};
globalThis.fetch=async(url,init)=>{
 if(mode==='guard'||!proven)blocked('fetch');
 const u=new URL(url);if(u.origin!==new URL(process.env.RELEASEGUARD_URL).origin||!u.pathname.startsWith('/api/v2/'))blocked('origin');
 const token=init.headers.authorization?.slice(7);let actor;try{actor=JSON.parse(Buffer.from(token.split('.')[1],'base64url'));}catch{blocked('identity');}
 if(actor.role!=='contributor'||!['local-demo-seed-author','local-demo-load-author'].includes(actor.sub)||!actor.workspace?.startsWith('mixed-'))blocked('role');
 const path=u.pathname.slice(8),body=init.body?JSON.parse(init.body):undefined,key=init.headers['idempotency-key'];
 if(body){
  const intent=intents.get(key);if(!intent||intent.path!==path||JSON.stringify(intent.body)!==JSON.stringify(body))blocked('persist-first');
 }
 trace({http:init.method,path,workspace:actor.workspace,source:body?.source,candidate:body?.candidate,subject:actor.sub,atMs:now,key});
 now++;
 if(path==='applications'||path==='suites')return Response.json({id:randomUUID()},{status:201});
 if(path==='jobs'&&body){
  if(body.source!=='replay'||body.scenario!=='passing'||!body.candidate.startsWith('load-'))blocked('model');
  const measured=/^load-\d+$/.test(body.candidate);
  if(['http429','terminal-collision'].includes(mode)&&measured)return Response.json({error:'OWNED_FAKE_SECRET_ERROR'},{status:429});
  const id=randomUUID(),job={id,workspace:actor.workspace,status:'succeeded',input:body,result:{gate:'passed',total:10}};
  jobs.set(id,job);keys.set(key,id);
  if(mode==='unknown-saved'&&measured)throw Error('OWNED_FAKE_SECRET_ERROR');
  return Response.json({id},{status:202});
 }
 if(path.startsWith('jobs/submissions/')){const id=keys.get(path.split('/').at(-1));return id?Response.json({id,submissionState:'accepted'}):Response.json({definitive:false,doNotResubmit:true},{status:404});}
 if(path.startsWith('jobs/'))return Response.json(jobs.get(path.split('/')[1]));
 if(path==='jobs')return Response.json([...jobs.values()].filter(j=>j.workspace===actor.workspace).slice(0,25));
 blocked('unexpected-route');
};
syncBuiltinESMExports();
