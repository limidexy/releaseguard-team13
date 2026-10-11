import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { base, required, key } from './client.mjs';
import { cloudToken } from './cloud-token.mjs';
import { application, suite } from './fixtures.mjs';
if(process.env.RG_ALLOW_CLOUD_SMOKE!=='true'||new URL(base).protocol!=='https:'||!(process.env.RG_CLOUD_ALLOWED_ORIGINS??'').split(',').includes(new URL(base).origin))throw Error('Explicit approved HTTPS trial target required');
const n=Number(process.env.RG_JOBS??100),concurrency=8;
if(!Number.isInteger(n)||n<20||n>200)throw Error('Bounded 20..200 jobs only');
const k=(...a)=>execFileSync('kubectl',['-n','releaseguard',...a],{encoding:'utf8',timeout:180000});
const initial=JSON.parse(k('get','deployment','worker','-o','json')).spec.replicas;
const pct=(a,q)=>{const s=a.filter(Number.isFinite).sort((a,b)=>a-b);return s.length?s[Math.ceil(q*s.length)-1]:null};
const report={at:new Date().toISOString(),cloud:true,origin:base,automaticScaling:false,providerCalls:0,sourceCommit:process.env.RG_COMMIT,protocol:'Two paired rounds 1/3 then 3/1. 5 warm-up jobs excluded. 100 replay jobs/stage by default; fixed 8 producers; one bounded observer polls outstanding jobs once per second. 200 GETs/stage after completion. This is a short burst, not sustained capacity.',limits:'Two e2-standard-2 nodes; application limit 0.5 CPU and 384Mi each; shared single PostgreSQL and RabbitMQ; external client latency included.',stages:[]};
try{
 for(const [round,replicas] of [[1,1],[1,3],[2,3],[2,1]]){
  k('scale','deployment/worker','--replicas='+replicas);k('rollout','status','deployment/worker','--timeout=150s');
  const t=await cloudToken(),app=await required('applications',t,{...application,name:'Cloud benchmark '+Date.now()}),s=await required('suites',t,suite);
  const input=i=>({appId:app.id,suiteId:s.id,candidate:'cloud-load-'+i,commitRef:process.env.RG_COMMIT??'cloud-trial',source:'replay'});
  const waitJob=async id=>{const end=Date.now()+120000;while(Date.now()<end){const j=await required('jobs/'+id,t);if(['succeeded','failed'].includes(j.status))return j;await new Promise(r=>setTimeout(r,1000))}throw Error('Deadline '+id)};
  for(let i=0;i<5;i++)await waitJob((await required('jobs',t,input('warm-'+i),key())).id);
  const submitted=[],rows=[],errors=[];let next=0;const began=performance.now();
  await Promise.all(Array.from({length:concurrency},async()=>{while(next<n){const i=next++,start=performance.now();try{const q=await required('jobs',t,input(i),key());submitted.push({id:q.id,submitMs:performance.now()-start})}catch(e){errors.push({phase:'submit',i,error:String(e)})}}}));
  let cursor=0;
  await Promise.all(Array.from({length:concurrency},async()=>{while(cursor<submitted.length){const q=submitted[cursor++];try{rows.push({...q,job:await waitJob(q.id)})}catch(e){errors.push({phase:'observe',id:q.id,error:String(e)})}}}));
  const elapsedMs=performance.now()-began,reads=[];let rnext=0;
  await Promise.all(Array.from({length:concurrency},async()=>{while(rnext<200){const i=rnext++,start=performance.now();try{await required('jobs?limit=25&offset='+((i%4)*25),t);reads.push(performance.now()-start)}catch(e){errors.push({phase:'read',error:String(e)})}}}));
  const successful=rows.filter(r=>r.job.status==='succeeded'),stage={round,replicas,requested:n,completed:successful.length,failed:rows.filter(r=>r.job.status==='failed').length,elapsedMs,jobsPerSecond:successful.length*1000/elapsedMs,writeP95Ms:pct(submitted.map(q=>q.submitMs),.95),readRequests:200,readSuccessful:reads.length,readP95Ms:pct(reads,.95),completionP95Ms:pct(rows.map(r=>Date.parse(r.job.finished_at)-Date.parse(r.job.created_at)),.95),queueP95Ms:pct(rows.map(r=>Date.parse(r.job.started_at)-Date.parse(r.job.created_at)),.95),workerIds:[...new Set(rows.map(r=>r.job.worker_id))],errors,raw:rows.map(r=>({id:r.id,submitMs:r.submitMs,status:r.job.status,gate:r.job.result?.gate,createdAt:r.job.created_at,startedAt:r.job.started_at,finishedAt:r.job.finished_at,workerId:r.job.worker_id}))};
  report.stages.push(stage);console.log(JSON.stringify({...stage,raw:undefined}));
 }
 report.summary=[1,3].map(replicas=>{const s=report.stages.filter(s=>s.replicas===replicas);return{replicas,medianJobsPerSecond:pct(s.map(s=>s.jobsPerSecond),.5),errors:s.reduce((n,s)=>n+s.errors.length+s.failed,0)}});
 report.throughputRatio=report.summary[1].medianJobsPerSecond/report.summary[0].medianJobsPerSecond;
 report.interpretation=report.throughputRatio>1?'Higher burst throughput observed; only two rounds, not proportional scaling or sustained capacity.':'No throughput improvement observed; do not claim a scaling speedup.';
 report.passed=report.stages.every(s=>s.completed===n&&s.errors.length===0);if(!report.passed)process.exitCode=1;
}catch(e){report.error=String(e);report.passed=false;process.exitCode=1}
finally{try{k('scale','deployment/worker','--replicas='+initial);k('rollout','status','deployment/worker','--timeout=150s');report.restoredReplicas=initial}catch(e){report.cleanupError=String(e);process.exitCode=1}report.finishedAt=new Date().toISOString();await mkdir('evidence/current',{recursive:true});await writeFile('evidence/current/cloud-benchmark.json',JSON.stringify(report,null,2));}
