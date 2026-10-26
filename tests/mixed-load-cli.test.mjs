import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {chmod,copyFile,mkdir,mkdtemp,readFile,readdir,rm,stat,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
const repo=fileURLToPath(new URL('../',import.meta.url)),preload=join(repo,'tests/fixtures/mixed-load-boundary.mjs');
const key='OWNED_FAKE_AUTH_SECRET_NOT_REAL_12345678901234567890';
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'rg-mixed-load-'));t.after(()=>rm(root,{recursive:true,force:true}));
 for(const d of ['scripts','public'])await mkdir(join(root,d),{recursive:true});
 for(const f of ['contract-target.mjs','mixed-load-core.mjs','dev-tokens.mjs','fixtures.mjs','client.mjs'])await copyFile(join(repo,'scripts',f),join(root,'scripts',f));
 await copyFile(process.env.RG_MIXED_BASELINE_FILE??join(repo,'scripts/mixed-load.mjs'),join(root,'scripts/mixed-load.mjs'));
 await copyFile(join(repo,'public/demo-fixtures.json'),join(root,'public/demo-fixtures.json'));
 await writeFile(join(root,'package.json'),'{"type":"module"}');await writeFile(join(root,'.env'),'AUTH_SECRET='+key+'\n',{mode:0o600});
 await symlink(join(repo,'node_modules'),join(root,'node_modules'),'dir');
 const id=randomUUID();return{root,id,dir:join(root,'evidence/private/mixed-load',id)};
}
function environment(f,changes={}){
 return{RG_MIXED_LOAD_INTEGRATION:'1',RG_MIXED_LOAD_RUN_ID:f.id,RG_LOAD_SECONDS:'5',COMPOSE_PROJECT_NAME:'rg-ci-mixed-owned',RELEASEGUARD_URL:'http://127.0.0.1:55871',RG_MIXED_FIXTURE_ROOT:f.root,RG_MIXED_FIXTURE_MODE:'guard',...changes};
}
function run(f,changes={},importOnly=false){
 const cli=join(f.root,'scripts/mixed-load.mjs'),args=['--import',preload,...(importOnly?['--input-type=module','-e','await import('+JSON.stringify(new URL('file://'+cli).href)+')']:[cli])];
 const r=spawnSync(process.execPath,args,{cwd:f.root,env:environment(f,changes),encoding:'utf8',timeout:120000,maxBuffer:2*1024*1024});assert.equal(r.error,undefined);return r;
}
async function entries(path){return(await readdir(path).catch(()=>[])).sort();}
async function trace(f){return(await readFile(join(f.root,'boundary-trace.jsonl'),'utf8').catch(()=>'' )).trim().split('\n').filter(Boolean).map(JSON.parse);}
async function report(f){return JSON.parse(await readFile(join(f.dir,'report.json'),'utf8'));}
function clean(r){assert.doesNotMatch(r.stdout+r.stderr,/BOUNDARY_ATTEMPT:|OWNED_FAKE_AUTH_SECRET|OWNED_FAKE_SECRET_ERROR|Bearer /);}
for(const[name,changes]of[
 ['missing optin',{RG_MIXED_LOAD_INTEGRATION:''}],['missing runID',{RG_MIXED_LOAD_RUN_ID:''}],['path runID',{RG_MIXED_LOAD_RUN_ID:'../old'}],
 ['CI',{CI:'true'}],['Actions',{GITHUB_ACTIONS:'true'}],['classroom port',{RELEASEGUARD_URL:'http://127.0.0.1:5193'}],
 ['classroom compose project',{COMPOSE_PROJECT_NAME:'releaseguard-team13'}],['remote endpoint',{RELEASEGUARD_URL:'https://unrelated.example'}],
 ['implicit endpoint',{RELEASEGUARD_URL:''}],['Docker override',{DOCKER_HOST:'ssh://unrelated'}],['duration too short',{RG_LOAD_SECONDS:'4'}],['duration too long',{RG_LOAD_SECONDS:'31'}],
])test('CLI blocks '+name+' before commands, credentials or network',async t=>{
 const f=await fixture(t),r=run(f,changes);assert.notEqual(r.status,0);clean(r);assert.deepEqual(await trace(f),[]);assert.deepEqual(await entries(join(f.root,'evidence')),[]);
});
test('CLI import is inert despite supplied operator settings',async t=>{
 const f=await fixture(t),r=run(f,{},true);assert.equal(r.status,0,r.stderr);clean(r);assert.deepEqual(await trace(f),[]);assert.deepEqual(await entries(join(f.root,'evidence')),[]);
});
for(const mode of ['foreign','remote','replicas','binding','model'])test('target proof refuses '+mode+' before credentials or HTTP',async t=>{
 const f=await fixture(t),r=run(f,{RG_MIXED_FIXTURE_MODE:mode});assert.notEqual(r.status,0);clean(r);
 const events=await trace(f);assert.ok(!events.some(x=>x.http||x.credentialReads));assert.ok(!events.some(x=>['up','build','start','stop','pause','unpause','scale','rm','down'].includes(x.command)));
});
test('actual CLI completes full synthetic protocol using real token/target/core wiring and readonly telemetry',async t=>{
 const f=await fixture(t),r=run(f,{RG_MIXED_FIXTURE_MODE:'success'});assert.equal(r.status,0,r.stderr);clean(r);const d=await report(f);
 assert.equal(d.passed,true);assert.deepEqual(d.stages.map(s=>s.seed.length),[100,1000]);assert.equal(d.realProviderCalls,0);assert.equal(d.configuredJobsPerMinute,1000);
 assert.equal(d.protocol.clients,4);assert.ok(d.stages.every(s=>s.rowCountMatches&&s.completedWrites===s.admittedWrites&&s.before.containers.length===8&&s.after.containers.length===8));
 const tr=await trace(f);assert.ok(tr.findIndex(x=>x.proven)<tr.findIndex(x=>x.credentialReads));assert.ok(tr.filter(x=>x.source).every(x=>x.source==='replay'));
 assert.ok(tr.filter(x=>x.command).every(x=>['context','version','compose','inspect','exec','stats'].includes(x.command)));
 assert.equal((await stat(f.dir)).mode&0o777,0o700);for(const name of ['reserved.json','target.json','report.json','terminal.json'])assert.equal((await stat(join(f.dir,name))).mode&0o777,0o600);
 for(const name of ['reserved.json','target.json','report.json','terminal.json'])assert.doesNotMatch(await readFile(join(f.dir,name),'utf8'),/OWNED_FAKE_AUTH_SECRET|Bearer |OWNED_FAKE_SECRET_ERROR/);
 assert.equal(JSON.parse(await readFile(join(f.dir,'terminal.json'),'utf8')).status,'completed');
});
for(const mode of ['http429','unknown-saved'])test('actual CLI preserves '+mode+' as failure, with no retry or second-stage writes',async t=>{
 const f=await fixture(t),r=run(f,{RG_MIXED_FIXTURE_MODE:mode});assert.notEqual(r.status,0);clean(r);const d=await report(f),s=d.stages[0];
 assert.equal(d.passed,false);assert.equal(d.stages[1].state,'not_started');assert.ok(s.errors>0);assert.equal(s.admittedWrites,0);
 const tr=await trace(f),posts=tr.filter(x=>x.http==='POST'&&x.source);assert.equal(new Set(posts.map(x=>x.key)).size,posts.length);
 if(mode==='unknown-saved'){assert.ok(s.writtenJobs.some(w=>w.id&&w.submissionOutcome==='response_unknown'));assert.equal(s.rowCountMatches,false);}
});
test('reserved runID never re-enters target proof or overwrites old evidence',async t=>{
 const f=await fixture(t);await mkdir(f.dir,{recursive:true});await writeFile(join(f.dir,'reserved.json'),'old-unknown-run\n');
 const r=run(f);assert.notEqual(r.status,0);clean(r);assert.deepEqual(await trace(f),[]);assert.equal(await readFile(join(f.dir,'reserved.json'),'utf8'),'old-unknown-run\n');
});
test('output ancestor symlink is refused without touching the unrelated target',async t=>{
 const f=await fixture(t),target=join(f.root,'unrelated');await mkdir(target);await mkdir(join(f.root,'evidence'));await symlink(target,join(f.root,'evidence/private'),'dir');
 const r=run(f);assert.notEqual(r.status,0);clean(r);assert.deepEqual(await trace(f),[]);assert.deepEqual(await entries(target),[]);
});
test('credential symlink is rejected after target proof, before reading its contents',async t=>{
 const f=await fixture(t);await rm(join(f.root,'.env'));await writeFile(join(f.root,'owned-dummy-key'),'AUTH_SECRET='+key,{mode:0o600});await symlink(join(f.root,'owned-dummy-key'),join(f.root,'.env'));
 const r=run(f,{RG_MIXED_FIXTURE_MODE:'success'});assert.notEqual(r.status,0);clean(r);assert.ok(!(await trace(f)).some(x=>x.credentialReads||x.http));
});
test('public credential file is refused without chmod or HTTP',async t=>{
 const f=await fixture(t);await chmod(join(f.root,'.env'),0o644);const r=run(f,{RG_MIXED_FIXTURE_MODE:'success'});assert.notEqual(r.status,0);clean(r);assert.equal((await stat(join(f.root,'.env'))).mode&0o777,0o644);assert.ok(!(await trace(f)).some(x=>x.credentialReads||x.http));
});
test('sync failure before seed dispatch never emits the reserved job',async t=>{
 const f=await fixture(t),r=run(f,{RG_MIXED_FIXTURE_MODE:'intent-sync-failure'});assert.notEqual(r.status,0);clean(r);const tr=await trace(f);
 assert.equal(tr.filter(x=>x.source==='replay').length,0);assert.equal((await report(f)).passed,false);
});
test('terminal collision preserves old terminal and does not announce success',async t=>{
 const f=await fixture(t),r=run(f,{RG_MIXED_FIXTURE_MODE:'terminal-collision'});assert.notEqual(r.status,0);clean(r);assert.equal(await readFile(join(f.dir,'terminal.json'),'utf8'),'original-terminal\n');
 assert.doesNotMatch(r.stdout,/"status":"completed"/);
});

