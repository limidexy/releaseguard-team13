// Execute ONLY the actual smoke run block in an owned shell fixture, never the
// deploy/render/rollout steps. These are fake API calls, not a manual-CD run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,mkdirSync,symlinkSync,globSync } from 'node:fs';
import { join,relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { harness } from './fixtures/cloud-smoke-harness.mjs';
import { config,token } from './fixtures/cloud-smoke-data.mjs';
const posix=process.platform!=='win32',lines=readFileSync(new URL('../.github/workflows/cd.yml',import.meta.url),'utf8').replaceAll('\r\n','\n').split('\n');
function actualStep(values){
 const at=lines.findIndex(l=>l.trim()==='- name: Authenticated replay smoke');assert.ok(at>0);const env={};let run;
 for(const line of lines.slice(at+1)){
  if(line.startsWith('      - '))break;
  if(line==='        env:'||!line.trim())continue;
  if(line.startsWith('        run: ')){run=line.slice(13);continue;}
  const m=line.match(/^          ([A-Z_]+): (.+)$/);assert.ok(m,'unexpected smoke step binding');
  env[m[1]]=m[2].replace(/^'(.*)'$/,'$1').replace(/\$\{\{ ([^}]+?) \}\}/g,(_,key)=>{assert.ok(Object.hasOwn(values,key),'unknown expression '+key);return values[key];});
 }
 assert.equal(typeof run,'string');return {env,run};
}
function execute(t,changes={}){
 const h=harness(t),c=config(),values={'vars.PUBLIC_ORIGIN':c.origin,'secrets.CLOUD_SMOKE_TOKEN':token,'inputs.image':c.image,'needs.check.outputs.source':c.commit,'github.run_id':'411111','github.run_attempt':'1'},step=actualStep(values);
 const bin=join(h.root,'bin');mkdirSync(bin);symlinkSync(process.execPath,join(bin,'node'));
 const r=spawnSync('/bin/bash',['--noprofile','--norc','-e','-o','pipefail','-c',step.run],{cwd:h.root,env:{PATH:bin,NODE_OPTIONS:'--import='+pathToFileURL(join(h.root,'test-preload.mjs')).href,CI:'true',GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_WORKFLOW:'Approved cloud deployment',GITHUB_SHA:c.commit,GITHUB_RUN_ID:'411111',GITHUB_RUN_ATTEMPT:'1',...step.env,...changes},encoding:'utf8',timeout:10000});assert.ifError(r.error);
 return {h,r,step,summary:join(h.root,'evidence/cloud-smoke-cd-411111-1.json')};
}
test('actual manual-CD smoke bindings and command invoke explicit token mode with a unique execution ID',{skip:!posix},t=>{
 const {h,r,step,summary}=execute(t);assert.equal(r.status,0,r.stderr);assert.equal(step.env.RG_CLOUD_SMOKE_AUTH_MODE,'token');assert.equal(h.requests().length,4);assert.equal(h.json(summary).passed,true);assert.equal((r.stdout+r.stderr).includes(token),false);
});
for(const [name,change]of [['automatic push',{GITHUB_EVENT_NAME:'push'}],['wrong source',{GITHUB_SHA:'c'.repeat(40)}],['wrong workflow',{GITHUB_WORKFLOW:'Other workflow'}],['wrong run',{GITHUB_RUN_ATTEMPT:'2'}]])test('actual CD smoke refuses '+name+' before authentication',{skip:!posix},t=>{const {h,r}=execute(t,change);assert.equal(r.status,1);assert.deepEqual(h.requests(),[]);});
test('actual artifact paths exclude all generated private observations/job and retain metadata only',{skip:!posix},t=>{
 const {h,r,summary}=execute(t);assert.equal(r.status,0,r.stderr);
 const at=lines.findIndex(l=>l.trim()==='name: deployment-evidence'),start=lines.findIndex((l,i)=>i>at&&l.trim()==='path: |');assert.ok(at>0&&start>at);
 const patterns=[];for(const l of lines.slice(start+1)){if(l.trim()&&!l.startsWith('            '))break;if(l.trim())patterns.push(l.trim());}
 const include=patterns.filter(p=>!p.startsWith('!')).map(p=>p.endsWith('/')?p+'**':p),exclude=patterns.filter(p=>p.startsWith('!')).map(p=>p.slice(1));
 const artifacts=globSync(include,{cwd:h.root,exclude,withFileTypes:true}).filter(d=>d.isFile()).map(d=>join(d.parentPath,d.name));assert.deepEqual(artifacts,[summary]);
 const privateFiles=globSync('evidence/private/**/*',{cwd:h.root,withFileTypes:true}).filter(d=>d.isFile());assert.ok(privateFiles.length>10);assert.equal(artifacts.some(p=>relative(h.root,p).startsWith('evidence/private/')),false);
});
