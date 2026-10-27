import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join,resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { harness } from './fixtures/comparison-harness.mjs';
import { runId,credential } from './fixtures/comparison-data.mjs';
const posix={skip:process.platform==='win32'?'Private operator entry deliberately POSIX-only':false};
for(const revision of ['legacy','v2.1','v2.2'])test('actual guarded CLI creates both original '+revision+' jobs and private evidence',posix,t=>{
 const h=harness(t,{suiteRevision:revision}),r=h.execute();assert.equal(r.status,0,r.stderr);assert.equal(h.requests().length,6);
 const report=h.json(join(h.privateRun,'report.json')),terminal=h.json(join(h.privateRun,'terminal.json'));
 assert.equal(terminal.status,'completed');assert.equal(report.runs.length,2);assert.equal(report.suiteRevision,revision);assert.match(report.semanticConclusion,/NOT_ASSESSED/);
 assert.equal(fs.statSync(h.privateRun).mode&0o777,0o700);assert.equal(fs.statSync(join(h.privateRun,'report.json')).mode&0o777,0o600);
 assert.equal(fs.existsSync(join(h.root,'evidence/current')),false);assert.doesNotMatch(r.stdout+r.stderr,new RegExp(credential));
 const bytes=fs.readFileSync(join(h.privateRun,'report.json'));const second=h.execute();assert.equal(second.status,1);assert.equal(h.requests().length,6);assert.deepEqual(fs.readFileSync(join(h.privateRun,'report.json')),bytes);
});
test('actual client-credentials consumer authenticates only the three planned phases; no retry/refresh',posix,t=>{
 const h=harness(t,{authMode:'client-credentials'}),r=h.execute();assert.equal(r.status,0,r.stderr);assert.equal(h.requests().filter(q=>q.issuer).length,3);
 const all=fs.readdirSync(join(h.privateRun,'operations')).map(n=>fs.readFileSync(join(h.privateRun,'operations',n),'utf8')).join('\n');
 assert.doesNotMatch(all,/INSECURE_SYNTHETIC_CLIENT_SECRET|INSECURE_SYNTHETIC_TOKEN_ONLY/);
});
test('explicit local development auth uses selected private key, never .env, and makes zero issuer requests',posix,t=>{
 const origin='http://127.0.0.1:34567',h=harness(t,{origin,allowedOrigins:[origin],targetKind:'local',authMode:'development'}),r=h.execute();
 assert.equal(r.status,0,r.stderr);assert.equal(h.requests().filter(q=>q.issuer).length,0);assert.equal(h.json(join(h.privateRun,'report.json')).cloud,false);
 assert.doesNotMatch(r.stdout+r.stderr,/1111111111111111111111111111111111111111111111111111111111111111/);
});
test('isolated acceptance is an explicit replay-only compatibility consumer, not adoption of arbitrary5189',posix,t=>{
 const origin='http://127.0.0.1:5189',h=harness(t,{origin,allowedOrigins:[origin],targetKind:'isolated-acceptance',authMode:'development'});
 assert.equal(h.execute().status,1);assert.equal(h.requests().length,0);
 const r=h.execute(undefined,{RG_ACCEPTANCE_INTEGRATION:'1',RG_COMPARISON_ACCEPTANCE_RUN_ID:runId,COMPOSE_PROJECT_NAME:'rg-contracts-'+runId});
 assert.equal(r.status,0,r.stderr);assert.equal(h.requests().length,6);
});
for(const [name,args,env]of [['bare',[],{}],['old implicit mode',['replay'],{}],['CI',['--execute-comparison','replay'],{CI:'true'}],
 ['ambient credential',['--execute-comparison','replay'],{RELEASEGUARD_TOKEN:credential}],['mode drift',['--execute-comparison','real'],{}],
 ['missing selected file',['--execute-comparison','replay'],{RG_COMPARISON_AUTH_FILE:undefined}]])test(name+' refuses before reservation/target IO',posix,t=>{
 const h=harness(t),r=h.execute(args,env);assert.equal(r.status,1);assert.equal(h.requests().length,0);assert.equal(fs.existsSync(h.privateRun),false);
});
for(const fault of ['http503','unknown-post','wrong-workspace','wrong-prompt','wrong-snapshot','wrong-score','duplicate-case','failed-job','wrong-source','credential-echo','redirect','started-sync','intent-sync','observed-sync','terminal-sync','source-drift'])test('actual CLI '+fault+' cannot produce successful exit or send a second uncertain job',posix,t=>{
 const h=harness(t),r=h.execute(undefined,{RG_SYNTHETIC_COMPARISON_FAULT:fault});assert.equal(r.status,1,r.stderr);
 const requests=h.requests(),jobs=requests.filter(q=>new URL(q.url).pathname==='/api/v2/jobs');assert.ok(jobs.length<=(['terminal-sync','source-drift'].includes(fault)?2:1));
 assert.doesNotMatch(r.stdout+r.stderr,/INSECURE_SYNTHETIC_TOKEN_ONLY|INSECURE_PRIVATE_FSYNC_DIAGNOSTIC/);
 if(fault==='credential-echo'){
  const observed=fs.readdirSync(join(h.privateRun,'operations')).filter(n=>n.endsWith('-observed.json')).map(n=>h.json(join(h.privateRun,'operations',n)));
  assert.equal(observed[0].credentialEchoWithheld,true);assert.equal(observed[0].rawEntityBase64,null);
 }
});
for(const fault of ['issuer-failure','secret-echo'])test('actual '+fault+' preserves redacted failure without authentication fallback',posix,t=>{
 const h=harness(t,{authMode:'client-credentials'}),r=h.execute(undefined,{RG_SYNTHETIC_COMPARISON_FAULT:fault});assert.equal(r.status,1);
 assert.equal(h.requests().filter(q=>q.issuer).length,1);assert.equal(h.requests().filter(q=>new URL(q.url).pathname==='/api/v2/jobs').length,0);
 assert.doesNotMatch(r.stdout+r.stderr,/INSECURE_SYNTHETIC_CLIENT_SECRET/);
});
test('previous planned-phase bearer echoes are withheld, not just the currently sent token',posix,t=>{
 const h=harness(t,{authMode:'client-credentials'}),r=h.execute(undefined,{RG_SYNTHETIC_COMPARISON_FAULT:'prior-token-echo'});
 assert.equal(r.status,1);assert.equal(h.requests().filter(q=>q.issuer).length,2);
 const observed=fs.readdirSync(join(h.privateRun,'operations')).filter(n=>n.endsWith('-observed.json')).map(n=>h.json(join(h.privateRun,'operations',n)));
 assert.equal(observed.at(-1).credentialEchoWithheld,true);assert.equal(observed.at(-1).rawEntityBase64,null);
});
test('selected baseline containing a known selected credential is refused before copying or dispatch',posix,t=>{
 const h=harness(t),file=join(h.root,'inputs/baseline.json');fs.writeFileSync(file,JSON.stringify({retained:credential}),{mode:0o600});
 const original=fs.readFileSync(file),r=h.execute(undefined,{RG_COMPARISON_BASELINE_FILE:file});assert.equal(r.status,1);assert.equal(h.requests().length,0);
 assert.equal(fs.existsSync(join(h.privateRun,'baseline-original.bin')),false);assert.deepEqual(fs.readFileSync(file),original);
});
test('selected private baseline original bytes are retained and source never rewritten',posix,t=>{
 const h=harness(t);assert.equal(h.execute().status,0);const old=fs.readFileSync(join(h.privateRun,'report.json'));
 const newId='b7df9b5c-08e9-4d1d-9c73-7cbd99bcb50a',c={...h.c,runId:newId,workspace:'comparison-'+newId,suiteRevision:'v2.2'};
 fs.writeFileSync(h.configFile,JSON.stringify(c));const file=join(h.root,'inputs/baseline.json');fs.writeFileSync(file,old,{mode:0o600});
 const r=h.execute(undefined,{RG_COMPARISON_BASELINE_FILE:file});assert.equal(r.status,0,r.stderr);const dir=join(h.root,'evidence/private/comparison',newId);
 assert.deepEqual(fs.readFileSync(file),old);assert.deepEqual(fs.readFileSync(join(dir,'baseline-original.bin')),old);assert.equal(h.json(join(dir,'report.json')).baseline.originalRecordUnchanged,true);
});
test('world-readable selected auth or duplicate-key config stops before target dispatch',posix,t=>{
 const h=harness(t);fs.chmodSync(h.authFile,0o644);assert.equal(h.execute().status,1);assert.equal(h.requests().length,0);
 const n='b7df9b5c-08e9-4d1d-9c73-7cbd99bcb50a';fs.chmodSync(h.authFile,0o600);fs.writeFileSync(h.configFile,JSON.stringify({...h.c,runId:n,workspace:'comparison-'+n}).replace('"modelRequestBudget":0','"modelRequestBudget":0,"modelRequestBudget":20'));
 assert.equal(h.execute().status,1);assert.equal(h.requests().length,0);
});
test('actual entry import with nonexistent input hints is inert and does not create evidence',posix,t=>{
 const h=harness(t),r=spawnSync(process.execPath,['--import',join(h.root,'test-preload.mjs'),'--input-type=module','-e',"await import('./scripts/compare-prompts.mjs')"],{cwd:h.root,env:{PATH:process.env.PATH,RG_COMPARISON_AUTH_FILE:'/never/read.json'},encoding:'utf8',timeout:10000});
 assert.ifError(r.error);assert.equal(r.status,0,r.stderr);assert.equal(h.requests().length,0);assert.equal(fs.existsSync(join(h.root,'evidence')),false);
});
