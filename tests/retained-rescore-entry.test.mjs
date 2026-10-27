import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { harness } from './fixtures/retained-rescore-harness.mjs';
import { retainedSource,credential } from './fixtures/retained-rescore-data.mjs';
const posix={skip:process.platform==='win32'?'Private operator entry is explicitly POSIX-only':false};
for(const revision of ['v2.1','v2.2'])test('actual '+revision+' CLI preserves original bytes and complete original/imported results privately',posix,t=>{
 const h=harness(t,{suiteRevision:revision}),raw=fs.readFileSync(h.sourceFile),r=h.execute();assert.equal(r.status,0,r.stderr);assert.equal(h.requests().length,9);
 assert.deepEqual(fs.readFileSync(h.sourceFile),raw);assert.deepEqual(fs.readFileSync(join(h.privateRun,'source-original.json')),raw);
 const report=h.json(join(h.privateRun,'report.json')),terminal=h.json(join(h.privateRun,'terminal.json'));assert.equal(terminal.status,'completed');assert.equal(report.runs.length,2);
 assert.equal(report.originalJobsUnchangedObserved,true);assert.equal(report.modelCallsRequested,0);assert.equal(report.passed,true);assert.equal(report.evaluatorVersion,'returns-policy-'+revision);
 assert.equal(fs.statSync(h.privateRun).mode&0o777,0o700);assert.equal(fs.statSync(join(h.privateRun,'source-original.json')).mode&0o777,0o600);assert.equal(fs.existsSync(join(h.root,'evidence/current')),false);
 const previous=fs.readFileSync(join(h.privateRun,'report.json'));assert.equal(h.execute().status,1);assert.equal(h.requests().length,9);assert.deepEqual(fs.readFileSync(join(h.privateRun,'report.json')),previous);
 assert.doesNotMatch(r.stdout+r.stderr,new RegExp(credential));
});
test('explicit service-client auth is consumed once, without fallback, refresh, model or public credential evidence',posix,t=>{
 const h=harness(t,{authMode:'client-credentials'}),r=h.execute();assert.equal(r.status,0,r.stderr);assert.equal(h.requests().filter(r=>r.issuer).length,1);
 const ops=fs.readdirSync(join(h.privateRun,'operations')).map(n=>fs.readFileSync(join(h.privateRun,'operations',n),'utf8')).join('\n');assert.doesNotMatch(ops,/INSECURE_RETAINED_CLIENT_SECRET|INSECURE_RETAINED_SYNTHETIC_TOKEN/);
});
for(const [name,args,env]of [['bare',[],{}],['unknown flag',['--execute-real'],{}],['CI',['--execute-imported-rescore'],{CI:'true'}],
 ['manual Actions',['--execute-imported-rescore'],{GITHUB_ACTIONS:'true'}],['ambient token',['--execute-imported-rescore'],{RELEASEGUARD_TOKEN:credential}],
 ['missing selected source',['--execute-imported-rescore'],{RG_CLOUD_RESCORE_SOURCE_FILE:undefined}]])test(name+' refuses before reservation/auth/target',posix,t=>{
 const h=harness(t),r=h.execute(args,env);assert.equal(r.status,1);assert.equal(h.requests().length,0);assert.equal(fs.existsSync(h.privateRun),false);
});
for(const fault of ['source-before','source-after','wrong-parent-version','http429','unknown-post','wrong-case-status','wrong-reason','wrong-workspace','wrong-output','wrong-source','failed-job',
 'credential-echo','started-sync','intent-sync','source-sync','observed-sync','terminal-sync','source-drift'])test('actual CLI '+fault+' retains failure and refuses uncertain resends',posix,t=>{
 const h=harness(t),r=h.execute(undefined,{RG_SYNTHETIC_RETAINED_FAULT:fault});assert.equal(r.status,1,r.stderr);
 assert.equal(h.requests().filter(r=>new URL(r.url).pathname==='/api/v2/jobs').length<=(['source-after','terminal-sync','source-drift'].includes(fault)?2:1),true);
 assert.doesNotMatch(r.stdout+r.stderr,/INSECURE_RETAINED_SYNTHETIC_TOKEN|INSECURE_PRIVATE_FSYNC_DIAGNOSTIC/);
 if(fault==='credential-echo'){const rows=fs.readdirSync(join(h.privateRun,'operations')).filter(n=>n.endsWith('-observed.json')).map(n=>h.json(join(h.privateRun,'operations',n)));
  assert.equal(rows[0].credentialEchoWithheld,true);assert.equal(rows[0].rawEntityBase64,null);}
});
for(const fault of ['issuer-failure','secret-echo'])test('actual '+fault+' issues no second authentication or imported job',posix,t=>{
 const h=harness(t,{authMode:'client-credentials'}),r=h.execute(undefined,{RG_SYNTHETIC_RETAINED_FAULT:fault});assert.equal(r.status,1);assert.equal(h.requests().filter(r=>r.issuer).length,1);
 assert.equal(h.requests().filter(r=>new URL(r.url).pathname==='/api/v2/jobs').length,0);assert.doesNotMatch(r.stdout+r.stderr,/INSECURE_RETAINED_CLIENT_SECRET/);
});
test('known selected credential in original input is never copied or sent',posix,t=>{
 const source=retainedSource();source.diagnostic=credential;const h=harness(t,{},source),r=h.execute();assert.equal(r.status,1);assert.equal(h.requests().length,0);assert.equal(fs.existsSync(join(h.privateRun,'source-original.json')),false);
});
test('unsafe auth permissions are refused without altering old source',posix,t=>{
 const h=harness(t),raw=fs.readFileSync(h.sourceFile);fs.chmodSync(h.authFile,0o644);assert.equal(h.execute().status,1);assert.equal(h.requests().length,0);assert.deepEqual(fs.readFileSync(h.sourceFile),raw);
});
test('selected source symlink is refused and cannot copy unrelated material',posix,t=>{
 const h=harness(t),original=fs.readFileSync(h.sourceFile),target=join(h.root,'inputs/original.json');fs.renameSync(h.sourceFile,target);fs.symlinkSync(target,h.sourceFile);
 const r=h.execute();assert.equal(r.status,1);assert.equal(h.requests().length,0);assert.deepEqual(fs.readFileSync(target),original);assert.equal(fs.existsSync(join(h.privateRun,'source-original.json')),false);
});
test('issuer-returned token already present in retained input is withheld before source copying or target access',posix,t=>{
 const source=retainedSource();source.diagnostic=credential;const h=harness(t,{authMode:'client-credentials'},source),r=h.execute();assert.equal(r.status,1);assert.equal(h.requests().filter(r=>r.issuer).length,1);
 assert.equal(h.requests().filter(r=>!r.issuer).length,0);assert.equal(fs.existsSync(join(h.privateRun,'source-original.json')),false);
});
test('duplicate-key source is ambiguous, not corrected or sent to target',posix,t=>{
 const h=harness(t),raw=fs.readFileSync(h.sourceFile,'utf8').replace('"minScore": 95','"minScore": 95,"min\\u0053core":95');fs.writeFileSync(h.sourceFile,raw);const r=h.execute();assert.equal(r.status,1);assert.equal(h.requests().length,0);assert.equal(fs.readFileSync(h.sourceFile,'utf8'),raw);
});
test('entry import with complete synthetic opt-ins remains inert',posix,t=>{
 const h=harness(t),r=spawnSync(process.execPath,['--import',join(h.root,'test-preload.mjs'),'--input-type=module','-e',"await import('./scripts/cloud-rescore-retained.mjs')"],{cwd:h.root,env:h.env,encoding:'utf8',timeout:10000});
 assert.ifError(r.error);assert.equal(r.status,0,r.stderr);assert.equal(h.requests().length,0);assert.equal(fs.existsSync(h.privateRun),false);
});
