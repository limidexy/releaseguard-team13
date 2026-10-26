import assert from 'node:assert/strict';
import { mkdtempSync,realpathSync,readFileSync,writeFileSync,mkdirSync,copyFileSync,rmSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { config,runId,token } from './cloud-acceptance-data.mjs';
const repo=fileURLToPath(new URL('../../',import.meta.url));
const names=['scripts/cloud-acceptance.mjs','scripts/cloud-acceptance-core.mjs','scripts/cloud-acceptance-http.mjs','scripts/cloud-http.mjs','scripts/cloud-smoke-core.mjs','scripts/cloud-token.mjs','scripts/cloud-token-core.mjs','public/demo-fixtures.json','tests/fixtures/cloud-acceptance-data.mjs'];
export function harness(t,overrides={}){
 const root=mkdtempSync(join(realpathSync(tmpdir()),'rg-cloud-acceptance-'));t.after(()=>{assert.match(root,/\/rg-cloud-acceptance-[^/]+$/);rmSync(root,{recursive:true});});
 for(const name of names){mkdirSync(dirname(join(root,name)),{recursive:true,mode:0o700});copyFileSync(join(repo,name),join(root,name));}mkdirSync(join(root,'auth'),{mode:0o700});copyFileSync(join(repo,'tests/fixtures/cloud-acceptance-preload.mjs'),join(root,'test-preload.mjs'));
 const c=config(),pair={contributor:token('contributor'),viewer:token('viewer')},authFile=join(root,'auth/selected.json');writeFileSync(authFile,JSON.stringify(pair),{mode:0o600});
 const env={PATH:process.env.PATH,RG_ALLOW_CLOUD_ACCEPTANCE:'true',RELEASEGUARD_URL:c.origin,RG_CLOUD_ALLOWED_ORIGINS:c.origin,RG_CLOUD_ACCEPTANCE_RUN_ID:c.runId,RG_COMMIT:c.commit,RG_IMAGE:c.image,RG_CLOUD_ACCEPTANCE_AUTH_MODE:'tokens',RG_CLOUD_ACCEPTANCE_WORKSPACE:c.workspace,RG_CLOUD_ACCEPTANCE_AUTH_FILE:authFile,...overrides};
 const privateRun=join(root,'evidence/private/cloud-acceptance',runId),publicFile=join(root,'evidence/cloud-acceptance-'+runId+'.json');
 const execute=(args=['--execute-cloud-acceptance','--allow-denied-review-probe'],extra={})=>{const e={...env,...extra};for(const k of Object.keys(e))if(e[k]===undefined)delete e[k];const r=spawnSync(process.execPath,['--import',join(root,'test-preload.mjs'),join(root,'scripts/cloud-acceptance.mjs'),...args],{cwd:root,env:e,encoding:'utf8',timeout:10000});assert.ifError(r.error);assert.equal(r.signal,null);return r;};
 const json=p=>JSON.parse(readFileSync(p,'utf8')),requests=()=>existsSync(join(root,'synthetic-requests.jsonl'))?readFileSync(join(root,'synthetic-requests.jsonl'),'utf8').trim().split('\n').map(JSON.parse):[];
 function clients(){const auth=role=>({allowServiceAuthentication:true,targetOrigin:c.origin,allowedOrigins:[c.origin],issuer:c.origin+'/identity/realms/synthetic',clientId:role,clientSecret:'INSECURE_TEST_ONLY_SECRET_'+role,timeoutMs:1000});env.RG_CLOUD_ACCEPTANCE_AUTH_MODE='client-credentials';writeFileSync(authFile,JSON.stringify({contributor:auth('contributor'),viewer:auth('viewer')}));}
 return {root,env,pair,authFile,execute,requests,json,privateRun,publicFile,clients};
}
