// Owned simulation ONLY. Real private CLI/files/native/HTTP boundaries execute,
// with process forwarding, sockets, listeners and external fetch prohibited.
//150s warm-up/210s windows use an explicitly synthetic monotonic clock.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import dgram from 'node:dgram';
import http from 'node:http';
import https from 'node:https';
import child from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {EventEmitter} from 'node:events';
import {syncBuiltinESMExports} from 'node:module';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {workerPauseBoundary,token} from './tests/fixtures/worker-pause-protocol.mjs';
import {cloudFixtures} from './tests/fixtures/gcp-evidence-data.mjs';
const root=dirname(fileURLToPath(import.meta.url));if(!root.split('/').at(-1).startsWith('rg-worker-pause-owned-'))throw Error('Owned autoscale fixture only');
const c=JSON.parse(fs.readFileSync(join(root,'inputs/config.json'))),fault=process.env.RG_SYNTHETIC_WORKER_PAUSE_FAULT??'',deny=()=>{throw Error('Native external operation forbidden');};
const b=workerPauseBoundary({profile:c.target.controllerProfile,postcondition:c.postcondition,disconnectPost:fault==='unknown-post'?1:undefined,foreignMetric:fault==='foreign-metric',externalReplica:fault==='foreign-replica',cleanupFailure:fault==='cleanup-failure',unknownCONT:fault==='unknown-cont',foreignPod:fault==='foreign-pod',unknownStartAfter:fault==='unknown-start-after',
 mutateJob:(j,row)=>{if(fault==='negative-time'&&row.index===6)j.finished_at='2026-10-10T23:59:59.999Z';if(fault==='duplicate-job')j.id='00000000-0000-4000-8000-000000000003';}});
net.Socket.prototype.connect=deny;net.Server.prototype.listen=deny;dgram.createSocket=deny;for(const m of [http,https]){m.request=deny;m.get=deny;}
for(const name of ['spawnSync','exec','execSync','execFile','execFileSync','fork'])child[name]=deny;
Object.defineProperty(performance,'now',{value:b.f.io.now,configurable:true});Date.now=b.io.wallNow;
const timer=globalThis.setTimeout;globalThis.setTimeout=(fn,ms,...args)=>{if(ms<=5000)return timer(()=>{b.f.advance(ms);fn(...args);},0);return timer(fn,ms,...args);};
globalThis.fetch=async(url,init)=>{
 if(!String(url).startsWith(c.origin+'/'))deny();fs.appendFileSync(join(root,'synthetic-requests.jsonl'),JSON.stringify({url,method:init.method})+'\n',{mode:0o600});
 if(url.endsWith('/protocol/openid-connect/token')){if(init.redirect!=='error'||!String(init.body).includes('grant_type=client_credentials'))deny();return new Response(JSON.stringify({access_token:fault==='malformed-issuer-token'?'true':token,token_type:'Bearer',expires_in:300}),{headers:{'content-type':'application/json'}});}
 if(init.headers.authorization!=='Bearer '+token)deny();return b.fetcher(url,init);
};
const opened=fsp.open;let syncUsed=false;
fsp.open=async(path,...args)=>{
 if(String(path).endsWith('/.env'))deny();const h=await opened(path,...args),sync=h.sync.bind(h);
 h.sync=async()=>{const p=String(path);if(!syncUsed&&(fault==='intent-sync'&&/operations\/.*-intent.json$/.test(p)||fault==='observed-sync'&&/operations\/.*-observed.json$/.test(p)||fault==='terminal-sync'&&p.endsWith('/terminal.json'))){syncUsed=true;throw Error('INSECURE_PRIVATE_DISK_ERROR');}return sync();};return h;
};
child.spawn=(command,args,options)=>{
 const run=join(root,'evidence/private/cloud-worker-pause',c.runId),intents=fs.readdirSync(run).filter(n=>/^(?:cleanup-)?native-\d{6}-intent.json$/.test(n)).sort((a,b)=>Number(a.match(/\d{6}/)[0])-Number(b.match(/\d{6}/)[0])),last=JSON.parse(fs.readFileSync(join(run,intents.at(-1))));
 if(last.command!==command||JSON.stringify(last.args)!==JSON.stringify(args)||options.shell||options.env.CLOUDSDK_CONFIG!==c.cloud.gcloudConfigDirectory||options.env.KUBECONFIG!==c.cloud.kubeconfigFile||options.env.HOME||options.env.RELEASEGUARD_TOKEN)deny();
 const kind=last.kind;fs.appendFileSync(join(root,'synthetic-commands.jsonl'),JSON.stringify({command,args,kind,cleanup:last.cleanup})+'\n',{mode:0o600});
 const p=new EventEmitter();p.stdout=new EventEmitter();p.stderr=new EventEmitter();p.kill=deny;
 queueMicrotask(async()=>{try{
  if(fault==='command-failure')throw Error('Synthetic command failure');let value;
  if(['cluster','namespace','nodes'].includes(kind)){
   value=structuredClone(cloudFixtures(c.cloud)[kind]);if(kind==='cluster'){value.currentNodeCount=2;value.nodePools[0].config.machineType='e2-standard-2';}
   if(kind==='nodes')value.items=c.target.nodeNames.map(name=>({metadata:{name},spec:{providerID:'gce://'+c.cloud.project+'/'+c.cloud.zone+'/'+name},status:{conditions:[{type:'Ready',status:'True'}]}}));
   if(fault==='wrong-namespace'&&kind==='namespace')value.metadata.uid='foreign';
  }else if(kind.startsWith('patch-')){
   const patch=args.find(a=>a.startsWith('--patch-file='))?.slice(13);if(!patch||!patch.startsWith(run+'/kube-patch-')&&!patch.startsWith(run+'/cleanup-kube-patch-'))deny();
   value=await b.nativePatch(kind.slice(6),JSON.parse(fs.readFileSync(patch)),last.cleanup);
  }else if(kind.startsWith('fault-')){
   const packet=JSON.parse(args.at(-1)),podName=args[args.indexOf('exec')+1];
   if(args[args.indexOf('exec')+2]!=='-c'||args[args.indexOf('exec')+3]!=='worker'||args.at(-3)!=='-e')deny();
   value=await b.nativeExec(kind,{name:podName,uid:packet.podUID},packet,last.cleanup);
  }else value=await b.nativeRead(kind,last.cleanup);
  if(fault==='late-credential-echo'&&kind==='worker'&&b.calls.length>0)value.metadata.annotations.echo=token;
  p.stdout.emit('data',Buffer.from(fault==='duplicate-command-response'?'{"x":1,"x":2}':JSON.stringify(value)));p.emit('close',0,null);
 }catch{p.stderr.emit('data',Buffer.from('Synthetic command failure or unknown'));p.emit('close',1,null);}});return p;
};
syncBuiltinESMExports();
