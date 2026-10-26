import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,copyFile,readFile,readdir,rm } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
async function fixture(t){
 const root=await mkdtemp(join(realpathSync(tmpdir()),'rg-cloud-token-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'scripts'));await mkdir(join(root,'tests/fixtures'),{recursive:true});
 for(const file of ['scripts/cloud-token.mjs','scripts/cloud-token-core.mjs','tests/fixtures/cloud-token-boundary.mjs'])await copyFile(new URL('../'+file,import.meta.url),join(root,file));return root;
}
function invoke(root,args,extra={}){
 const env={PATH:process.env.PATH,RG_TOKEN_FIXTURE_ROOT:root,AUTH_ISSUER:'https://releaseguard.example.test/auth/realms/releaseguard',RELEASEGUARD_URL:'https://releaseguard.example.test',
  RG_CLOUD_ALLOWED_ORIGINS:'https://releaseguard.example.test',OIDC_CLIENT_ID:'rg-viewer',OIDC_CLIENT_SECRET:'INSECURE_TEST_ONLY_ENTRY_SECRET_'+'x'.repeat(40),RG_ALLOW_CLOUD_SMOKE:'true',...extra};
 for(const k of ['SystemRoot','WINDIR','TEMP','TMP'])if(process.env[k])env[k]=process.env[k];
 return spawnSync(process.execPath,['--import',pathToFileURL(join(root,'tests/fixtures/cloud-token-boundary.mjs')).href,...args],{cwd:root,env,encoding:'utf8',timeout:10000,maxBuffer:1048576});
}
const load=root=>'const {cloudToken}=await import('+JSON.stringify(pathToFileURL(join(root,'scripts/cloud-token.mjs')).href)+');';
async function clean(root,result){assert.equal((await readdir(root)).includes('forbidden-boundary'),false);for(const text of ['INSECURE_TEST_ONLY_ENTRY_SECRET_','INSECURE_TEST_ONLY_ENTRY_TOKEN'])assert.equal((result.stdout+result.stderr).includes(text),false);}
test('module import is inert even with ambient cloud authorization and credentials present',async t=>{
 const root=await fixture(t),r=invoke(root,['--input-type=module','-e',load(root)]);assert.equal(r.status,0,r.stderr);assert.equal(r.stdout,'');assert.deepEqual((await readdir(root)).sort(),['scripts','tests']);await clean(root,r);
});
for(const a of [[],['--token','INSECURE_TEST_ONLY_ENTRY_TOKEN'],['--execute','--client-secret','INSECURE_TEST_ONLY_ENTRY_SECRET_']])test('CLI arguments never activate token acquisition or disclose values: '+a.length,async t=>{
 const root=await fixture(t),r=invoke(root,[join(root,'scripts/cloud-token.mjs'),...a]);assert.equal(r.status,1);assert.deepEqual((await readdir(root)).sort(),['scripts','tests']);await clean(root,r);
});
test('legacy positional API is refused instead of silently reading its issuer and credential from environment',async t=>{
 const root=await fixture(t),r=invoke(root,['--input-type=module','-e',load(root)+'const e=await cloudToken("rg-viewer","INSECURE_TEST_ONLY_ENTRY_SECRET_").catch(e=>e);if(e.code!=="invalid_configuration"||e.outcome!=="not_sent")process.exitCode=2;']);
 assert.equal(r.status,0,r.stderr);assert.deepEqual((await readdir(root)).sort(),['scripts','tests']);await clean(root,r);
});
test('missing configuration cannot acquire a token from otherwise valid ambient credentials',async t=>{
 const root=await fixture(t),r=invoke(root,['--input-type=module','-e',load(root)+'const e=await cloudToken().catch(e=>e);if(e.code!=="invalid_configuration"||e.outcome!=="not_sent")process.exitCode=2;']);
 assert.equal(r.status,0,r.stderr);assert.deepEqual((await readdir(root)).sort(),['scripts','tests']);await clean(root,r);
});
test('explicit default transport wiring returns the fake opaque token only to the caller, without files or logging',async t=>{
 const root=await fixture(t),config={allowServiceAuthentication:true,targetOrigin:'https://releaseguard.example.test',allowedOrigins:['https://releaseguard.example.test'],issuer:'https://releaseguard.example.test/auth/realms/releaseguard',clientId:'rg-viewer',clientSecret:'INSECURE_TEST_ONLY_ENTRY_SECRET_'+'x'.repeat(40),timeoutMs:15000};
 const r=invoke(root,['--input-type=module','-e',load(root)+'const value=await cloudToken('+JSON.stringify(config)+');console.log(JSON.stringify({matched:value==="INSECURE_TEST_ONLY_ENTRY_TOKEN"}));'],{RG_TOKEN_FIXTURE_ALLOW:'1'});
 assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout),{matched:true});assert.deepEqual((await readdir(root)).sort(),['fake-request','scripts','tests']);
 assert.deepEqual(JSON.parse(await readFile(join(root,'fake-request'),'utf8')),{sent:true,credentialsNotRecorded:true});await clean(root,r);
});
