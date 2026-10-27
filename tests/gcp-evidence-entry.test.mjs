import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join} from 'node:path';
import {evidenceHarness} from './fixtures/gcp-evidence-harness.mjs';
const posix={skip:process.platform==='win32'?'Owned private operator entry and directory fsync are POSIX-only':false};
test('actual offline CLI archives all ten roles, keeps failed originals byte-identical and derives separately without native commands',posix,t=>{
 const h=evidenceHarness(t),original=new Map(Object.entries(h.c.sources).map(([role,x])=>[role,fs.readFileSync(x.path)])),r=h.execute();assert.equal(r.status,0,r.stderr);assert.equal(h.commands().length,0);
 const m=h.json(join(h.run,'archive-manifest.json'));assert.equal(m.entries.length,10);assert.equal(m.notOneExperiment,true);
 for(const [role,bytes]of original){assert.deepEqual(fs.readFileSync(join(h.run,role)),bytes);assert.deepEqual(fs.readFileSync(h.c.sources[role].path),bytes);}
 assert.equal(h.json(join(h.run,'cloud-autoscale-first-capacity-failed.json')).passed,false);
 assert.equal(h.json(join(h.run,'cloud-benchmark.json')).summary[0].medianJobsPerSecond,5);
 assert.equal(h.json(join(h.run,'cloud-benchmark-derived.json')).summaries[0].medianJobsPerSecond,7);
 assert.equal(h.json(join(h.run,'terminal.json')).computeStopped,null);
 assert.equal(fs.statSync(h.run).mode&0o777,0o700);assert.equal(fs.statSync(join(h.run,'cloud-benchmark.json')).mode&0o777,0o600);
 const archive=fs.readFileSync(join(h.run,'archive-manifest.json'));assert.equal(h.execute().status,1);assert.deepEqual(fs.readFileSync(join(h.run,'archive-manifest.json')),archive);
 assert.equal(fs.existsSync(join(h.root,'evidence/current')),false);assert.equal(fs.existsSync(join(h.root,'docs')),false);
});
for(const powerOnly of [true,false])test('actual read-only CLI '+(powerOnly?'power-only':'full')+' consumes bounded native wrapper and records each command before interpretation',posix,t=>{
 const h=evidenceHarness(t,{mode:'collect-readonly',powerOnly}),r=h.execute();assert.equal(r.status,0,r.stderr);assert.equal(h.commands().length,9);
 const term=h.json(join(h.run,'terminal.json')),power=h.json(join(h.run,'cloud-power-state.json'));assert.equal(term.readOnlyCommands,9);assert.equal(term.archiveFiles,powerOnly?0:10);assert.equal(power.computeStopped,true);assert.equal(power.instances[0].status,'RUNNING');
 for(let n=1;n<=9;n++){const p=join(h.run,'operations',String(n).padStart(4,'0'));assert.equal(fs.existsSync(p+'-intent.json'),true);assert.equal(h.json(p+'-observed.json').status,0);assert.equal(h.json(p+'-result.json').state,'parsed');}
 assert.equal(fs.existsSync(join(h.run,'archive-manifest.json')),!powerOnly);assert.equal(fs.existsSync(join(h.run,'cloud-benchmark-derived.json')),!powerOnly);
 const calls=h.commands();assert.equal(h.execute().status,1);assert.deepEqual(h.commands(),calls);
});
for(const [fault,want]of [['active-node',false],['changed-MIG',null]])test('actual '+fault+' evidence never becomes a successful stop',posix,t=>{
 const h=evidenceHarness(t,{mode:'collect-readonly',powerOnly:true}),r=h.execute({RG_SYNTHETIC_EVIDENCE_FAULT:fault});assert.equal(r.status,0,r.stderr);assert.equal(h.json(join(h.run,'cloud-power-state.json')).computeStopped,want);
});
test('actual import and bare entry never read sources or issue a cloud command',posix,t=>{
 const h=evidenceHarness(t,{mode:'collect-readonly',powerOnly:true});assert.equal(h.importOnly().status,0);assert.equal(h.execute({},[]).status,1);assert.equal(h.commands().length,0);assert.equal(fs.existsSync(h.run),false);
});
for(const extra of [{CI:'true'},{GITHUB_ACTIONS:'true'}])test('automatic environment refuses before private reservation',posix,t=>{
 const h=evidenceHarness(t,{mode:'collect-readonly',powerOnly:true});assert.equal(h.execute(extra).status,1);assert.equal(h.commands().length,0);assert.equal(fs.existsSync(h.run),false);
});
for(const fault of ['wrong-namespace','changed-cluster','provider-credential-echo','duplicate-response','command-failure','intent-sync','observed-sync','terminal-sync','source-drift'])test('actual '+fault+' retains failed/unknown state and never retries a run',posix,t=>{
 const h=evidenceHarness(t,{mode:'collect-readonly'}),r=h.execute({RG_SYNTHETIC_EVIDENCE_FAULT:fault});assert.equal(r.status,1,r.stderr);
 assert.equal(h.commands().length<=9,true);assert.doesNotMatch(r.stdout+r.stderr,/INSECURE_SYNTHETIC_ONLY|INSECURE_PRIVATE_STORAGE_DIAGNOSTIC/);
 const count=h.commands().length;assert.equal(h.execute().status,1);assert.equal(h.commands().length,count);
 if(fault==='command-failure'){const observed=h.json(join(h.run,'operations/0001-observed.json'));assert.equal(observed.status,1);assert.equal(observed.rawStderr,'original synthetic failure');assert.equal(fs.existsSync(join(h.run,'operations/0001-result.json')),false);}
 if(fault==='provider-credential-echo'){const observed=h.json(join(h.run,'operations/0001-observed.json'));assert.equal(observed.credentialLikeContentWithheld,true);assert.equal(observed.rawStdout,null);}
});
test('offline archive sync failure preserves original and terminal failure, not a completed subset',posix,t=>{
 const h=evidenceHarness(t),path=h.c.sources['cloud-autoscale-first-capacity-failed.json'].path,bytes=fs.readFileSync(path),r=h.execute({RG_SYNTHETIC_EVIDENCE_FAULT:'archive-sync'});assert.equal(r.status,1);
 assert.deepEqual(fs.readFileSync(path),bytes);assert.equal(h.json(join(h.run,'terminal.json')).status,'failed_or_unknown_retained');assert.equal(fs.existsSync(join(h.run,'archive-manifest.json')),false);
});
for(const failure of ['source-hash','source-symlink','source-duplicate','unsafe-input','wrong-live-plugin'])test('actual '+failure+' cannot read unintended source or send a native command',posix,t=>{
 const h=evidenceHarness(t,{mode:'collect-readonly'}),p=h.c.sources['cloud-benchmark.json'].path;
 if(failure==='source-hash')fs.appendFileSync(p,' ');
 if(failure==='source-symlink'){fs.renameSync(p,p+'.original');fs.symlinkSync(p+'.original',p);}
 if(failure==='source-duplicate')fs.writeFileSync(p,'{"a":1,"a":2}');
 if(failure==='unsafe-input')fs.chmodSync(h.configFile,0o644);
 if(failure==='wrong-live-plugin'){const k=h.json(h.c.cloud.kubeconfigFile);k.users[0].user.exec.command='/bin/sh';fs.writeFileSync(h.c.cloud.kubeconfigFile,JSON.stringify(k));}
 const r=h.execute();assert.equal(r.status,1);assert.equal(h.commands().length,0);
});
test('selected kubeconfig drift stops before the next external command can execute the substituted plugin',posix,t=>{
 const h=evidenceHarness(t,{mode:'collect-readonly',powerOnly:true}),r=h.execute({RG_SYNTHETIC_EVIDENCE_FAULT:'kubeconfig-drift'});assert.equal(r.status,1);assert.equal(h.commands().length,1);
});
test('actual archive readback detects corrupted output, retains originals and does not write a success manifest',posix,t=>{
 const h=evidenceHarness(t),original=fs.readFileSync(h.c.sources['cloud-acceptance.json'].path),r=h.execute({RG_SYNTHETIC_EVIDENCE_FAULT:'archive-corruption'});
 assert.equal(r.status,1);assert.equal(h.json(join(h.run,'terminal.json')).status,'failed_or_unknown_retained');assert.deepEqual(fs.readFileSync(h.c.sources['cloud-acceptance.json'].path),original);
 assert.equal(fs.existsSync(join(h.run,'archive-manifest.json')),false);
});
test('ambient credential variables are not forwarded to the actual native wrapper or evidence',posix,t=>{
 const h=evidenceHarness(t,{mode:'collect-readonly',powerOnly:true}),r=h.execute({RELEASEGUARD_TOKEN:'INSECURE_AMBIENT_NOT_FORWARDED',GOOGLE_APPLICATION_CREDENTIALS:'/unselected/private.json'});
 assert.equal(r.status,0,r.stderr);assert.doesNotMatch(r.stdout+r.stderr,/INSECURE_AMBIENT/);assert.equal(h.commands().length,9);
});
