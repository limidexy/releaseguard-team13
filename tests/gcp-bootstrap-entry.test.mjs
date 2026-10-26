import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,copyFile,writeFile,readFile,readdir,rm,stat,chmod,symlink } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { bootstrapConfiguration } from './fixtures/gcp-bootstrap-data.mjs';
const id='00000000-0000-4000-8000-000000000001',posix={skip:process.platform==='win32'?'New-material writer requires POSIX ownership, modes and directory fsync; OpenSSL is never run by these tests':false};
const args=()=>['--execute-new-material','--input','inputs/bootstrap.json','--run-id',id,'--ack-new-realm-only'];
const out=root=>join(root,'evidence/private/gcp-bootstrap',id),sha=x=>createHash('sha256').update(x).digest('hex');
async function exists(p){try{await stat(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function fixture(t){
 const root=await mkdtemp(join(realpathSync(tmpdir()),'rg-bootstrap-'));t.after(()=>rm(root,{recursive:true,force:true}));
 for(const d of ['scripts','tests/fixtures','inputs'])await mkdir(join(root,d),{recursive:true,mode:0o700});
 for(const file of ['scripts/gcp-bootstrap.mjs','scripts/gcp-bootstrap-core.mjs','scripts/gcp-private-core.mjs','scripts/gcp-infra-core.mjs','scripts/acceptance-process.mjs',
  'tests/fixtures/gcp-bootstrap-boundary.mjs','tests/fixtures/gcp-bootstrap-data.mjs','tests/fixtures/gcp-private-data.mjs'])await copyFile(new URL('../'+file,import.meta.url),join(root,file));
 await writeFile(join(root,'inputs/bootstrap.json'),JSON.stringify(bootstrapConfiguration()),{mode:0o600});
 await writeFile(join(root,'.env.groq'),'MODEL_API_KEY=INSECURE_TEST_ONLY_NOT_REAL',{mode:0o600});return root;
}
function invoke(root,a=args(),opts={}){
 const env={PATH:process.env.PATH,RG_BOOTSTRAP_FIXTURE_ROOT:root,...opts.env};for(const k of ['SystemRoot','WINDIR','TEMP','TMP'])if(process.env[k])env[k]=process.env[k];
 return spawnSync(process.execPath,['--import',pathToFileURL(join(root,'tests/fixtures/gcp-bootstrap-boundary.mjs')).href,...(opts.nodeArgs??[join(root,'scripts/gcp-bootstrap.mjs'),...a])],{cwd:root,env,encoding:'utf8',timeout:10000,maxBuffer:1048576});
}
async function events(root){try{return (await readFile(join(root,'boundary-events.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);}catch(e){if(e.code==='ENOENT')return [];throw e;}}
async function safe(root,r){assert.equal(await exists(join(root,'forbidden-boundary')),false);for(const v of ['PRIVATE_FAILURE_DO_NOT_PRINT','PRIVATE_FSYNC_FAILURE_DO_NOT_PRINT','BEGIN PRIVATE KEY','INSECURE_TEST_ONLY_NOT_REAL'])assert.equal((r.stdout+r.stderr).includes(v),false);}
test('import has no key generation, subprocess, file creation or network side effects',async t=>{
 const root=await fixture(t),url=pathToFileURL(join(root,'scripts/gcp-bootstrap.mjs')).href;
 const r=invoke(root,[],{nodeArgs:['--input-type=module','-e','await import('+JSON.stringify(url)+')'],env:{ALLOW_REAL_MODEL:'true',MODEL_API_KEY:'INSECURE_TEST_ONLY_NOT_REAL'}});
 assert.equal(r.status,0,r.stderr);assert.equal(r.stdout,'');assert.equal(await exists(join(root,'evidence')),false);assert.deepEqual(await events(root),[]);await safe(root,r);
});
test('bare command refuses before any material preparation',async t=>{
 const root=await fixture(t),r=invoke(root,[]);assert.equal(r.status,1);assert.equal(await exists(join(root,'evidence')),false);assert.deepEqual(await events(root),[]);await safe(root,r);
});
test('CI execution is explicitly refused, even with all execution flags',async t=>{
 const root=await fixture(t),r=invoke(root,args(),{env:{CI:'true'}});assert.equal(r.status,1);assert.equal(await exists(join(root,'evidence')),false);assert.deepEqual(await events(root),[]);await safe(root,r);
});
test('explicit isolated CLI completes through fake OpenSSL and retains private audit hashes and input bytes',posix,async t=>{
 const root=await fixture(t),input=join(root,'inputs/bootstrap.json'),before=await readFile(input),r=invoke(root);
 assert.equal(r.status,0,r.stderr);await safe(root,r);assert.deepEqual(await readFile(input),before);
 const done=JSON.parse(await readFile(join(out(root),'terminal.json'),'utf8'));assert.equal(done.state,'new_material_prepared_not_applied');assert.equal(done.fileAloneIsNotProofOfSuccessfulExitOrDurability,true);
 assert.equal(done.inputSHA256,sha(before));assert.equal(done.planOnly,true);assert.equal(done.identityServerContacted,false);
 for(const[p,h]of Object.entries(done.sourceSHA256))assert.equal(h,sha(await readFile(join(root,p))));
 for(const f of done.files){const b=await readFile(join(out(root),f.path));assert.equal(f.sha256,sha(b));assert.equal(f.size,b.length);assert.equal((await stat(join(out(root),f.path))).mode&0o777,0o600);}
 assert.equal((await stat(out(root))).mode&0o777,0o700);assert.equal((await stat(join(out(root),'operations'))).mode&0o777,0o700);
 assert.equal((await events(root)).filter(e=>e.kind==='fake-command').length,6);assert.equal((await events(root)).filter(e=>e.kind==='fake-random'&&e.n===36).length,12);
 const normal=JSON.parse(await readFile(join(out(root),'secrets-existing-subjects.json'),'utf8')),fresh=JSON.parse(await readFile(join(out(root),'secrets-new-realm-only.json'),'utf8'));
 const realm=b=>JSON.parse(b.items.find(s=>s.metadata.name==='rg-identity').stringData['releaseguard-realm.json']);
 assert.equal(realm(normal).users.some(u=>u.credentials||u.requiredActions),false);assert.ok(realm(fresh).users.every(u=>u.credentials[0].temporary&&u.requiredActions[0]==='UPDATE_PASSWORD'));
});
test('missing acknowledgement cannot generate or reserve output',posix,async t=>{
 const root=await fixture(t),r=invoke(root,args().slice(0,-1));assert.equal(r.status,1);assert.equal(await exists(join(root,'evidence')),false);assert.deepEqual(await events(root),[]);await safe(root,r);
});
for(const[parent,mode]of [[false,0o644],[true,0o755]])test('public-readable '+(parent?'input parent':'input')+' is refused without changing permissions',posix,async t=>{
 const root=await fixture(t),p=join(root,parent?'inputs':'inputs/bootstrap.json');await chmod(p,mode);
 const r=invoke(root);assert.equal(r.status,1);assert.equal((await stat(p)).mode&0o777,mode);assert.deepEqual(await events(root),[]);assert.equal(await exists(join(root,'evidence')),false);await safe(root,r);
});
test('unknown input fields refuse without leaking contents or reserving a run',posix,async t=>{
 const root=await fixture(t),c=bootstrapConfiguration();c.MODEL_API_KEY='PRIVATE_FAILURE_DO_NOT_PRINT';await writeFile(join(root,'inputs/bootstrap.json'),JSON.stringify(c));
 const r=invoke(root);assert.equal(r.status,1);assert.equal(await exists(join(root,'evidence')),false);assert.deepEqual(await events(root),[]);await safe(root,r);
});
test('completed run cannot be overwritten, resumed or reissued',posix,async t=>{
 const root=await fixture(t),first=invoke(root);assert.equal(first.status,0,first.stderr);const bytes=await readFile(join(out(root),'terminal.json')),before=await events(root),r=invoke(root);
 assert.equal(r.status,1);assert.deepEqual(await readFile(join(out(root),'terminal.json')),bytes);assert.deepEqual(await events(root),before);await safe(root,r);
});
test('partial unknown run is retained without generation or fabricated terminal',posix,async t=>{
 const root=await fixture(t);await mkdir(out(root),{recursive:true,mode:0o700});await writeFile(join(out(root),'started.json'),'ORIGINAL UNKNOWN',{mode:0o600});
 const r=invoke(root);assert.equal(r.status,1);assert.deepEqual(await readdir(out(root)),['started.json']);assert.equal(await readFile(join(out(root),'started.json'),'utf8'),'ORIGINAL UNKNOWN');assert.deepEqual(await events(root),[]);await safe(root,r);
});
for(const kind of ['input','output','CLI'])test('symlink '+kind+' is refused without new secrets',posix,async t=>{
 const root=await fixture(t);let a=args(),opts={};
 if(kind==='input'){await symlink(join(root,'inputs/bootstrap.json'),join(root,'inputs/alias.json'));a[2]='inputs/alias.json';}
 if(kind==='output'){await mkdir(join(root,'evidence'));await mkdir(join(root,'decoy'));await symlink(join(root,'decoy'),join(root,'evidence/private'));}
 if(kind==='CLI'){await symlink(join(root,'scripts/gcp-bootstrap.mjs'),join(root,'scripts/alias.mjs'));opts={nodeArgs:[join(root,'scripts/alias.mjs'),...args()]};}
 const r=invoke(root,a,opts);assert.equal(r.status,1);assert.deepEqual(await events(root),[]);if(kind==='output')assert.deepEqual(await readdir(join(root,'decoy')),[]);await safe(root,r);
});
test('unsupported OpenSSL version is observed once and stops before random generation',posix,async t=>{
 const root=await fixture(t),r=invoke(root,args(),{env:{RG_BOOTSTRAP_FIXTURE_VERSION:'LibreSSL 3.3.6'}});assert.equal(r.status,1);
 assert.deepEqual((await events(root)).map(e=>e.kind),['fake-command']);assert.equal(JSON.parse(await readFile(join(out(root),'terminal.json'),'utf8')).phase,'openssl-version');await safe(root,r);
});
test('failed command preserves observed status, stops and never retries the ID',posix,async t=>{
 const root=await fixture(t),r=invoke(root,args(),{env:{RG_BOOTSTRAP_FIXTURE_FAIL:'command-3'}});assert.equal(r.status,1);
 const done=JSON.parse(await readFile(join(out(root),'terminal.json'),'utf8'));assert.equal(done.state,'failed_or_unknown_retained');assert.equal(done.phase,'request-postgres');
 const observed=JSON.parse(await readFile(join(out(root),'operations/006-observed.json'),'utf8'));assert.equal(observed.status,7);assert.equal(observed.rawCloseCode,7);
 assert.equal((await events(root)).filter(e=>e.kind==='fake-command').length,3);const before=await events(root);assert.equal(invoke(root).status,1);assert.deepEqual(await events(root),before);await safe(root,r);
});
for(const kind of ['started-sync','materials-sync','terminal-sync'])test('failed '+kind+' leaves original partial bytes and no automatic retry',posix,async t=>{
 const root=await fixture(t),r=invoke(root,args(),{env:{RG_BOOTSTRAP_FIXTURE_FAIL:kind}});assert.equal(r.status,1);await safe(root,r);
 const before=await events(root);assert.equal(before.filter(e=>e.kind==='fake-fsync-failure').length,1);
 const filename=kind.replace('-sync','.json'),bytes=await readFile(join(out(root),filename));
 assert.equal(invoke(root).status,1);assert.deepEqual(await readFile(join(out(root),filename)),bytes);assert.deepEqual(await events(root),before);
 if(kind==='started-sync'){const failed=JSON.parse(await readFile(join(out(root),'terminal.json'),'utf8'));assert.equal(failed.state,'failed_or_unknown_retained');assert.equal(failed.phase,'reservation');}
 if(kind==='terminal-sync')assert.equal(JSON.parse(bytes).fileAloneIsNotProofOfSuccessfulExitOrDurability,true);
});
