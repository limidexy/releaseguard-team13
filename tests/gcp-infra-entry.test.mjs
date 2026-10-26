import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, readdir, rm, stat, chmod, symlink } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const runId='00000000-0000-4000-8000-000000000001';
const posix={skip:process.platform==='win32'?'Offline private writer requires POSIX modes and directory fsync; only pure data/import checks run on Windows':false};
const config=()=>({publicOrigin:'https://releaseguard.example.test',publicIP:'203.0.113.10',podCIDR:'10.44.0.0/16',clockSkewBoundMs:137,
  images:{postgres:'example.test/postgres@sha256:'+'a'.repeat(64),rabbitmq:'example.test/rabbitmq@sha256:'+'b'.repeat(64),
    identity:'example.test/keycloak@sha256:'+'c'.repeat(64),edge:'example.test/caddy@sha256:'+'d'.repeat(64)}});
const sha=b=>createHash('sha256').update(b).digest('hex');
async function exists(p){try{await stat(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function fixture(t){
  const root=await mkdtemp(join(realpathSync(tmpdir()),'rg-gcp-infra-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  for(const sub of ['scripts','deploy/postgres','tests/fixtures'])await mkdir(join(root,sub),{recursive:true});
  for(const file of ['scripts/gcp-render-infra.mjs','scripts/gcp-infra-core.mjs','scripts/render-cloud.mjs','deploy/postgres/init.sql','tests/fixtures/gcp-infra-boundary.mjs'])await copyFile(new URL('../'+file,import.meta.url),join(root,file));
  await writeFile(join(root,'input.json'),JSON.stringify(config()));
  await writeFile(join(root,'.env.groq'),'MODEL_API_KEY=TEST_ONLY_FILE_SECRET_DO_NOT_PRINT');
  return root;
}
function invoke(root,args,options={}){
  const env={PATH:process.env.PATH,RG_GCP_FIXTURE_ROOT:root,...options.env};
  for(const key of ['SystemRoot','WINDIR','TEMP','TMP'])if(process.env[key])env[key]=process.env[key];
  return spawnSync(process.execPath,['--import',pathToFileURL(join(root,'tests/fixtures/gcp-infra-boundary.mjs')).href,...(options.nodeArgs??[join(root,'scripts/gcp-render-infra.mjs'),...args])],
    {cwd:root,env,encoding:'utf8',timeout:10000,maxBuffer:2*1024*1024});
}
const args=()=>['--offline','--config','input.json','--run-id',runId];
const output=root=>join(root,'evidence/private/gcp-renders',runId);
async function assertNoForbidden(root){assert.equal(await exists(join(root,'forbidden-boundary')),false);}
test('importing the actual CLI neither renders nor reads implicit credentials or calls tools',async t=>{
  const root=await fixture(t),url=pathToFileURL(join(root,'scripts/gcp-render-infra.mjs')).href;
  const r=invoke(root,[],{nodeArgs:['--input-type=module','-e','await import('+JSON.stringify(url)+')'],env:{PUBLIC_ORIGIN:config().publicOrigin,MODEL_API_KEY:'TEST_ONLY_ENV_SECRET_DO_NOT_PRINT',ALLOW_REAL_MODEL:'true'}});
  assert.equal(r.status,0,r.stderr);assert.equal(r.stdout,'');assert.equal(await exists(join(root,'evidence')),false);
  assert.equal(await readFile(join(root,'.env.groq'),'utf8'),'MODEL_API_KEY=TEST_ONLY_FILE_SECRET_DO_NOT_PRINT');
  await assertNoForbidden(root);
});
test('bare CLI refuses before any input or output operation',async t=>{
  const root=await fixture(t),r=invoke(root,[]);
  assert.equal(r.status,1,r.stderr);assert.equal(await exists(join(root,'evidence')),false);await assertNoForbidden(root);
});
test('explicit plan writes exclusive private hashed outputs without private values or a deployment claim',posix,async t=>{
  const root=await fixture(t),r=invoke(root,args(),{env:{MODEL_API_KEY:'TEST_ONLY_ENV_SECRET_DO_NOT_PRINT',ALLOW_REAL_MODEL:'true'}});
  assert.equal(r.status,0,r.stderr);
  const dir=output(root),files=(await readdir(dir)).sort();
  assert.deepEqual(files,['completed.json','infra.json','requirements.json','started.json']);
  const done=JSON.parse(await readFile(join(dir,'completed.json'),'utf8'));
  assert.equal(done.state,'rendered_not_applied');assert.equal(done.planOnly,true);
  assert.equal(done.privateInputsSupplied,false);assert.equal(done.deploymentVerified,false);assert.equal(done.runtimeModelStateVerified,false);
  assert.equal(done.inputConfigSHA256,sha(await readFile(join(root,'input.json'))));
  for(const [file,hash]of Object.entries(done.sourceSHA256))assert.equal(hash,sha(await readFile(join(root,file))));
  for(const [file,hash]of Object.entries(done.outputSHA256))assert.equal(hash,sha(await readFile(join(dir,file))));
  assert.equal((await stat(dir)).mode&0o777,0o700);
  for(const file of files){assert.equal((await stat(join(dir,file))).mode&0o777,0o600);assert.equal((await readFile(join(dir,file),'utf8')).includes('TEST_ONLY_'),false);}
  assert.equal(r.stdout.includes('SECRET'),false);await assertNoForbidden(root);
});
test('existing run IDs never overwrite, resume or chmod old evidence',posix,async t=>{
  const root=await fixture(t);assert.equal(invoke(root,args()).status,0);
  const dir=output(root),before=Object.fromEntries(await Promise.all((await readdir(dir)).map(async f=>[f,await readFile(join(dir,f),'utf8')])));
  const r=invoke(root,args());assert.equal(r.status,1);
  for(const [file,data]of Object.entries(before))assert.equal(await readFile(join(dir,file),'utf8'),data);
  assert.equal(await exists(join(dir,'failed.json')),false);await assertNoForbidden(root);
});
test('an incomplete pre-existing run is retained, not restarted',posix,async t=>{
  const root=await fixture(t),dir=output(root);await mkdir(dir,{recursive:true,mode:0o700});
  await writeFile(join(dir,'started.json'),'ORIGINAL UNKNOWN',{mode:0o600});
  const r=invoke(root,args());assert.equal(r.status,1);assert.deepEqual(await readdir(dir),['started.json']);
  assert.equal(await readFile(join(dir,'started.json'),'utf8'),'ORIGINAL UNKNOWN');await assertNoForbidden(root);
});
test('invalid input cannot create even a started plan or echo a secret-bearing value',posix,async t=>{
  const root=await fixture(t);await writeFile(join(root,'input.json'),JSON.stringify({...config(),MODEL_API_KEY:'TEST_ONLY_DO_NOT_PRINT'}));
  const r=invoke(root,args());assert.equal(r.status,1);assert.equal((r.stderr+r.stdout).includes('TEST_ONLY_DO_NOT_PRINT'),false);
  assert.equal(await exists(join(root,'evidence')),false);await assertNoForbidden(root);
});
test('credential-looking input filename is refused before being read',posix,async t=>{
  const root=await fixture(t),r=invoke(root,['--offline','--config','.env.groq','--run-id',runId]);
  assert.equal(r.status,1);assert.equal(await exists(join(root,'evidence')),false);await assertNoForbidden(root);
});
test('oversize config is refused without creating evidence',posix,async t=>{
  const root=await fixture(t);await writeFile(join(root,'input.json'),' '.repeat(65537));
  const r=invoke(root,args());assert.equal(r.status,1);assert.equal(await exists(join(root,'evidence')),false);await assertNoForbidden(root);
});
test('symlink input cannot redirect reading to a different file',posix,async t=>{
  const root=await fixture(t);await symlink(join(root,'input.json'),join(root,'alias.json'));
  const r=invoke(root,['--offline','--config','alias.json','--run-id',runId]);assert.equal(r.status,1);
  assert.equal(await exists(join(root,'evidence')),false);await assertNoForbidden(root);
});
test('symlink output ancestor is rejected without touching its destination',posix,async t=>{
  const root=await fixture(t);await mkdir(join(root,'evidence'));await mkdir(join(root,'decoy'));await symlink(join(root,'decoy'),join(root,'evidence/private'));
  const r=invoke(root,args());assert.equal(r.status,1);assert.deepEqual(await readdir(join(root,'decoy')),[]);await assertNoForbidden(root);
});
test('existing public private-directory mode is refused, not silently changed',posix,async t=>{
  const root=await fixture(t);await mkdir(join(root,'evidence/private'),{recursive:true,mode:0o755});await chmod(join(root,'evidence/private'),0o755);
  const r=invoke(root,args());assert.equal(r.status,1);assert.equal((await stat(join(root,'evidence/private'))).mode&0o777,0o755);
  assert.deepEqual(await readdir(join(root,'evidence/private')),[]);await assertNoForbidden(root);
});
test('symlink CLI invocation refuses explicitly instead of silently claiming a no-op success',posix,async t=>{
  const root=await fixture(t);await symlink(join(root,'scripts/gcp-render-infra.mjs'),join(root,'scripts/alias.mjs'));
  const r=invoke(root,[],{nodeArgs:[join(root,'scripts/alias.mjs'),...args()]});assert.equal(r.status,1);
  assert.equal(await exists(join(root,'evidence')),false);await assertNoForbidden(root);
});
test('a failed output fsync preserves the partial plan and blocks a completed receipt or resume',posix,async t=>{
  const root=await fixture(t),r=invoke(root,args(),{env:{RG_GCP_FIXTURE_FAIL:'infra-sync'}});
  assert.equal(r.status,1,r.stderr);
  const dir=output(root);assert.equal(await exists(join(dir,'started.json')),true);assert.equal(await exists(join(dir,'infra.json')),true);
  assert.equal(await exists(join(dir,'completed.json')),false);
  const failed=JSON.parse(await readFile(join(dir,'failed.json'),'utf8'));assert.equal(failed.phase,'output');assert.equal(failed.resumeAllowed,false);
  const bytes=await readFile(join(dir,'infra.json'),'utf8');assert.equal(invoke(root,args()).status,1);assert.equal(await readFile(join(dir,'infra.json'),'utf8'),bytes);
  await assertNoForbidden(root);
});
test('actual current service renderer consumes requirements with complete configuration and secret-reference coverage',posix,async t=>{
  const root=await fixture(t);assert.equal(invoke(root,args()).status,0);
  const p=JSON.parse(await readFile(join(output(root),'infra.json'),'utf8')),req=JSON.parse(await readFile(join(output(root),'requirements.json'),'utf8'));
  const r=invoke(root,[],{nodeArgs:[join(root,'scripts/render-cloud.mjs')],env:{...req.servicesRendererEnv,RG_IMAGE:'example.test/app@sha256:'+'e'.repeat(64)}});
  assert.equal(r.status,0,r.stderr);
  const services=(await readFile(join(root,'deploy/k8s/rendered/services.yaml'),'utf8')).trim().split('\n---\n').map(JSON.parse);
  assert.equal(services.filter(d=>d.kind==='Namespace').length,0);
  assert.deepEqual(services.filter(d=>d.kind==='Deployment').map(d=>d.metadata.name),['registry','evaluation','governance','support','worker','gateway']);
  const all=[...p.items,...services],available=new Map(req.privateSecrets.map(s=>[s.name,s.keys]));
  for(const d of p.items.filter(d=>d.kind==='Secret'))available.set(d.metadata.name,Object.keys(d.stringData));
  function walk(v){if(!v||typeof v!=='object')return;if(v.secretKeyRef){const ref=v.secretKeyRef;assert.ok(available.get(ref.name)?.includes(ref.key),ref.name+':'+ref.key);}if(v.secret?.secretName)assert.ok(available.has(v.secret.secretName));if(v.configMapRef)assert.ok(all.some(d=>d.kind==='ConfigMap'&&d.metadata.name===v.configMapRef.name));for(const nested of Object.values(v))walk(nested);}
  all.forEach(walk);
  const cm=services.find(d=>d.kind==='ConfigMap').data;
  assert.equal(cm.SUBMISSION_CLOCK_SKEW_BOUND_MS,'137');assert.equal(cm.AUTH_MODE,'oidc');
  for(const d of services.filter(d=>d.kind==='Deployment'))assert.ok(d.spec.template.spec.volumes.some(v=>v.secret?.secretName==='rg-internal-ca'));
  assert.equal(p.items.find(d=>d.kind==='Secret'&&d.metadata.name==='rg-provider').stringData.ALLOW_REAL_MODEL,'false');
  await assertNoForbidden(root);
});
test('a newly-created output ancestor must sync its parent before any successful plan receipt',posix,async t=>{
  const root=await fixture(t),r=invoke(root,args(),{env:{RG_GCP_FIXTURE_FAIL:'parent-sync'}});
  assert.equal(r.status,1);assert.equal(await exists(join(output(root),'completed.json')),false);await assertNoForbidden(root);
});

