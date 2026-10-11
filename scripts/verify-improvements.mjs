import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import { token } from './dev-tokens.mjs';
import { application,suite } from './fixtures.mjs';
import { base,required,completed,key,request } from './client.mjs';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw Error('Local regression verification only');
const report={time:new Date().toISOString(),environment:'Local Docker; signed development identities; no provider calls',checks:[]};
async function check(name,fn){try{await fn();report.checks.push({name,passed:true});console.log('PASS '+name);}catch(e){report.checks.push({name,passed:false,error:String(e)});process.exitCode=1;}}
const t=await token('regression-author','contributor','regression-'+Date.now());
const a=await required('applications',t,application);
await check('Empty imported answer cannot pass a negative safety rule',async()=>{
  const s=await required('suites',t,{...suite,cases:[suite.cases.find(c=>c.id==='privacy')]});
  const q=await required('jobs',t,{appId:a.id,suiteId:s.id,candidate:'empty-safety',commitRef:'course-v2',source:'imported',outputs:[{caseId:'privacy',output:'  '}]},key());
  const j=await completed(q.id,t);assert.equal(j.result.gate,'blocked');assert.equal(j.result.errors,1);
  const review=await request('releases',t,{jobId:j.id,note:'Attempt review of empty evidence'});assert.equal(review.status,409);
});
await check('Prototype name is not accepted as an existing replay fixture',async()=>{
  const s=await required('suites',t,{...suite,cases:[{...suite.cases[0],id:'toString'}]});
  const q=await required('jobs',t,{appId:a.id,suiteId:s.id,candidate:'missing-fixture',commitRef:'course-v2',source:'replay'},key());
  const j=await completed(q.id,t);assert.equal(j.status,'succeeded');assert.equal(j.result.gate,'blocked');assert.match(j.result.results[0].reason,/fixture missing/);
});
await check('Gateway protects the console and serves a single shared fixture catalog',async()=>{
  const response=await fetch(base);assert.equal(response.status,200);assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  const fixtures=await(await fetch(base+'/demo-fixtures.json')).json();assert.deepEqual(fixtures.suite,suite);
  for(const path of ['/app.js','/style.css'])assert.equal((await fetch(base+path)).status,200);
});
await check('Pagination keeps history accessible and bounds query inputs',async()=>{
  const first=await required('jobs?limit=1&offset=0',t),second=await required('jobs?limit=1&offset=1',t);
  assert.equal(first.length,1);assert.equal(second.length,1);assert.notEqual(first[0].id,second[0].id);
  assert.equal((await request('jobs?limit=500',t)).status,400);
});
report.passed=report.checks.filter(c=>c.passed).length;report.failed=report.checks.length-report.passed;
await mkdir('evidence/current',{recursive:true});await writeFile('evidence/current/improvements-integration.json',JSON.stringify(report,null,2));
