// Owned native-entry simulation. No actual process forwarding, DB, cloud,
// sockets, listeners, fetch or credentials are permitted by this boundary.
import fs from 'node:fs';import fsp from 'node:fs/promises';import child from 'node:child_process';import net from 'node:net';import dgram from 'node:dgram';import http from 'node:http';import https from 'node:https';
import {EventEmitter} from 'node:events';import {syncBuiltinESMExports} from 'node:module';import {dirname,join} from 'node:path';import {fileURLToPath} from 'node:url';
import {backupBoundary} from './tests/fixtures/backup-protocol.mjs';
const root=dirname(fileURLToPath(import.meta.url));if(!root.split('/').at(-1).startsWith('rg-backup-owned-'))throw Error('Owned backup fixture only');
const input=process.argv.includes('--input')?process.argv[process.argv.indexOf('--input')+1]:join(root,'inputs/config.json'),c=JSON.parse(fs.readFileSync(input)),fault=process.env.RG_SYNTHETIC_BACKUP_FAULT??'',deny=()=>{throw Error('Native external operation forbidden');};
const b=backupBoundary({unknownCreate:fault==='unknown-create'||fault==='unmarked-create',unmarkedCreate:fault==='unmarked-create',unknownRestore:fault==='unknown-restore',unknownDrop:fault==='unknown-drop',foreignSystem:fault==='foreign-system',mismatch:fault==='mismatch',badDump:fault==='bad-dump',badTable:fault==='bad-table'});
Object.assign(b.c,c);Object.assign(b.fixtures.namespace.metadata,{name:c.cloud.namespace,uid:c.cloud.namespaceUid});Object.assign(b.pod.metadata,{name:c.target.podName,uid:c.target.podUID,namespace:c.cloud.namespace});
if(fault==='foreign-pod')b.pod.metadata.uid='foreign';
net.Socket.prototype.connect=deny;net.Server.prototype.listen=deny;dgram.createSocket=deny;for(const m of [http,https]){m.request=deny;m.get=deny;}globalThis.fetch=deny;
for(const name of ['spawnSync','exec','execSync','execFile','execFileSync','fork'])child[name]=deny;
const opened=fsp.open;let syncUsed=false;fsp.open=async(path,...args)=>{if(String(path).endsWith('/.env'))deny();const h=await opened(path,...args),sync=h.sync.bind(h);h.sync=async()=>{const p=String(path);if(!syncUsed&&(fault==='intent-sync'&&/operation-.*-intent.json$/.test(p)||fault==='observed-sync'&&/operation-.*-observed.json$/.test(p)||fault==='terminal-sync'&&p.endsWith('/terminal.json'))){syncUsed=true;throw Error('SYNTHETIC_DISK_FAILURE');}return sync();};return h;};
child.spawn=(command,args,options)=>{
 const run=join(root,'evidence/private/cloud-backup',c.runId),names=fs.readdirSync(run).filter(n=>/^(?:cleanup-)?native-\d{6}-intent.json$/.test(n)).sort((a,b)=>Number(a.match(/\d{6}/)[0])-Number(b.match(/\d{6}/)[0])),intent=JSON.parse(fs.readFileSync(join(run,names.at(-1))));
 if(command!==intent.command||JSON.stringify(args)!==JSON.stringify(intent.args)||options.env.HOME||options.env.RELEASEGUARD_TOKEN||options.env.CLOUDSDK_CONFIG!==c.cloud.gcloudConfigDirectory||options.env.KUBECONFIG!==c.cloud.kubeconfigFile)deny();
 fs.appendFileSync(join(root,'synthetic-commands.jsonl'),JSON.stringify({kind:intent.kind,args,cleanup:names.at(-1).startsWith('cleanup-')})+'\n',{mode:0o600});
 const p=new EventEmitter();p.stdout=new EventEmitter();p.stderr=new EventEmitter();p.kill=deny;let supplied;
 const complete=async()=>{try{let r;
  if(['cluster','namespace'].includes(intent.kind))r={status:0,stdout:Buffer.from(JSON.stringify(b.fixtures[intent.kind])),stderr:Buffer.alloc(0)};
  else if(intent.kind==='pod')r={status:0,stdout:Buffer.from(JSON.stringify(b.pod)),stderr:Buffer.alloc(0)};
  else{
   const lastIntent=fs.readdirSync(run).filter(n=>/^(?:cleanup-)?operation-\d{6}-intent.json$/.test(n)).sort((a,b)=>Number(a.match(/\d{6}/)[0])-Number(b.match(/\d{6}/)[0])).at(-1),op=JSON.parse(fs.readFileSync(join(run,lastIntent)));
   if(op.kind!==intent.kind)deny();r=await b.io.command(op.kind,op.database?{database:op.database}:undefined,{...op,...(supplied?{input:supplied}:{})},names.at(-1).startsWith('cleanup-'));
  }
  p.stdout.emit('data',r.stdout);p.stderr.emit('data',r.stderr);p.emit('close',r.status===0?0:1,null);
 }catch{p.stderr.emit('data',Buffer.from('Synthetic command failed or unknown'));p.emit('close',1,null);}};
 if(options.stdio[0]==='pipe'){p.stdin=new EventEmitter();p.stdin.end=b=>{supplied=Buffer.from(b);queueMicrotask(complete);};}else queueMicrotask(complete);return p;
};syncBuiltinESMExports();
