import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {fixtureConfig,records,kubeconfig} from './gcp-evidence-data.mjs';
const repo=fileURLToPath(new URL('../../',import.meta.url));
export function evidenceHarness(t,options={}){
 const root=fs.mkdtempSync(join(fs.realpathSync(tmpdir()),'rg-evidence-owned-'));t.after(()=>{assert.match(root,/\/rg-evidence-owned-[^/]+$/);fs.rmSync(root,{recursive:true});});
 for(const name of ['scripts/gcp-evidence.mjs','scripts/gcp-evidence-core.mjs','scripts/comparison-files.mjs','scripts/acceptance-process.mjs','tests/fixtures/gcp-evidence-data.mjs']){
  fs.mkdirSync(dirname(join(root,name)),{recursive:true,mode:0o700});fs.copyFileSync(join(repo,name),join(root,name));}
 for(const name of ['inputs','bin','cloud-config'])fs.mkdirSync(join(root,name),{mode:0o700});
 for(const name of ['gcloud','kubectl','gke-gcloud-auth-plugin'])fs.writeFileSync(join(root,'bin',name),'SYNTHETIC STUB - MUST NEVER BE EXECUTED\n',{mode:0o700});
 fs.copyFileSync(join(repo,'tests/fixtures/gcp-evidence-preload.mjs'),join(root,'test-preload.mjs'));fs.writeFileSync(join(root,'package.json'),'{"type":"module","private":true}\n');
 fs.writeFileSync(join(root,'.env'),'INSECURE_DUMMY_NEVER_READ\n',{mode:0o600});
 const c=fixtureConfig(root,options),configFile=join(root,'inputs/config.json');fs.writeFileSync(configFile,JSON.stringify(c),{mode:0o600});
 for(const [role,value]of Object.entries(records()))fs.writeFileSync(join(root,'inputs',role),JSON.stringify(value,null,2)+'\n',{mode:0o600});
 if(c.cloud)fs.writeFileSync(c.cloud.kubeconfigFile,JSON.stringify(kubeconfig(c.cloud)),{mode:0o600});
 const env={PATH:process.env.PATH};const args=['--'+c.mode,'--input',configFile,...(options.powerOnly?['--power-only']:[])];
 function execute(extra={},override=args){const r=spawnSync(process.execPath,['--import',join(root,'test-preload.mjs'),'scripts/gcp-evidence.mjs',...override],{cwd:root,env:{...env,...extra},encoding:'utf8',timeout:15000});assert.ifError(r.error);assert.equal(r.signal,null);return r;}
 function importOnly(){const r=spawnSync(process.execPath,['--import',join(root,'test-preload.mjs'),'--input-type=module','-e',"await import('./scripts/gcp-evidence.mjs')"],{cwd:root,env,encoding:'utf8',timeout:10000});assert.ifError(r.error);return r;}
 const commands=()=>fs.existsSync(join(root,'synthetic-commands.jsonl'))?fs.readFileSync(join(root,'synthetic-commands.jsonl'),'utf8').trim().split('\n').map(JSON.parse):[];
 const json=p=>JSON.parse(fs.readFileSync(p,'utf8'));return {root,c,configFile,env,args,execute,importOnly,commands,json,run:join(root,'evidence/private/cloud-evidence',c.runId)};
}
