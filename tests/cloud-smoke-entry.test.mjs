import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync,mkdirSync,readdirSync,statSync,existsSync,symlinkSync,chmodSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runId,token } from './fixtures/cloud-smoke-data.mjs';
const posix=process.platform!=='win32';
import { harness } from './fixtures/cloud-smoke-harness.mjs';

test('import remains inert even with complete opt-in/credentials', {skip:!posix},t=>{
 const h=harness(t);const r=spawnSync(process.execPath,['--import',join(h.root,'test-preload.mjs'),'--input-type=module','-e','await import('+JSON.stringify(pathToFileURL(join(h.root,'scripts/cloud-smoke.mjs')).href)+')'],{cwd:h.root,env:h.env,encoding:'utf8',timeout:10000});assert.equal(r.status,0,r.stderr);assert.deepEqual(h.requests(),[]);assert.equal(existsSync(join(h.root,'evidence')),false);
});
for(const args of [[],['--help'],['--execute-replay-smoke','--again']])test('bare/unknown CLI arguments refuse before any reservation or request '+JSON.stringify(args),{skip:!posix},t=>{const h=harness(t);assert.equal(h.execute(args).status,1);assert.deepEqual(h.requests(),[]);assert.equal(existsSync(join(h.root,'evidence')),false);});
for(const mode of ['token','client-credentials'])test('actual '+mode+' CLI completes the one replay lifecycle through the real HTTP/auth adapters', {skip:!posix},t=>{
 const h=harness(t);if(mode==='client-credentials'){h.env.RG_CLOUD_SMOKE_AUTH_MODE=mode;delete h.env.RELEASEGUARD_TOKEN;h.env.RG_CLOUD_SMOKE_AUTH_FILE=join(h.root,'auth/selected.json');}
 const r=h.execute();assert.equal(r.status,0,r.stderr);const requests=h.requests();assert.equal(requests.length,mode==='token'?4:5);assert.equal(requests.filter(v=>v.method==='POST'&&v.url.includes('/api/v2/')).length,3);assert.equal(requests.find(v=>v.url.endsWith('/api/v2/jobs')).body.source,'replay');
 const terminal=h.json(join(h.privateRun,'terminal.json')),summary=h.json(h.publicFile),job=h.json(join(h.privateRun,'job.json'));assert.equal(terminal.passed,true);assert.equal(summary.privateEvidencePublished,false);assert.equal(summary.passed,true);assert.equal(job.result.total,10);assert.equal(job.input.scenario,'passing');
 assert.equal(statSync(h.privateRun).mode&0o777,0o700);for(const p of ['started.json','terminal.json','job.json'])assert.equal(statSync(join(h.privateRun,p)).mode&0o777,0o600);
 const files=readdirSync(join(h.privateRun,'operations'));assert.equal(files.filter(x=>x.endsWith('-observed.json')).length,4);const observation=h.json(join(h.privateRun,'operations/006-observed.json'));assert.equal(Object.hasOwn(observation,'body'),false);assert.deepEqual(JSON.parse(Buffer.from(observation.rawEntityBase64,'base64')),job);
 const all=JSON.stringify([terminal,summary,job,...files.map(n=>h.json(join(h.privateRun,'operations',n)))]);for(const secret of [token,'INSECURE_TEST_ONLY_SECRET'])assert.equal(all.includes(secret),false);assert.equal((r.stdout+r.stderr).includes(token),false);
 const old=readFileSync(join(h.privateRun,'terminal.json'));assert.equal(h.execute().status,1);assert.equal(h.requests().length,requests.length);assert.deepEqual(readFileSync(join(h.privateRun,'terminal.json')),old);
});
test('partial old reservation is never resumed or overwritten, and legacy fixed evidence stays intact',{skip:!posix},t=>{
 const h=harness(t);mkdirSync(h.privateRun,{recursive:true,mode:0o700});writeFileSync(join(h.privateRun,'started.json'),'OLD_UNKNOWN');writeFileSync(join(h.root,'evidence/cloud-smoke.json'),'OLD_ORIGINAL');assert.equal(h.execute().status,1);assert.deepEqual(h.requests(),[]);assert.equal(readFileSync(join(h.privateRun,'started.json'),'utf8'),'OLD_UNKNOWN');assert.equal(readFileSync(join(h.root,'evidence/cloud-smoke.json'),'utf8'),'OLD_ORIGINAL');assert.equal(existsSync(join(h.privateRun,'terminal.json')),false);
});
test('pre-existing public summary refuses before creating a run or authorizing',{skip:!posix},t=>{const h=harness(t);mkdirSync(join(h.root,'evidence'),{mode:0o700});writeFileSync(h.publicFile,'OLD');assert.equal(h.execute().status,1);assert.deepEqual(h.requests(),[]);assert.equal(existsSync(h.privateRun),false);assert.equal(readFileSync(h.publicFile,'utf8'),'OLD');});
for(const [name,change]of [
 ['opt-in',h=>{delete h.env.RG_ALLOW_CLOUD_SMOKE;}],['allowlist',h=>{h.env.RG_CLOUD_ALLOWED_ORIGINS='https://other.example.test';}],['classroom',h=>{h.env.RELEASEGUARD_URL='https://localhost:5193';h.env.RG_CLOUD_ALLOWED_ORIGINS=h.env.RELEASEGUARD_URL;}],['source',h=>{h.env.RG_COMMIT='main';}],['image',h=>{h.env.RG_IMAGE='rg:latest';}],['automatic CI',h=>{h.env.CI='true';}],['pull_request',h=>{Object.assign(h.env,{CI:'true',GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'pull_request'});}]
])test('invalid '+name+' refuses before fixture/auth access or reservation',{skip:!posix},t=>{const h=harness(t);change(h);assert.equal(h.execute().status,1);assert.deepEqual(h.requests(),[]);assert.equal(existsSync(join(h.root,'evidence')),false);});
test('selected auth file is mandatory and explicit modes never fall back to ambient credentials',{skip:!posix},t=>{const h=harness(t,{RG_CLOUD_SMOKE_AUTH_MODE:'client-credentials'});assert.equal(h.execute().status,1);assert.deepEqual(h.requests(),[]);assert.equal(h.json(join(h.privateRun,'terminal.json')).passed,false);});
for(const fault of ['started-sync','observed-sync','terminal-sync','summary-sync','source-drift','wrong-source','http503','echo'])test(fault+' stops the real CLI; original evidence cannot be silently retried or promoted',{skip:!posix},t=>{
 const h=harness(t,{RG_SYNTHETIC_SMOKE_FAULT:fault}),r=h.execute();assert.equal(r.status,1);assert.equal((r.stdout+r.stderr).includes('SYNTHETIC_PRIVATE_UPSTREAM_ERROR'),false);assert.equal((r.stdout+r.stderr).includes(token),false);
 const count=h.requests().length;assert.equal(count,fault==='started-sync'?0:['observed-sync','http503','echo'].includes(fault)?1:4);assert.equal(h.execute().status,1);assert.equal(h.requests().length,count);
 if(fault==='http503'){const obs=h.json(join(h.privateRun,'operations/003-observed.json'));assert.equal(obs.status,503);assert.equal(JSON.parse(Buffer.from(obs.rawEntityBase64,'base64')).error,'SYNTHETIC_PRIVATE_UPSTREAM_ERROR');assert.equal(readFileSync(h.publicFile,'utf8').includes('UPSTREAM_ERROR'),false);}
 if(fault==='echo'){const obs=h.json(join(h.privateRun,'operations/003-observed.json'));assert.equal(obs.credentialEchoWithheld,true);assert.equal(obs.rawEntityBase64,null);}
});
test('symlinked CLI is explicitly refused before authorization',{skip:!posix},t=>{const h=harness(t);symlinkSync(join(h.root,'scripts/cloud-smoke.mjs'),join(h.root,'alias.mjs'));const r=spawnSync(process.execPath,['--import',join(h.root,'test-preload.mjs'),join(h.root,'alias.mjs'),'--execute-replay-smoke'],{cwd:h.root,env:h.env,encoding:'utf8',timeout:10000});assert.equal(r.status,1);assert.deepEqual(h.requests(),[]);});
test('unsafe private directory permissions are not silently chmodded or reused',{skip:!posix},t=>{const h=harness(t);mkdirSync(join(h.root,'evidence/private'),{recursive:true});chmodSync(join(h.root,'evidence/private'),0o755);assert.equal(h.execute().status,1);assert.equal(statSync(join(h.root,'evidence/private')).mode&0o777,0o755);assert.deepEqual(h.requests(),[]);});
test('selected client credentials require private file permissions, with no authentication dispatch',{skip:!posix},t=>{const h=harness(t,{RG_CLOUD_SMOKE_AUTH_MODE:'client-credentials'});delete h.env.RELEASEGUARD_TOKEN;h.env.RG_CLOUD_SMOKE_AUTH_FILE=join(h.root,'auth/selected.json');chmodSync(h.env.RG_CLOUD_SMOKE_AUTH_FILE,0o644);assert.equal(h.execute().status,1);assert.deepEqual(h.requests(),[]);});
