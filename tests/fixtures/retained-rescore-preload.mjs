// Actual CLI below fake native boundaries. No listener/socket/process forwarding.
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
import { apiFixture,credential } from './tests/fixtures/retained-rescore-data.mjs';
const root=dirname(fileURLToPath(import.meta.url));if(!root.split('/').at(-1).startsWith('rg-cloud-retained-'))throw Error('Owned retained fixture only');
const c=JSON.parse(fs.readFileSync(join(root,'inputs/config.json'),'utf8')),fault=process.env.RG_SYNTHETIC_RETAINED_FAULT??'',deny=()=>{throw Error('Native external IO forbidden');};
const source=JSON.parse(fs.readFileSync(join(root,'inputs/source.json'),'utf8'));
net.Socket.prototype.connect=deny;net.Server.prototype.listen=deny;dgram.createSocket=deny;for(const m of [http,https]){m.request=deny;m.get=deny;}
for(const k of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])child[k]=deny;
const opened=fsp.open;let faulted=false;
fsp.open=async(path,...args)=>{const name=String(path);if(name.endsWith('/.env'))deny();
 if(name.endsWith('/inputs/auth.json')&&!fs.existsSync(join(root,'evidence/private/cloud-retained-rescore',c.runId,'started.json')))throw Error('Auth before reservation');
 const h=await opened(path,...args),sync=h.sync.bind(h);h.sync=async()=>{const hit=fault==='started-sync'&&name.endsWith('/started.json')||fault==='intent-sync'&&name.endsWith('-intent.json')||
  fault==='source-sync'&&name.endsWith('/source-original.json')||fault==='observed-sync'&&name.endsWith('-observed.json')||fault==='terminal-sync'&&name.endsWith('/terminal.json');
  if(hit&&!faulted){faulted=true;throw Error('INSECURE_PRIVATE_FSYNC_DIAGNOSTIC');}return sync();};return h;};syncBuiltinESMExports();
const dir=join(root,'evidence/private/cloud-retained-rescore',c.runId,'operations'),current=()=>fs.readdirSync(dir).filter(n=>n.endsWith('-intent.json')).sort().map(n=>JSON.parse(fs.readFileSync(join(dir,n)))).at(-1);
const api=apiFixture(c,source,{fault});
globalThis.fetch=async(url,init)=>{
 if(init.redirect!=='error'||init.cache!=='no-store'||!String(url).startsWith(c.origin+'/'))throw Error('Unexpected transport');
 const intent=current(),issuer=url===c.origin+'/identity/realms/synthetic/protocol/openid-connect/token';
 if(issuer){if(intent.kind!=='authentication'||new URLSearchParams(init.body).get('client_secret')!=='INSECURE_RETAINED_CLIENT_SECRET')throw Error('Unplanned issuer input');}
 else if(intent.kind!=='request'||c.origin+'/api/v2'+intent.route!==url||init.method!==intent.method)throw Error('Request without prior intent');
 fs.appendFileSync(join(root,'synthetic-requests.jsonl'),JSON.stringify({url,method:init.method,issuer})+'\n',{mode:0o600});
 if(issuer){if(fault==='issuer-failure')return new Response('{"error":"INSECURE_RETAINED_CLIENT_SECRET"}',{status:503,headers:{'content-type':'application/json'}});
  return new Response(JSON.stringify({access_token:credential,token_type:'bearer',expires_in:300}),{headers:{'content-type':'application/json'}});}
 if(fault==='credential-echo'||fault==='secret-echo')return new Response(JSON.stringify({echo:fault==='credential-echo'?credential:'INSECURE_RETAINED_CLIENT_SECRET'}),{headers:{'content-type':'application/json'}});
 if(fault==='source-drift'&&api.jobs.length===2)fs.appendFileSync(join(root,'scripts/retained-rescore-input.mjs'),'\n// owned synthetic drift\n');
 return api.fetcher(url,init);
};
