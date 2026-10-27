// Owned fake boundaries for the actual CLI. Never forwards a socket/process.
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
import { apiFixture,credential } from './tests/fixtures/comparison-data.mjs';
const root=dirname(fileURLToPath(import.meta.url));if(!root.split('/').at(-1).startsWith('rg-comparison-'))throw Error('Not an owned comparison fixture');
const c=JSON.parse(fs.readFileSync(join(root,'inputs/config.json'),'utf8')),fault=process.env.RG_SYNTHETIC_COMPARISON_FAULT??'',deny=()=>{throw Error('Native external IO forbidden');};
net.Socket.prototype.connect=deny;net.Server.prototype.listen=deny;dgram.createSocket=deny;for(const mod of [http,https]){mod.request=deny;mod.get=deny;}
for(const k of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])child[k]=deny;
const originalOpen=fsp.open;let faulted=false;
fsp.open=async(path,...args)=>{
 const name=String(path);if(name.endsWith('/.env'))deny();
 if(name.endsWith('/inputs/auth.json')&&!fs.existsSync(join(root,'evidence/private/comparison',c.runId,'started.json')))throw Error('Credential before reservation');
 const f=await originalOpen(path,...args),sync=f.sync.bind(f);f.sync=async()=>{
  const hit=fault==='started-sync'&&name.endsWith('/started.json')||fault==='observed-sync'&&name.endsWith('-observed.json')||fault==='terminal-sync'&&name.endsWith('/terminal.json')||fault==='intent-sync'&&name.endsWith('-intent.json');
  if(hit&&!faulted){faulted=true;throw Error('INSECURE_PRIVATE_FSYNC_DIAGNOSTIC');}return sync();};return f;
};syncBuiltinESMExports();
const dir=join(root,'evidence/private/comparison',c.runId,'operations');
const current=()=>fs.readdirSync(dir).filter(n=>n.endsWith('-intent.json')).sort().map(n=>JSON.parse(fs.readFileSync(join(dir,n)))).at(-1);
const api=apiFixture(c,{fault});let issuerCalls=0;
globalThis.fetch=async(url,init)=>{
 if(init.redirect!=='error'||!String(url).startsWith(c.origin+'/'))throw Error('Unexpected fake origin/redirect');
 const intent=current(),issuer=url===c.origin+'/identity/realms/synthetic/protocol/openid-connect/token';
 if(issuer){if(intent.kind!=='authentication')throw Error('Issuer without persisted intent');issuerCalls++;}
 else if(intent.kind!=='request'||c.origin+'/api/v2'+intent.route!==url||intent.method!==init.method)throw Error('Target without matching persisted intent');
 fs.appendFileSync(join(root,'synthetic-requests.jsonl'),JSON.stringify({url,method:init.method,issuer,intent:intent.name??intent.route})+'\n',{mode:0o600});
 if(issuer){
  const form=new URLSearchParams(init.body);if(form.get('client_secret')!=='INSECURE_SYNTHETIC_CLIENT_SECRET')throw Error('Wrong selected secret');
  if(fault==='issuer-failure')return new Response('{"error":"INSECURE_SYNTHETIC_CLIENT_SECRET"}',{status:503,headers:{'content-type':'application/json'}});
  return new Response(JSON.stringify({access_token:credential+'_'+issuerCalls,token_type:'bearer',expires_in:300}),{headers:{'content-type':'application/json'}});
 }
 if(fault==='credential-echo')return new Response(JSON.stringify({echo:credential}),{status:201,headers:{'content-type':'application/json'}});
 if(fault==='prior-token-echo'&&issuerCalls===2)return new Response(JSON.stringify({echo:credential+'_1'}),{status:202,headers:{'content-type':'application/json'}});
 if(fault==='secret-echo')return new Response('{"echo":"INSECURE_SYNTHETIC_CLIENT_SECRET"}',{status:201,headers:{'content-type':'application/json'}});
 if(fault==='source-drift'&&api.requests.filter(q=>q.method==='GET').length===1)fs.appendFileSync(join(root,'scripts/comparison-report.mjs'),'\n// owned synthetic drift\n');
 if(fault==='redirect')return new Response(null,{status:302,headers:{location:'https://foreign.example.test'}});
 return api.fetcher(url,init);
};
