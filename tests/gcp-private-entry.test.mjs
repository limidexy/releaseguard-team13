import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,copyFile,writeFile,readFile,readdir,rm,stat,chmod,symlink } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { privateFixture } from './fixtures/gcp-private-data.mjs';
const id='00000000-0000-4000-8000-000000000001',posix={skip:process.platform==='win32'?'Private material writer requires POSIX ownership/modes/directory fsync':false};
const args=()=>['--offline','--input','inputs/private-input.json','--run-id',id];
const out=root=>join(root,'evidence/private/gcp-inputs',id),sha=x=>createHash('sha256').update(x).digest('hex');
async function exists(p){try{await stat(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function fixture(t){
 const root=await mkdtemp(join(realpathSync(tmpdir()),'rg-private-input-'));t.after(()=>rm(root,{recursive:true,force:true}));
 for(const d of ['scripts','tests/fixtures','inputs'])await mkdir(join(root,d),{recursive:true,mode:0o700});
 for(const file of ['scripts/gcp-render-private.mjs','scripts/gcp-private-core.mjs','scripts/gcp-infra-core.mjs','tests/fixtures/gcp-private-boundary.mjs'])await copyFile(new URL('../'+file,import.meta.url),join(root,file));
 await writeFile(join(root,'inputs/private-input.json'),JSON.stringify(privateFixture()),{mode:0o600});
 await writeFile(join(root,'.env.groq'),'MODEL_API_KEY=INSECURE_TEST_ONLY_NOT_A_REAL_KEY',{mode:0o600});return root;
}
function invoke(root,a=args(),opts={}){
 const env={PATH:process.env.PATH,RG_PRIVATE_FIXTURE_ROOT:root,...opts.env};for(const k of ['SystemRoot','WINDIR','TEMP','TMP'])if(process.env[k])env[k]=process.env[k];
 return spawnSync(process.execPath,['--import',pathToFileURL(join(root,'tests/fixtures/gcp-private-boundary.mjs')).href,...(opts.nodeArgs??[join(root,'scripts/gcp-render-private.mjs'),...a])],{cwd:root,env,encoding:'utf8',timeout:10000,maxBuffer:1048576});
}
async function noForbidden(root){assert.equal(await exists(join(root,'forbidden-boundary')),false);}
test('import is inert with a real-looking ambient provider configuration',async t=>{
 const root=await fixture(t),url=pathToFileURL(join(root,'scripts/gcp-render-private.mjs')).href;
 const r=invoke(root,[],{nodeArgs:['--input-type=module','-e','await import('+JSON.stringify(url)+')'],env:{ALLOW_REAL_MODEL:'true',MODEL_API_KEY:'INSECURE_TEST_ONLY_ENV'}});
 assert.equal(r.status,0,r.stderr);assert.equal(r.stdout,'');assert.equal(await exists(join(root,'evidence')),false);await noForbidden(root);
});
test('bare private writer refuses before any material read or file creation',async t=>{
 const root=await fixture(t),r=invoke(root,[]);assert.equal(r.status,1);assert.equal(await exists(join(root,'evidence')),false);await noForbidden(root);
});
test('explicit private plan preserves input bytes, permissions and hashes without disclosing values or mutating human passwords',posix,async t=>{
 const root=await fixture(t),input=join(root,'inputs/private-input.json'),before=await readFile(input),r=invoke(root);
 assert.equal(r.status,0,r.stderr);assert.equal((r.stdout+r.stderr).includes('INSECURE_TEST_ONLY'),false);assert.equal((r.stdout+r.stderr).includes('BEGIN'),false);
 assert.deepEqual(await readFile(input),before);assert.equal((await stat(input)).mode&0o777,0o600);
 const done=JSON.parse(await readFile(join(out(root),'completed.json'),'utf8')),bytes=await readFile(join(out(root),'secrets-k8s.json'));
 assert.equal(done.state,'private_inputs_rendered_not_applied');assert.equal(done.planOnly,true);assert.equal(done.inputSHA256,sha(before));assert.equal(done.outputSHA256,sha(bytes));
 assert.equal(done.humanPasswordResetDirectivesIncluded,false);assert.equal(done.newRandomSecretsOrKeysGenerated,false);
 for(const[p,h]of Object.entries(done.sourceSHA256))assert.equal(h,sha(await readFile(join(root,p))));
 const items=JSON.parse(bytes).items;assert.equal(items.length,10);assert.equal(items.some(x=>x.metadata.name==='rg-provider'),false);
 for(const name of await readdir(out(root)))assert.equal((await stat(join(out(root),name))).mode&0o777,0o600);
 assert.equal((await stat(out(root))).mode&0o777,0o700);await noForbidden(root);
});
test('public-readable input is refused before output reservation and never chmodded',posix,async t=>{
 const root=await fixture(t),file=join(root,'inputs/private-input.json');await chmod(file,0o644);
 const r=invoke(root);assert.equal(r.status,1);assert.equal(await exists(join(root,'evidence')),false);assert.equal((await stat(file)).mode&0o777,0o644);await noForbidden(root);
});
test('public-readable input parent is refused without changing its mode',posix,async t=>{
 const root=await fixture(t),parent=join(root,'inputs');await chmod(parent,0o755);
 const r=invoke(root);assert.equal(r.status,1);assert.equal(await exists(join(root,'evidence')),false);assert.equal((await stat(parent)).mode&0o777,0o755);await noForbidden(root);
});
test('invalid private material reports a phase but never its contents',posix,async t=>{
 const root=await fixture(t),f=privateFixture();f.tls.postgres.key='DO_NOT_PRINT_PRIVATE_VALUE';
 await writeFile(join(root,'inputs/private-input.json'),JSON.stringify(f));
 const r=invoke(root);assert.equal(r.status,1);assert.equal((r.stdout+r.stderr).includes('DO_NOT_PRINT'),false);assert.equal(await exists(join(root,'evidence')),false);await noForbidden(root);
});
test('existing private output IDs cannot be resumed or overwritten',posix,async t=>{
 const root=await fixture(t);assert.equal(invoke(root).status,0);
 const bytes=await readFile(join(out(root),'secrets-k8s.json')),r=invoke(root);
 assert.equal(r.status,1);assert.deepEqual(await readFile(join(out(root),'secrets-k8s.json')),bytes);assert.equal(await exists(join(out(root),'failed.json')),false);await noForbidden(root);
});
test('unknown partial private output is preserved without repair or regeneration',posix,async t=>{
 const root=await fixture(t);await mkdir(out(root),{recursive:true,mode:0o700});await writeFile(join(out(root),'started.json'),'ORIGINAL UNKNOWN',{mode:0o600});
 const r=invoke(root);assert.equal(r.status,1);assert.deepEqual(await readdir(out(root)),['started.json']);assert.equal(await readFile(join(out(root),'started.json'),'utf8'),'ORIGINAL UNKNOWN');await noForbidden(root);
});
test('symlink input cannot redirect the explicit read',posix,async t=>{
 const root=await fixture(t);await symlink(join(root,'inputs/private-input.json'),join(root,'inputs/alias.json'));
 const r=invoke(root,['--offline','--input','inputs/alias.json','--run-id',id]);assert.equal(r.status,1);assert.equal(await exists(join(root,'evidence')),false);await noForbidden(root);
});
test('symlink output ancestor does not receive private contents',posix,async t=>{
 const root=await fixture(t);await mkdir(join(root,'evidence'));await mkdir(join(root,'decoy'));await symlink(join(root,'decoy'),join(root,'evidence/private'));
 const r=invoke(root);assert.equal(r.status,1);assert.deepEqual(await readdir(join(root,'decoy')),[]);await noForbidden(root);
});
test('oversized private file is refused before deserialization or reservation',posix,async t=>{
 const root=await fixture(t);await writeFile(join(root,'inputs/private-input.json'),' '.repeat(262145));
 const r=invoke(root);assert.equal(r.status,1);assert.equal(await exists(join(root,'evidence')),false);await noForbidden(root);
});
test('private fsync failure retains partial original values and never creates a successful receipt',posix,async t=>{
 const root=await fixture(t),r=invoke(root,args(),{env:{RG_PRIVATE_FIXTURE_FAIL:'private-sync'}});
 assert.equal(r.status,1);assert.equal(await exists(join(out(root),'started.json')),true);assert.equal(await exists(join(out(root),'secrets-k8s.json')),true);
 assert.equal(await exists(join(out(root),'completed.json')),false);const failed=JSON.parse(await readFile(join(out(root),'failed.json'),'utf8'));assert.equal(failed.phase,'output');assert.equal(failed.resumeAllowed,false);
 const bytes=await readFile(join(out(root),'secrets-k8s.json'));assert.equal(invoke(root).status,1);assert.deepEqual(await readFile(join(out(root),'secrets-k8s.json')),bytes);await noForbidden(root);
});
test('symlink CLI invocation refuses explicitly instead of returning a misleading success',posix,async t=>{
 const root=await fixture(t);await symlink(join(root,'scripts/gcp-render-private.mjs'),join(root,'scripts/alias.mjs'));
 const r=invoke(root,[],{nodeArgs:[join(root,'scripts/alias.mjs'),...args()]});assert.equal(r.status,1);assert.equal(await exists(join(root,'evidence')),false);await noForbidden(root);
});

