// Owned test boundary: no native socket, listener, HTTP client or subprocess.
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
import { apiFixture } from './tests/fixtures/cloud-acceptance-data.mjs';
const root=dirname(fileURLToPath(import.meta.url)),fault=process.env.RG_SYNTHETIC_ACCEPTANCE_FAULT??'',deny=()=>{throw Error('Native external IO forbidden');};
net.Socket.prototype.connect=deny;net.Server.prototype.listen=deny;dgram.createSocket=deny;
for(const mod of [http,https]){mod.request=deny;mod.get=deny;}for(const k of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])child[k]=deny;
const realOpen=fsp.open;let faulted=false;
fsp.open=async function(path,...args){const f=await realOpen(path,...args),name=String(path),sync=f.sync.bind(f);f.sync=async()=>{
 const hit=fault==='started-sync'&&name.endsWith('/started.json')||fault==='observed-sync'&&name.endsWith('/005-observed.json')||fault==='terminal-sync'&&name.endsWith('/terminal.json')||fault==='summary-sync'&&/\/evidence\/cloud-acceptance-[^/]+\.json$/.test(name);
 if(hit&&!faulted){faulted=true;throw Error('SYNTHETIC fsync failure');}return sync();};return f;};syncBuiltinESMExports();
function current(){const dir=join(root,'evidence/private/cloud-acceptance',process.env.RG_CLOUD_ACCEPTANCE_RUN_ID,'operations');return fs.readdirSync(dir).filter(p=>p.endsWith('-intent.json')).sort().map(p=>JSON.parse(fs.readFileSync(join(dir,p)))).at(-1);}
const api=apiFixture({failureAt:fault==='http503'?'application':undefined,currentName:()=>current().name});
globalThis.fetch=async function(url,init){
 if(init.redirect!=='error'||init.cache!=='no-store'||!String(url).startsWith('https://releaseguard.example.test/'))throw Error('Unexpected boundary request');
 const intent=current(),issuer=url==='https://releaseguard.example.test/identity/realms/synthetic/protocol/openid-connect/token';
 if(issuer){const form=new URLSearchParams(init.body),role=form.get('client_id');if(!['contributor','viewer'].includes(role)||form.get('client_secret')!=='INSECURE_TEST_ONLY_SECRET_'+role||intent.name!=='authenticate-'+role)throw Error('Wrong selected issuer input');}
 else if(intent.request?.path!==(url.includes('/api/v2/')?url.split('/api/v2/')[1]:'auth/admin/')||intent.request.method!==init.method)throw Error('Dispatch without matching persisted intent');
 fs.appendFileSync(join(root,'synthetic-requests.jsonl'),JSON.stringify({url,method:init.method,intent:intent.name,issuer})+'\n',{mode:0o600});
 if(issuer){if(fault==='issuer503')return new Response('{"error":"SYNTHETIC_PRIVATE_ISSUER"}',{status:503,headers:{'content-type':'application/json'}});return new Response(JSON.stringify({access_token:api.tokens[new URLSearchParams(init.body).get('client_id')],token_type:'bearer',expires_in:300}),{headers:{'content-type':'application/json'}});}
 if(fault==='echo-other-role'&&intent.name==='application')return new Response(JSON.stringify({echo:api.tokens.viewer}),{status:201,headers:{'content-type':'application/json'}});
 if(fault==='echo-client-secret'&&intent.name==='application')return new Response(JSON.stringify({echo:'INSECURE_TEST_ONLY_SECRET_viewer'}),{status:201,headers:{'content-type':'application/json'}});
 if(fault==='source-drift'&&intent.name==='admin')fs.appendFileSync(join(root,'scripts/cloud-http.mjs'),'\n// synthetic source drift\n');
 return api.fetcher(url,init);
};
