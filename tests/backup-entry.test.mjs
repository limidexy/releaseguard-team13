import fs from 'node:fs';import {join} from 'node:path';import test from 'node:test';import assert from 'node:assert/strict';
import {backupHarness} from './fixtures/backup-cli-harness.mjs';import {sha256} from '../scripts/comparison-files.mjs';
const posix={skip:process.platform==='win32'?'Private operator requires POSIX permissions/fsync; no actual cloud/DB execution on Windows':false};
test('actual private CLI completes full3DB protocol, keeps binary dumps outside public paths, and preserves every original receipt',posix,t=>{
 const h=backupHarness(t),r=h.execute();assert.equal(r.status,0,r.stderr);const report=h.json(join(h.run,'terminal.json'));assert.equal(report.passed,true);assert.equal(report.verified,3);assert.equal(report.nativeCommandIntents,71);
 for(const db of report.databases){const bytes=fs.readFileSync(join(h.run,db.dump.path));assert.equal(sha256(bytes),db.dump.sha256);assert.equal(bytes.subarray(0,5).toString(),'PGDMP');assert.equal(bytes.includes(255),true);assert.equal(fs.statSync(join(h.run,db.dump.path)).mode&0o777,0o600);assert.equal(db.cleanup.state,'dropped_observed');}
 assert.equal(fs.existsSync(join(h.root,'evidence/current')),false);assert.equal(h.commands().filter(x=>x.kind==='restore').length,3);
 const original=fs.readFileSync(join(h.run,'terminal.json'));assert.equal(h.execute().status,1);assert.deepEqual(fs.readFileSync(join(h.run,'terminal.json')),original);assert.equal(h.commands().filter(x=>x.kind==='create').length,3);
});
test('two distinct runs retain separate binary backup and terminal bytes',posix,t=>{
 const h=backupHarness(t);assert.equal(h.execute().status,0);const original=fs.readFileSync(join(h.run,'terminal.json')),first=h.json(join(h.run,'terminal.json')),hashes=first.databases.map(d=>sha256(fs.readFileSync(join(h.run,d.dump.path))));
 const second={...h.c,runId:'62222222-2222-4222-8222-222222222222'},path=join(h.root,'inputs/second.json');fs.writeFileSync(path,JSON.stringify(second),{mode:0o600});assert.equal(h.execute({},['--execute-backup-restore','--input',path]).status,0);
 assert.deepEqual(fs.readFileSync(join(h.run,'terminal.json')),original);assert.deepEqual(first.databases.map(d=>sha256(fs.readFileSync(join(h.run,d.dump.path)))),hashes);
});
test('import, generic flags, CI, ambient credentials and unrecognized options cannot invoke a native command',posix,t=>{
 const h=backupHarness(t);assert.equal(h.importOnly().status,0);for(const args of [[],['--execute-replay-smoke'],[...h.args,'--retry']])assert.equal(h.execute({RG_ALLOW_CLOUD_SMOKE:'true'},args).status,1);
 for(const env of [{CI:'true'},{GITHUB_ACTIONS:'true'},{KUBECONFIG:h.c.cloud.kubeconfigFile},{GOOGLE_APPLICATION_CREDENTIALS:'not-a-file'},{RELEASEGUARD_TOKEN:'INSECURE_DUMMY_NOT_REAL'}])assert.equal(h.execute(env).status,1);assert.equal(h.commands().length,0);
});
for(const fault of ['foreign-pod','foreign-system','bad-dump','bad-table','mismatch','unknown-create','unmarked-create','unknown-restore','unknown-drop','intent-sync','observed-sync','terminal-sync'])test(fault+' retains failure and never retries or claims three successful databases',posix,t=>{
 const h=backupHarness(t),r=h.execute({RG_SYNTHETIC_BACKUP_FAULT:fault});assert.equal(r.status,1,r.stdout);assert.doesNotMatch(r.stdout+r.stderr,/PGDMP|SYNTHETIC_DISK_FAILURE|INSECURE_DUMMY/);
 assert.ok(h.commands().filter(c=>c.kind==='create').length<=(fault==='terminal-sync'?3:1));assert.ok(h.commands().filter(c=>c.kind==='drop').length<=(fault==='terminal-sync'?3:1));
 if(fs.existsSync(join(h.run,'terminal.json'))&&!fault.endsWith('-sync'))assert.equal(h.json(join(h.run,'terminal.json')).passed,false);
});
test('unsafe private inputs and symlinked selected binaries refuse before target commands',posix,t=>{
 const h=backupHarness(t);fs.chmodSync(h.configFile,0o644);assert.equal(h.execute().status,1);assert.equal(h.commands().length,0);
 fs.chmodSync(h.configFile,0o600);const path=h.c.cloud.kubectlExecutable;fs.renameSync(path,path+'-original');fs.symlinkSync(path+'-original',path);assert.equal(h.execute().status,1);assert.equal(h.commands().length,0);
});
