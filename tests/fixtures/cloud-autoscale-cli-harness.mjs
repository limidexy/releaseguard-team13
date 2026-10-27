import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {autoscaleSources} from '../../scripts/cloud-autoscale.mjs';
import {autoscaleBoundary,token} from './cloud-autoscale-protocol.mjs';
import {kubeconfig} from './gcp-evidence-data.mjs';
import {sha256} from '../../scripts/comparison-files.mjs';
const repo=fileURLToPath(new URL('../../',import.meta.url));
export function autoscaleHarness(t){
 const root=fs.mkdtempSync(join(fs.realpathSync(tmpdir()),'rg-autoscale-owned-'));t.after(()=>{assert.match(root,/\/rg-autoscale-owned-[^/]+$/);fs.rmSync(root,{recursive:true});});
 const names=[...autoscaleSources,'tests/fixtures/cloud-autoscale-protocol.mjs','tests/fixtures/cloud-benchmark-protocol.mjs','tests/fixtures/cloud-benchmark-target.mjs','tests/fixtures/gcp-evidence-data.mjs'];
 for(const name of names){fs.mkdirSync(dirname(join(root,name)),{recursive:true,mode:0o700});fs.copyFileSync(join(repo,name),join(root,name));}
 for(const name of ['inputs','bin','cloud-config'])fs.mkdirSync(join(root,name),{mode:0o700});
 for(const name of ['gcloud','kubectl','gke-gcloud-auth-plugin'])fs.writeFileSync(join(root,'bin',name),'SYNTHETIC STUB - MUST NEVER BE EXECUTED\n',{mode:0o700});
 const {c}=autoscaleBoundary();Object.assign(c.cloud,{gcloudExecutable:join(root,'bin/gcloud'),kubectlExecutable:join(root,'bin/kubectl'),pluginExecutable:join(root,'bin/gke-gcloud-auth-plugin'),gcloudConfigDirectory:join(root,'cloud-config'),kubeconfigFile:join(root,'inputs/kube.json')});
 c.authFile=join(root,'inputs/auth.json');c.identity.path=join(root,'inputs/identity.json');const identity=JSON.stringify({sourceCommit:c.commit,image:c.image});c.identity.sha256=sha256(identity);
 const configFile=join(root,'inputs/config.json');for(const [name,value]of [[configFile,JSON.stringify(c)],[c.identity.path,identity],[c.authFile,JSON.stringify({token})],[c.cloud.kubeconfigFile,JSON.stringify(kubeconfig(c.cloud))]])fs.writeFileSync(name,value,{mode:0o600});
 fs.writeFileSync(join(root,'.env'),'INSECURE_DUMMY_NEVER_READ\n',{mode:0o600});fs.copyFileSync(join(repo,'tests/fixtures/cloud-autoscale-cli-preload.mjs'),join(root,'test-preload.mjs'));fs.writeFileSync(join(root,'package.json'),'{"type":"module","private":true}\n');
 const env={PATH:process.env.PATH},args=['--execute-controlled-backlog','--input',configFile];
 const execute=(extra={},override=args)=>{const r=spawnSync(process.execPath,['--import',join(root,'test-preload.mjs'),'scripts/cloud-autoscale.mjs',...override],{cwd:root,env:{...env,...extra},encoding:'utf8',timeout:60000});assert.ifError(r.error);assert.equal(r.signal,null);return r;};
 const importOnly=()=>{const r=spawnSync(process.execPath,['--import',join(root,'test-preload.mjs'),'--input-type=module','-e',"await import('./scripts/cloud-autoscale.mjs')"],{cwd:root,env,encoding:'utf8',timeout:10000});assert.ifError(r.error);return r;};
 const rows=name=>fs.existsSync(join(root,name))?fs.readFileSync(join(root,name),'utf8').trim().split('\n').map(JSON.parse):[];
 return {root,c,configFile,execute,importOnly,json:p=>JSON.parse(fs.readFileSync(p)),commands:()=>rows('synthetic-commands.jsonl'),requests:()=>rows('synthetic-requests.jsonl'),run:join(root,'evidence/private/cloud-autoscale',c.runId)};
}
