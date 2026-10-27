import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join,dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { config,retainedSource,credential } from './retained-rescore-data.mjs';
const repo=fileURLToPath(new URL('../../',import.meta.url));
export function harness(t,patch={},source=retainedSource()){
 const root=fs.mkdtempSync(join(fs.realpathSync(tmpdir()),'rg-cloud-retained-'));t.after(()=>{assert.match(root,/\/rg-cloud-retained-[^/]+$/);fs.rmSync(root,{recursive:true});});
 for(const name of ['scripts/cloud-rescore-retained.mjs','scripts/retained-rescore-core.mjs','scripts/retained-rescore-input.mjs','scripts/retained-rescore-http.mjs','scripts/comparison-files.mjs','scripts/cloud-http.mjs','scripts/cloud-token.mjs','scripts/cloud-token-core.mjs',
  'src/domain.ts','src/returns-policy.ts','dist/src/domain.js','dist/src/returns-policy.js','package-lock.json','public/demo-fixtures.json','tests/fixtures/retained-rescore-data.mjs','tests/fixtures/comparison-data.mjs']){
  fs.mkdirSync(dirname(join(root,name)),{recursive:true,mode:0o700});fs.copyFileSync(join(repo,name),join(root,name));}
 fs.mkdirSync(join(root,'inputs'),{mode:0o700});fs.symlinkSync(fs.realpathSync(join(repo,'node_modules')),join(root,'node_modules'),'dir');
 fs.copyFileSync(join(repo,'tests/fixtures/retained-rescore-preload.mjs'),join(root,'test-preload.mjs'));fs.writeFileSync(join(root,'package.json'),'{"type":"module","private":true}\n');
 fs.writeFileSync(join(root,'.env'),'INSECURE_DUMMY_NEVER_READ\n',{mode:0o600});const c=config(patch),configFile=join(root,'inputs/config.json'),authFile=join(root,'inputs/auth.json'),sourceFile=join(root,'inputs/source.json');
 fs.writeFileSync(configFile,JSON.stringify(c),{mode:0o600});fs.writeFileSync(sourceFile,JSON.stringify(source,null,2)+'\n',{mode:0o600});
 const auth=c.authMode==='token'?{token:credential}:{allowServiceAuthentication:true,targetOrigin:c.origin,allowedOrigins:[c.origin],issuer:c.origin+'/identity/realms/synthetic',clientId:'synthetic-client',clientSecret:'INSECURE_RETAINED_CLIENT_SECRET',timeoutMs:1000};
 fs.writeFileSync(authFile,JSON.stringify(auth),{mode:0o600});
 const env={PATH:process.env.PATH,RG_CLOUD_RESCORE_CONFIG_FILE:configFile,RG_CLOUD_RESCORE_AUTH_FILE:authFile,RG_CLOUD_RESCORE_SOURCE_FILE:sourceFile};
 function execute(args=['--execute-imported-rescore'],extra={}){const e={...env,...extra};for(const k of Object.keys(e))if(e[k]===undefined)delete e[k];
  const r=spawnSync(process.execPath,['--import',join(root,'test-preload.mjs'),'scripts/cloud-rescore-retained.mjs',...args],{cwd:root,env:e,encoding:'utf8',timeout:10000});assert.ifError(r.error);assert.equal(r.signal,null);return r;}
 const requests=()=>fs.existsSync(join(root,'synthetic-requests.jsonl'))?fs.readFileSync(join(root,'synthetic-requests.jsonl'),'utf8').trim().split('\n').map(JSON.parse):[];
 const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));return {root,c,configFile,authFile,sourceFile,env,execute,requests,json,privateRun:join(root,'evidence/private/cloud-retained-rescore',c.runId)};
}
