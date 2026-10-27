import assert from 'node:assert/strict';
import { mkdtempSync,realpathSync,mkdirSync,copyFileSync,writeFileSync,readFileSync,rmSync,symlinkSync,existsSync } from 'node:fs';
import { join,dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { config,runId,credential } from './comparison-data.mjs';
const repo=fileURLToPath(new URL('../../',import.meta.url));
export function harness(t,patch={}){
 const root=mkdtempSync(join(realpathSync(tmpdir()),'rg-comparison-'));t.after(()=>{assert.match(root,/\/rg-comparison-[^/]+$/);rmSync(root,{recursive:true});});
 const files=['scripts/compare-prompts.mjs','scripts/comparison-core.mjs','scripts/comparison-report.mjs','scripts/comparison-files.mjs','scripts/comparison-http.mjs','scripts/cloud-http.mjs','scripts/cloud-token.mjs','scripts/cloud-token-core.mjs',
  'public/demo-fixtures.json','dist/src/domain.js','dist/src/returns-policy.js','package-lock.json','tests/fixtures/comparison-data.mjs'];
 for(const name of files){mkdirSync(dirname(join(root,name)),{recursive:true,mode:0o700});copyFileSync(join(repo,name),join(root,name));}
 mkdirSync(join(root,'inputs'),{mode:0o700});symlinkSync(realpathSync(join(repo,'node_modules')),join(root,'node_modules'),'dir');
 copyFileSync(join(repo,'tests/fixtures/comparison-preload.mjs'),join(root,'test-preload.mjs'));
 writeFileSync(join(root,'package.json'),'{"type":"module","private":true}\n');writeFileSync(join(root,'.env'),'NEVER_READ_INSECURE_SYNTHETIC_SECRET\n',{mode:0o600});
 const c=config(patch),configFile=join(root,'inputs/config.json'),authFile=join(root,'inputs/auth.json');
 writeFileSync(configFile,JSON.stringify(c),{mode:0o600});
 const auth=c.authMode==='token'?{token:credential}:c.authMode==='development'?{secret:'1'.repeat(64),subject:'comparison-local-test'}:
  {allowServiceAuthentication:true,targetOrigin:c.origin,allowedOrigins:[c.origin],issuer:c.origin+'/identity/realms/synthetic',clientId:'synthetic-client',clientSecret:'INSECURE_SYNTHETIC_CLIENT_SECRET',timeoutMs:1000};
 writeFileSync(authFile,JSON.stringify(auth),{mode:0o600});
 const env={PATH:process.env.PATH,RG_COMPARISON_CONFIG_FILE:configFile,RG_COMPARISON_AUTH_FILE:authFile};
 function execute(args=['--execute-comparison',c.source],extra={}){const e={...env,...extra};for(const k of Object.keys(e))if(e[k]===undefined)delete e[k];
  const r=spawnSync(process.execPath,['--import',join(root,'test-preload.mjs'),'scripts/compare-prompts.mjs',...args],{cwd:root,env:e,encoding:'utf8',timeout:15000});assert.ifError(r.error);assert.equal(r.signal,null);return r;}
 const requests=()=>existsSync(join(root,'synthetic-requests.jsonl'))?readFileSync(join(root,'synthetic-requests.jsonl'),'utf8').trim().split('\n').map(JSON.parse):[];
 const json=file=>JSON.parse(readFileSync(file,'utf8')),privateRun=join(root,'evidence/private/comparison',runId);
 return {root,c,env,configFile,authFile,privateRun,execute,requests,json};
}
