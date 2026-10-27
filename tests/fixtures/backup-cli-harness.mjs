import fs from 'node:fs';import assert from 'node:assert/strict';
import {join,dirname} from 'node:path';import {tmpdir} from 'node:os';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
import {backupSources} from '../../scripts/cloud-backup-restore.mjs';
import {backupBoundary} from './backup-protocol.mjs';import {kubeconfig} from './gcp-evidence-data.mjs';
const repo=fileURLToPath(new URL('../../',import.meta.url));
export function backupHarness(t){
 const root=fs.mkdtempSync(join(fs.realpathSync(tmpdir()),'rg-backup-owned-'));t.after(()=>{assert.match(root,/[/\\]rg-backup-owned-[^/\\]+$/);fs.rmSync(root,{recursive:true});});
 for(const name of [...backupSources,'tests/fixtures/backup-protocol.mjs','tests/fixtures/gcp-evidence-data.mjs']){fs.mkdirSync(dirname(join(root,name)),{recursive:true,mode:0o700});fs.copyFileSync(join(repo,name),join(root,name));}
 for(const name of ['inputs','bin','cloud-config'])fs.mkdirSync(join(root,name),{mode:0o700});for(const name of ['gcloud','kubectl','gke-gcloud-auth-plugin'])fs.writeFileSync(join(root,'bin',name),'SYNTHETIC - NEVER EXECUTED\n',{mode:0o700});
 const {c}=backupBoundary();Object.assign(c.cloud,{gcloudExecutable:join(root,'bin/gcloud'),kubectlExecutable:join(root,'bin/kubectl'),pluginExecutable:join(root,'bin/gke-gcloud-auth-plugin'),gcloudConfigDirectory:join(root,'cloud-config'),kubeconfigFile:join(root,'inputs/kube.json')});
 const configFile=join(root,'inputs/config.json');fs.writeFileSync(configFile,JSON.stringify(c),{mode:0o600});fs.writeFileSync(c.cloud.kubeconfigFile,JSON.stringify(kubeconfig(c.cloud)),{mode:0o600});
 fs.writeFileSync(join(root,'.env'),'INSECURE_DUMMY_NEVER_READ\n',{mode:0o600});fs.copyFileSync(join(repo,'tests/fixtures/backup-cli-preload.mjs'),join(root,'test-preload.mjs'));fs.writeFileSync(join(root,'package.json'),'{"type":"module","private":true}\n');
 const env={PATH:process.env.PATH},args=['--execute-backup-restore','--input',configFile];
 const execute=(extra={},override=args)=>{const r=spawnSync(process.execPath,['--import',join(root,'test-preload.mjs'),'scripts/cloud-backup-restore.mjs',...override],{cwd:root,env:{...env,...extra},encoding:'utf8',timeout:30000});assert.ifError(r.error);assert.equal(r.signal,null);return r;};
 const importOnly=()=>spawnSync(process.execPath,['--import',join(root,'test-preload.mjs'),'--input-type=module','-e',"await import('./scripts/cloud-backup-restore.mjs')"],{cwd:root,env,encoding:'utf8',timeout:5000});
 const commands=()=>fs.existsSync(join(root,'synthetic-commands.jsonl'))?fs.readFileSync(join(root,'synthetic-commands.jsonl'),'utf8').trim().split('\n').map(JSON.parse):[];
 return {root,c,configFile,args,execute,importOnly,commands,run:join(root,'evidence/private/cloud-backup',c.runId),json:p=>JSON.parse(fs.readFileSync(p))};
}
