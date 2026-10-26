// Native network/process/credential-read sentinel. Any allowed transport is a
// strict fake returning a public TEST token; no real issuer is ever contacted.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import cp from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
const root=fs.realpathSync(process.env.RG_TOKEN_FIXTURE_ROOT);assert.match(root.split(/[\\/]/).at(-1),/^rg-cloud-token-/);
const write=fs.writeFileSync.bind(fs),blocked=()=>{write(join(root,'forbidden-boundary'),'blocked');throw Error('Forbidden real token boundary');};
for(const name of ['exec','execSync','execFile','execFileSync','spawn','spawnSync','fork'])cp[name]=blocked;
net.Socket.prototype.connect=blocked;net.connect=net.createConnection=blocked;http.request=http.get=https.request=https.get=blocked;
for(const target of [fs,fsp])for(const name of ['readFile','readFileSync','open','openSync'])if(typeof target[name]==='function'){
 const original=target[name].bind(target);target[name]=(...args)=>{if(/(?:^|[\\/])(?:\.env[^\\/]*|id_rsa|id_ed25519)$/.test(String(args[0])))blocked();return original(...args);};
}
globalThis.fetch=async(url,options)=>{
 if(process.env.RG_TOKEN_FIXTURE_ALLOW!=='1')blocked();
 assert.equal(url,'https://releaseguard.example.test/auth/realms/releaseguard/protocol/openid-connect/token');
 assert.equal(options.method,'POST');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert.equal(options.signal instanceof AbortSignal,true);
 assert.deepEqual([...options.body],[['grant_type','client_credentials'],['client_id','rg-viewer'],['client_secret','INSECURE_TEST_ONLY_ENTRY_SECRET_'+'x'.repeat(40)]]);
 assert.deepEqual(options.headers,{accept:'application/json','content-type':'application/x-www-form-urlencoded'});
 write(join(root,'fake-request'),JSON.stringify({sent:true,credentialsNotRecorded:true}),{flag:'wx'});
 return new Response(JSON.stringify({access_token:'INSECURE_TEST_ONLY_ENTRY_TOKEN',token_type:'bearer',expires_in:300}),{status:200,headers:{'content-type':'application/json','cache-control':'no-store'}});
};
syncBuiltinESMExports();
