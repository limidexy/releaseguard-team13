// Strictly owned temporary fixture. All native socket/process forwarding denied.
// The actual CLI, filesystem, HTTP adapter and subprocess boundary still execute.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import dgram from 'node:dgram';
import http from 'node:http';
import https from 'node:https';
import child from 'node:child_process';
import {EventEmitter} from 'node:events';
import {syncBuiltinESMExports} from 'node:module';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {protocolBoundary,token} from './tests/fixtures/cloud-benchmark-protocol.mjs';
import {cloudFixtures} from './tests/fixtures/gcp-evidence-data.mjs';
const root=dirname(fileURLToPath(import.meta.url));if(!root.split('/').at(-1).startsWith('rg-benchmark-owned-'))throw Error('Owned benchmark fixture only');
const c=JSON.parse(fs.readFileSync(join(root,'inputs/config.json'))),fault=process.env.RG_SYNTHETIC_BENCHMARK_FAULT??'',deny=()=>{throw Error('Native external operation forbidden');};
const b=protocolBoundary({...(fault==='unknown-post'?{disconnectPost:6}:{}),mutateJob:(j,row)=>{if(fault==='negative-time'&&row.index===6)j.finished_at='2026-10-10T23:59:59.999Z';if(fault==='failed-warmup'&&row.index===1)j.status='failed';}});
net.Socket.prototype.connect=deny;net.Server.prototype.listen=deny;dgram.createSocket=deny;for(const m of [http,https]){m.request=deny;m.get=deny;}
for(const name of ['spawnSync','exec','execSync','execFile','execFileSync','fork'])child[name]=deny;
globalThis.fetch=async(url,init)=>{
 if(!String(url).startsWith(c.origin+'/'))deny();fs.appendFileSync(join(root,'synthetic-requests.jsonl'),JSON.stringify({url,method:init.method})+'\n',{mode:0o600});
 if(url.endsWith('/protocol/openid-connect/token')){if(init.redirect!=='error'||!String(init.body).includes('grant_type=client_credentials'))deny();return new Response(JSON.stringify({access_token:token,token_type:'Bearer',expires_in:300}),{headers:{'content-type':'application/json'}});}
 if(init.headers.authorization!=='Bearer '+token)deny();return b.fetcher(url,init);
};
const opened=fsp.open;let syncUsed=false;
fsp.open=async(path,...args)=>{
 if(String(path).endsWith('/.env'))deny();const h=await opened(path,...args),sync=h.sync.bind(h);
 h.sync=async()=>{const p=String(path);if(!syncUsed&&(fault==='intent-sync'&&/operations\/.*-intent.json$/.test(p)||fault==='observed-sync'&&/operations\/.*-observed.json$/.test(p)||fault==='terminal-sync'&&p.endsWith('/terminal.json'))){syncUsed=true;throw Error('INSECURE_PRIVATE_DISK_ERROR');}return sync();};return h;
};
let count=0;
child.spawn=(command,args,options)=>{
 const run=join(root,'evidence/private/cloud-benchmark',c.runId),intents=fs.readdirSync(run).filter(n=>/^(?:cleanup-)?native-\d{6}-intent.json$/.test(n)).sort((a,b)=>Number(a.match(/\d{6}/)[0])-Number(b.match(/\d{6}/)[0])),last=JSON.parse(fs.readFileSync(join(run,intents.at(-1))));
 if(last.command!==command||JSON.stringify(last.args)!==JSON.stringify(args)||options.shell||options.env.CLOUDSDK_CONFIG!==c.cloud.gcloudConfigDirectory||options.env.KUBECONFIG!==c.cloud.kubeconfigFile||options.env.HOME||options.env.RELEASEGUARD_TOKEN)deny();
 const kind=last.kind;let value;
 if(['cluster','namespace','nodes'].includes(kind)){
  value=structuredClone(cloudFixtures(c.cloud)[kind]);if(kind==='cluster'){value.currentNodeCount=2;value.nodePools[0].config.machineType='e2-standard-2';}
  if(kind==='nodes')value.items=c.target.nodeNames.map(name=>({metadata:{name},spec:{providerID:'gce://'+c.cloud.project+'/'+c.cloud.zone+'/'+name},status:{conditions:[{type:'Ready',status:'True'}]}}));
  if(fault==='wrong-namespace'&&kind==='namespace')value.metadata.uid='foreign';
 }else if(kind.startsWith('patch-')){
  const selected=kind.slice(6),patch=args.find(a=>a.startsWith('--patch-file='))?.slice(13);if(!patch||!patch.startsWith(run+'/kube-patch-')&&!patch.startsWith(run+'/cleanup-kube-patch-'))deny();
  value=b.f.apply(selected,JSON.parse(fs.readFileSync(patch)));
 }else if(['worker','controller','hpas','pods','replicaSets'].includes(kind))value=structuredClone(b.f.state[kind]);else deny();
 if(fault==='foreign-replica'&&kind==='worker'&&count>30&&b.f.state.worker.spec.replicas===3){b.f.state.worker.spec.replicas=2;b.f.state.worker.metadata.resourceVersion='999';b.f.reconcile();value=structuredClone(b.f.state.worker);}
 fs.appendFileSync(join(root,'synthetic-commands.jsonl'),JSON.stringify({command,args,kind})+'\n',{mode:0o600});count++;
 const p=new EventEmitter();p.stdout=new EventEmitter();p.stderr=new EventEmitter();p.kill=deny;
 queueMicrotask(()=>{if(fault==='command-failure'){p.stderr.emit('data',Buffer.from('original synthetic command failure'));p.emit('close',1,null);}
  else{p.stdout.emit('data',Buffer.from(fault==='duplicate-command-response'?'{"x":1,"x":2}':JSON.stringify(value)));p.emit('close',0,null);}});return p;
};
syncBuiltinESMExports();
