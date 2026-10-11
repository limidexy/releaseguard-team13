import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { base, required, key } from './client.mjs';
import { cloudToken } from './cloud-token.mjs';
import { application, suite } from './fixtures.mjs';
if(process.env.RG_ALLOW_CLOUD_SMOKE!=='true'||new URL(base).protocol!=='https:'||!(process.env.RG_CLOUD_ALLOWED_ORIGINS??'').split(',').includes(new URL(base).origin))throw Error('Approved HTTPS trial required');
const k=(...args)=>execFileSync('kubectl',['-n','releaseguard',...args],{encoding:'utf8',timeout:60000});
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),ids=[],samples=[];
const report={at:new Date().toISOString(),cloud:true,sourceCommit:process.env.RG_COMMIT,providerCalls:0,requested:500,method:'Fault stimulus, not throughput: wait for an active HPA at one worker; SIGSTOP that worker process, schedule SIGCONT after 17 seconds while enqueueing 500 ten-case replay jobs. Actual elapsed pauseMs includes command latency and can exceed 17 seconds. Observe automatic queue-driven scale-out and scale-in. Never manually scale to three. This does not replace the failed cold/short-burst experiments.',samples};
let stoppedPod,stopAt,watchdog;
const resume=()=>{if(stoppedPod){k('exec',stoppedPod,'--','node','-e',"process.kill(1,'SIGCONT')");stoppedPod=null;report.pauseMs=Date.now()-stopAt;report.resumedAt=new Date().toISOString()}};
try{
 k('annotate','scaledobject/evaluation-worker','autoscaling.keda.sh/paused-replicas-');
 const deadline=Date.now()+240000;let ready=false;
 while(Date.now()<deadline){try{const h=JSON.parse(k('get','hpa','keda-hpa-evaluation-worker','-o','json'));if(h.status?.conditions?.some(c=>c.type==='ScalingActive'&&c.status==='True')&&h.status.desiredReplicas===1){report.warmHpa={at:new Date().toISOString(),conditions:h.status.conditions,metrics:h.status.currentMetrics};ready=true;break}}catch{}await sleep(5000)}
 if(!ready)throw Error('HPA not active at one; no fault injected');
 const token=await cloudToken(),a=await required('applications',token,{...application,name:'Worker pause autoscaling '+Date.now()}),s=await required('suites',token,suite);
 const pods=JSON.parse(k('get','pods','-l','app=worker','-o','json')).items.filter(p=>!p.metadata.deletionTimestamp&&p.status.conditions?.some(c=>c.type==='Ready'&&c.status==='True'));
 if(pods.length!==1)throw Error('Need exactly one healthy worker before the fault');
 stoppedPod=pods[0].metadata.name;report.pausedWorker=stoppedPod;stopAt=Date.now();report.faultAt=new Date().toISOString();
 k('exec',stoppedPod,'--','node','-e',"process.kill(1,'SIGSTOP')");
 let resumeError;watchdog=setTimeout(()=>{try{resume()}catch(e){resumeError=String(e)}},17000);
 let next=0;await Promise.all(Array.from({length:8},async()=>{while(next<500){const i=next++;const j=await required('jobs',token,{appId:a.id,suiteId:s.id,candidate:'worker-pause-'+i,commitRef:process.env.RG_COMMIT,source:'replay'},key());ids.push(j.id)}}));
 report.enqueued=ids.length;
 let up=false,down=false;const end=Date.now()+180000;
 while(Date.now()<end){const d=JSON.parse(k('get','deployment','worker','-o','json')),h=JSON.parse(k('get','hpa','keda-hpa-evaluation-worker','-o','json'));const sample={at:new Date().toISOString(),desired:d.spec.replicas,ready:d.status.readyReplicas??0,hpaDesired:h.status?.desiredReplicas,metrics:h.status?.currentMetrics};samples.push(sample);console.log(JSON.stringify(sample));if(sample.ready===3)up=true;if(up&&sample.desired===1&&sample.ready===1){down=true;break}await sleep(2000)}
 resume();if(resumeError)throw Error('Resume failed: '+resumeError);
 const verifyToken=await cloudToken(),jobs=[];let cursor=0;await Promise.all(Array.from({length:8},async()=>{while(cursor<ids.length){const j=await required('jobs/'+ids[cursor++],verifyToken);jobs.push({id:j.id,status:j.status,gate:j.result?.gate,workerId:j.worker_id,attempts:j.attempts})}}));
 report.jobs=jobs;report.completed=jobs.filter(j=>j.status==='succeeded'&&j.gate==='passed').length;report.workerIds=[...new Set(jobs.map(j=>j.workerId))];report.automaticScaleUp=up;report.automaticScaleDown=down;report.passed=up&&down&&report.completed===500;if(!report.passed)process.exitCode=1;
}catch(e){report.error=String(e);report.passed=false;process.exitCode=1}
finally{
 clearTimeout(watchdog);try{resume()}catch(e){report.resumeError=String(e);process.exitCode=1}
 try{k('annotate','scaledobject/evaluation-worker','autoscaling.keda.sh/paused-replicas=1','--overwrite')}catch(e){report.cleanupError=String(e);process.exitCode=1}
 report.finishedAt=new Date().toISOString();await mkdir('evidence/current',{recursive:true});await writeFile('evidence/current/cloud-autoscale-worker-pause.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,completed:report.completed,up:report.automaticScaleUp,down:report.automaticScaleDown,error:report.error}));
}
