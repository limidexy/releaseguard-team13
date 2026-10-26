import assert from 'node:assert/strict';
import { mkdtempSync,realpathSync,readFileSync,writeFileSync,mkdirSync,copyFileSync,rmSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { config,runId,token } from './cloud-smoke-data.mjs';
const repo=fileURLToPath(new URL('../../',import.meta.url));
const names=['scripts/cloud-smoke.mjs','scripts/cloud-smoke-core.mjs','scripts/cloud-smoke-http.mjs','scripts/cloud-http.mjs','scripts/cloud-token.mjs','scripts/cloud-token-core.mjs','public/demo-fixtures.json'];
export function harness(t,overrides={}){
 const root=mkdtempSync(join(realpathSync(tmpdir()),'rg-cloud-smoke-'));t.after(()=>{assert.match(root,/\/rg-cloud-smoke-[^/]+$/);rmSync(root,{recursive:true});});
 for(const d of ['scripts','public','auth'])mkdirSync(join(root,d),{mode:0o700});
 for(const n of names)copyFileSync(join(repo,n),join(root,n));copyFileSync(join(repo,'tests/fixtures/cloud-smoke-preload.mjs'),join(root,'test-preload.mjs'));
 const c=config(),env={PATH:process.env.PATH,...(process.env.SystemRoot?{SystemRoot:process.env.SystemRoot}:{}),RG_ALLOW_CLOUD_SMOKE:'true',RELEASEGUARD_URL:c.origin,RG_CLOUD_ALLOWED_ORIGINS:c.origin,RG_CLOUD_SMOKE_RUN_ID:c.runId,RG_COMMIT:c.commit,RG_IMAGE:c.image,RG_CLOUD_SMOKE_AUTH_MODE:'token',RELEASEGUARD_TOKEN:token,...overrides};
 const auth={allowServiceAuthentication:true,targetOrigin:c.origin,allowedOrigins:[c.origin],issuer:c.origin+'/identity/realms/synthetic',clientId:'synthetic-client',clientSecret:'INSECURE_TEST_ONLY_SECRET',timeoutMs:1000};
 writeFileSync(join(root,'auth/selected.json'),JSON.stringify(auth),{mode:0o600});
 const privateRun=join(root,'evidence/private/cloud-smoke',runId),publicFile=join(root,'evidence/cloud-smoke-'+runId+'.json');
 function execute(args=['--execute-replay-smoke'],extra={}){const e={...env,...extra};for(const key of Object.keys(e))if(e[key]===undefined)delete e[key];const r=spawnSync(process.execPath,['--import',join(root,'test-preload.mjs'),join(root,'scripts/cloud-smoke.mjs'),...args],{cwd:root,env:e,encoding:'utf8',timeout:10000});assert.ifError(r.error);assert.equal(r.signal,null);return r;}
 const requests=()=>existsSync(join(root,'synthetic-requests.jsonl'))?readFileSync(join(root,'synthetic-requests.jsonl'),'utf8').trim().split('\n').map(JSON.parse):[];
 const json=p=>JSON.parse(readFileSync(p,'utf8'));
 return {root,env,execute,requests,json,privateRun,publicFile};
}
