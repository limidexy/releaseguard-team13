import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { token } from './dev-tokens.mjs';
import { application, suite } from './fixtures.mjs';
import { required, completed, key, base } from './client.mjs';
// Local-only comparison, bounded workload. No artificial sleeps inside evaluation and no paid calls.
if (!['localhost','127.0.0.1'].includes(new URL(base).hostname)) throw new Error('This local benchmark cannot target the cloud. Use an explicitly approved cloud experiment.');
const count=Number(process.env.RG_JOBS ?? 120), producers=Number(process.env.RG_PRODUCERS ?? 8);
if (!Number.isInteger(count)||count<20||count>500||!Number.isInteger(producers)||producers<1||producers>20) throw new Error('Benchmark limits exceeded');
const reports=[];
for (const replicas of [1,3]) {
  execFileSync('docker',['compose','up','-d','--no-deps','--scale',`worker=${replicas}`,'worker'],{stdio:'pipe'});
  await new Promise(r=>setTimeout(r,2000));
  const workspace=`load-${replicas}-${Date.now()}`,t=await token('load-producer','contributor',workspace),a=await required('applications',t,application),s=await required('suites',t,suite);
  // Warm-up, excluded from measurement.
  await completed((await required('jobs',t,{appId:a.id,suiteId:s.id,candidate:'warmup',commitRef:'course-v2',source:'replay'},key())).id,t);
  const start=performance.now(),jobs=[];let next=0;
  await Promise.all(Array.from({length:producers},async()=>{while(next<count){const i=next++;const submitStart=performance.now();const q=await required('jobs',t,{appId:a.id,suiteId:s.id,candidate:`load-${i}`,commitRef:'course-v2',source:'replay',scenario:'passing'},key());jobs.push({id:q.id,submitMs:performance.now()-submitStart});}}));
  const done=[];let index=0;
  await Promise.all(Array.from({length:producers},async()=>{while(index<jobs.length){const j=jobs[index++];done.push({...j,job:await completed(j.id,t)});}}));
  const elapsed=performance.now()-start,percentile=(values,q)=>{const v=[...values].sort((a,b)=>a-b);return v[Math.min(v.length-1,Math.ceil(v.length*q)-1)];};
  const duration=done.map(x=>new Date(x.job.finished_at)-new Date(x.job.created_at));
  const queue=done.map(x=>new Date(x.job.started_at)-new Date(x.job.created_at));
  reports.push({replicas,requestedJobs:count,completedJobs:done.filter(x=>x.job.status==='succeeded').length,blocked:done.filter(x=>x.job.result?.gate==='blocked').length,failed:done.filter(x=>x.job.status==='failed').length,elapsedMs:elapsed,jobsPerSecond:done.filter(x=>x.job.status==='succeeded').length*1000/elapsed,jobLatencyP50Ms:percentile(duration,.5),jobLatencyP95Ms:percentile(duration,.95),queueWaitP95Ms:percentile(queue,.95),submissionP95Ms:percentile(done.map(x=>x.submitMs),.95),workers:[...new Set(done.map(x=>x.job.worker_id))],workspace});
  console.log(JSON.stringify(reports.at(-1),null,2));
}
execFileSync('docker',['compose','up','-d','--no-deps','--scale','worker=1','worker'],{stdio:'pipe'});
await mkdir('evidence',{recursive:true});await writeFile('evidence/scaling-local.json',JSON.stringify({time:new Date().toISOString(),environment:'Local Docker, shared host, 0.5 CPU/384MB limit per application container, one PostgreSQL and one RabbitMQ',source:'static replay fixtures, ten cases/job, no provider calls',producers,cloud:false,automaticScaling:false,interpretation:'Observed comparison only. No proportional scaling promised; database, publisher batch interval, submission overhead and shared CPU can dominate. Distinguish manual replica scaling from cloud autoscaling.',reports},null,2));