test('lower configured seed quota is obeyed without changing cohort, server config or identities',async t=>{
 const f=await fixture(t),r=run(f,{RG_MIXED_FIXTURE_MODE:'low-quota'});assert.equal(r.status,0,r.stderr);clean(r);const d=await report(f);
 assert.equal(d.configuredJobsPerMinute,100);assert.equal(d.passed,true);assert.deepEqual(d.stages.map(s=>s.seed.length),[100,1000]);
 const posts=(await trace(f)).filter(x=>x.http==='POST'&&x.candidate?.startsWith('load-seed-'));
 assert.equal(posts.length,1100);assert.equal(new Set(posts.map(x=>x.subject)).size,1);
 for(const ws of new Set(posts.map(x=>x.workspace))){
  const times=posts.filter(x=>x.workspace===ws).map(x=>x.atMs);
  assert.ok(times.every(at=>times.filter(x=>x>at-61000&&x<=at).length<=100));
 }
 assert.ok((await trace(f)).filter(x=>x.command).every(x=>!['up','scale','stop','start','pause','unpause'].includes(x.command)));
});
test('concurrent reservation permits only one process to enter even readonly target proof',async t=>{
 const f=await fixture(t),results=await Promise.all([1,2].map(()=>new Promise((resolve,reject)=>{
  const proc=spawn(process.execPath,['--import',preload,join(f.root,'scripts/mixed-load.mjs')],{cwd:f.root,env:environment(f,{RG_MIXED_FIXTURE_MODE:'foreign'}),stdio:['ignore','pipe','pipe']});
  const timer=setTimeout(()=>proc.kill('SIGKILL'),10000);let stdout='',stderr='';proc.stdout.on('data',b=>{stdout+=b;});proc.stderr.on('data',b=>{stderr+=b;});
  proc.once('error',reject);proc.once('close',status=>{clearTimeout(timer);resolve({status,stdout,stderr});});
 })));
 assert.ok(results.every(r=>r.status===1));results.forEach(clean);
 assert.equal((await trace(f)).filter(x=>x.command==='context').length,1);
 assert.ok(!(await trace(f)).some(x=>x.http||x.credentialReads));
});
