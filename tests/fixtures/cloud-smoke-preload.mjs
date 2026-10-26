// Hermetic child-process boundary. Only copied into an owned test directory;
// native TCP/UDP/HTTP/subprocesses are denied before the actual CLI imports.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import dgram from 'node:dgram';
import http from 'node:http';
import https from 'node:https';
import child from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=dirname(fileURLToPath(import.meta.url)),fault=process.env.RG_SYNTHETIC_SMOKE_FAULT??'',token='INSECURE_TEST_ONLY_SMOKE_TOKEN',deny=()=>{throw Error('Native external IO forbidden');};
net.Socket.prototype.connect=deny;net.Server.prototype.listen=deny;dgram.createSocket=deny;
for(const mod of [http,https]){mod.request=deny;mod.get=deny;}
for(const key of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])child[key]=deny;
const realOpen=fsp.open;let faulted=false;
fsp.open=async function(path,...args){const f=await realOpen(path,...args),name=String(path),sync=f.sync.bind(f);f.sync=async()=>{
 const hit=fault==='started-sync'&&name.endsWith('/started.json')||fault==='observed-sync'&&name.endsWith('/003-observed.json')||fault==='terminal-sync'&&name.endsWith('/terminal.json')||fault==='summary-sync'&&/\/evidence\/cloud-smoke-[^/]+\.json$/.test(name);
 if(hit&&!faulted){faulted=true;throw Error('SYNTHETIC fsync failure');}return sync();};return f;};
syncBuiltinESMExports();
const ids={app:'00000000-0000-4000-8000-000000000002',suite:'00000000-0000-4000-8000-000000000003',job:'00000000-0000-4000-8000-000000000004'};
let application,suite,input;
function intent(name){const dir=join(root,'evidence/private/cloud-smoke',process.env.RG_CLOUD_SMOKE_RUN_ID,'operations');
 const found=fs.readdirSync(dir).filter(p=>p.endsWith('-intent.json')).map(p=>JSON.parse(fs.readFileSync(join(dir,p))));
 if(found.at(-1)?.name!==name)throw Error('Dispatch before durable intent');}
globalThis.fetch=async function(url,init){
 if(init.redirect!=='error'||init.cache!=='no-store')throw Error('Unsafe fetch mode');
 const issuer=url==='https://releaseguard.example.test/identity/realms/synthetic/protocol/openid-connect/token';
 intent(issuer?'authentication':url.endsWith('/applications')?'create-application':url.endsWith('/suites')?'create-suite':init.method==='POST'?'submit-replay':'observe-0');
 if(!String(url).startsWith('https://releaseguard.example.test/'))throw Error('External target refused');
 if(issuer){const form=new URLSearchParams(init.body);if(form.get('client_secret')!=='INSECURE_TEST_ONLY_SECRET'||form.get('grant_type')!=='client_credentials')throw Error('Unexpected credentials');}
 else if(init.headers.authorization!=='Bearer '+token)throw Error('Unexpected authorization');
 fs.appendFileSync(join(root,'synthetic-requests.jsonl'),JSON.stringify({url,method:init.method,body:issuer?null:init.body?JSON.parse(init.body):null,intentPersisted:true})+'\n',{mode:0o600});
 if(issuer)return new Response(JSON.stringify({access_token:token,token_type:'Bearer',expires_in:120}),{headers:{'content-type':'application/json'}});
 if(fault==='http503')return new Response('{"error":"SYNTHETIC_PRIVATE_UPSTREAM_ERROR"}',{status:503,headers:{'content-type':'application/json'}});
 if(fault==='echo')return new Response(JSON.stringify({echo:token}),{headers:{'content-type':'application/json'}});
 let body,status=200;
 if(url.endsWith('/applications')&&init.method==='POST'){application=JSON.parse(init.body);body={id:ids.app,...application};status=201;}
 else if(url.endsWith('/suites')&&init.method==='POST'){suite=JSON.parse(init.body);body={id:ids.suite,version:1,...suite};status=201;}
 else if(url.endsWith('/jobs')&&init.method==='POST'){input=JSON.parse(init.body);if(input.source!=='replay')throw Error('Not replay');body={id:ids.job,status:'queued',replayed:false};status=202;}
 else if(url.endsWith('/jobs/'+ids.job)&&init.method==='GET'){
  body={id:ids.job,input,snapshot:{application:{id:ids.app,data:application},suite:{id:ids.suite,version:1,data:suite}},status:'succeeded',result:{total:10,passed:10,errors:0,criticalFailures:0,score:100,gate:'passed',results:suite.cases.map(c=>({caseId:c.id,status:'passed',output:'SYNTHETIC TEST ONLY',latencyMs:0}))}};
  if(fault==='wrong-source')body.input.source='real';
  if(fault==='source-drift')fs.appendFileSync(join(root,'scripts/cloud-smoke-core.mjs'),'\n// synthetic drift\n');
 }else throw Error('Unexpected route');
 return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
};
