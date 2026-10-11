import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir,writeFile } from 'node:fs/promises';
import { token } from './dev-tokens.mjs';
import { application,suite } from './fixtures.mjs';
import { base,required,completed,key } from './client.mjs';
if (!['localhost','127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Local fault experiment only');
const docker=(...args)=>execFileSync('docker',['compose',...args],{stdio:'pipe'});
const t=await token('fault-author','contributor','fault-'+Date.now()),a=await required('applications',t,application),s=await required('suites',t,suite);
let paused=false,report={time:new Date().toISOString(),environment:'Local Docker; replay only; deliberately pause support and kill worker',passed:false};
try {
  docker('up','-d','--no-deps','--scale','worker=1','worker');
  docker('pause','support');paused=true;
  const q=await required('jobs',t,{appId:a.id,suiteId:s.id,candidate:'fault-recovery',commitRef:'course-v2',source:'replay'},key());
  let running;
  for(let i=0;i<150;i++){running=await required('jobs/'+q.id,t);if(running.status==='running')break;await new Promise(r=>setTimeout(r,100))}
  assert.equal(running.status,'running');
  docker('kill','-s','SIGKILL','worker');
  docker('unpause','support');paused=false;
  docker('up','-d','--no-deps','worker');
  const recovered=await completed(q.id,t,120000);
  assert.equal(recovered.status,'succeeded');assert.equal(recovered.result.gate,'passed');assert.ok(recovered.attempts>=2);
  const reread=await required('jobs/'+q.id,t);assert.equal(reread.id,q.id);assert.deepEqual(reread.result,recovered.result);
  report={...report,passed:true,jobId:q.id,attempts:recovered.attempts,firstWorker:running.worker_id,finalWorker:recovered.worker_id,createdAt:recovered.created_at,finishedAt:recovered.finished_at,notes:'One final job row/result retained. This proves local worker process recovery, not database restore or HA.'};console.log(JSON.stringify(report,null,2));
}catch(e){report.error=String(e);process.exitCode=1;console.error(String(e))}
finally{if(paused)docker('unpause','support');docker('up','-d','--no-deps','worker');await mkdir('evidence',{recursive:true});await writeFile('evidence/fault-local.json',JSON.stringify(report,null,2))}
