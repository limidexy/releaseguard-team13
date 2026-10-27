// Only a disposable owned test directory is accepted. All native network and
// process forwarding is denied; the real CLI and subprocess wrapper still run.
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
import {cloudFixtures} from './tests/fixtures/gcp-evidence-data.mjs';
const root=dirname(fileURLToPath(import.meta.url));if(!root.split('/').at(-1).startsWith('rg-evidence-owned-'))throw Error('Owned evidence fixture only');
const c=JSON.parse(fs.readFileSync(join(root,'inputs/config.json'),'utf8')),fault=process.env.RG_SYNTHETIC_EVIDENCE_FAULT??'',denied=()=>{throw Error('Native external operation forbidden');};
globalThis.fetch=denied;net.Socket.prototype.connect=denied;net.Server.prototype.listen=denied;dgram.createSocket=denied;
for(const m of [http,https]){m.request=denied;m.get=denied;}
for(const k of ['spawnSync','exec','execSync','execFile','execFileSync','fork'])child[k]=denied;
const opened=fsp.open;let syncedFault=false;
fsp.open=async(path,...args)=>{
 if(String(path).endsWith('/.env'))denied();const h=await opened(path,...args),sync=h.sync.bind(h),write=h.writeFile.bind(h);
 h.writeFile=async(value,...rest)=>write(fault==='archive-corruption'&&String(path).endsWith('/cloud-acceptance.json')&&!String(path).includes('/inputs/')?'{"corrupt":true}\n':value,...rest);
 h.sync=async()=>{const name=String(path);if(!syncedFault&&(fault==='intent-sync'&&name.endsWith('-intent.json')||fault==='observed-sync'&&name.endsWith('-observed.json')||fault==='terminal-sync'&&name.endsWith('/terminal.json')||fault==='archive-sync'&&name.endsWith('/cloud-autoscale-first-capacity-failed.json')&&!name.includes('/inputs/'))){syncedFault=true;throw Error('INSECURE_PRIVATE_STORAGE_DIAGNOSTIC');}return sync();};return h;
};
let count=0,mig=0;
child.spawn=(command,args,options)=>{
 if(!c.cloud)denied();const x=c.cloud,f=cloudFixtures(x),run=join(root,'evidence/private/cloud-evidence',c.runId),operations=join(run,'operations');
 const intents=fs.readdirSync(operations).filter(n=>n.endsWith('-intent.json')).sort(),last=JSON.parse(fs.readFileSync(join(operations,intents.at(-1)),'utf8'));
 if(last.command!==command||JSON.stringify(last.args)!==JSON.stringify(args)||!fs.existsSync(join(run,'started.json'))||options.shell||options.env.CLOUDSDK_CONFIG!==x.gcloudConfigDirectory||options.env.KUBECONFIG!==x.kubeconfigFile||options.env.RELEASEGUARD_TOKEN||options.env.HOME)denied();
 const allowed=command===x.gcloudExecutable?(args[0]==='container'&&args[1]==='clusters'&&args[2]==='describe'||args[0]==='compute'&&args[1]==='instances'&&args[2]==='list'||args[0]==='compute'&&args[1]==='instance-groups'&&args[2]==='managed'&&['describe','list-instances'].includes(args[3])):
  command===x.kubectlExecutable&&args[0]==='--kubeconfig='+x.kubeconfigFile&&args[1]==='--context='+x.context&&args.includes('get')&&!args.includes('exec');
 if(!allowed)denied();
 const kind=last.kind;let value=structuredClone(f[kind]);if(!value)denied();
 if(kind==='mig')mig++;
 if(fault==='active-node'&&kind==='nodes')value.items=[{spec:{providerID:'gce://synthetic-rg/asia-southeast1-a/test-node'}}];
 if(fault==='changed-MIG'&&kind==='mig'&&mig===2)value.currentActions.deleting=1;
 if(fault==='wrong-namespace'&&kind==='namespace')value.metadata.uid='foreign';
 if(fault==='changed-cluster'&&kind==='cluster'&&count>0)value.id='foreign';
 if(fault==='provider-credential-echo')value={access_token:'INSECURE_SYNTHETIC_ONLY'};
 if(fault==='source-drift'&&count===0)fs.appendFileSync(join(root,'inputs/cloud-benchmark.json'),' ');
 if(fault==='kubeconfig-drift'&&count===0){const p=x.kubeconfigFile,k=JSON.parse(fs.readFileSync(p));k.users[0].user.exec.command='/bin/sh';fs.writeFileSync(p,JSON.stringify(k));}
 fs.appendFileSync(join(root,'synthetic-commands.jsonl'),JSON.stringify({command,args,kind})+'\n',{mode:0o600});count++;
 const p=new EventEmitter();p.stdout=new EventEmitter();p.stderr=new EventEmitter();p.kill=denied;
 queueMicrotask(()=>{if(fault==='command-failure'){p.stderr.emit('data',Buffer.from('original synthetic failure'));p.emit('close',1,null);}
  else{p.stdout.emit('data',Buffer.from(fault==='duplicate-response'?'{"items":[],"items":[1]}':JSON.stringify(value)));p.emit('close',0,null);}});
 return p;
};
syncBuiltinESMExports();
