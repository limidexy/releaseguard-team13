import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { required, key, base } from './client.mjs';
import { cloudToken } from './cloud-token.mjs';
import { application, suite } from './fixtures.mjs';
if(process.env.RG_ALLOW_CLOUD_SMOKE!=='true'||new URL(base).protocol!=='https:'||!(process.env.RG_CLOUD_ALLOWED_ORIGINS??'').split(',').includes(new URL(base).origin))throw Error('Explicit trial target required');
const k=(...a)=>execFileSync('kubectl',['-n','releaseguard',...a],{encoding:'utf8',timeout:60000});
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),ids=[],samples=[];
const originalMin=JSON.parse(k('get','scaledobject','evaluation-worker','-o','json')).spec.minReplicaCount;
const report={at:new Date().toISOString(),cloud:true,sourceCommit:process.env.RG_COMMIT,origin:base,providerCalls:0,requested:700,method:'Controlled backlog experiment: temporarily allow zero workers and block scale-out, keep the HPA alive for a 150-second warm-up and verify its external metric, enqueue 700 ten-case replay jobs, restore minimum one and unblock KEDA. Observe automatic scale-up to three and down to one. This is NOT natural traffic or a throughput benchmark. No manual scale-up to three.',samples};
try{
 const t=await cloudToken(),a=await required('applications',t,{...application,name:'Controlled cloud backlog '+Date.now()}),s=await required('suites',t,suite);
 k('annotate','scaledobject/evaluation-worker','autoscaling.keda.sh/paused-replicas=0','--overwrite');
 for(let i=0;i<30;i++){const d=JSON.parse(k('get','deployment','worker','-o','json'));if(d.spec.replicas===0&&(d.status.replicas??0)===0)break;if(i===29)throw Error('Consumers did not pause');await sleep(1000)}
 k('patch','scaledobject','evaluation-worker','--type=merge','-p',JSON.stringify({spec:{minReplicaCount:0}}));
 k('annotate','scaledobject/evaluation-worker','autoscaling.keda.sh/paused-scale-out=true','--overwrite');
 k('annotate','scaledobject/evaluation-worker','autoscaling.keda.sh/paused-replicas-');
 const warmStart=Date.now();while(Date.now()-warmStart<150000)await sleep(5000);
 const hpa=JSON.parse(k('get','hpa','keda-hpa-evaluation-worker','-o','json'));
 if(hpa.spec.behavior?.scaleUp?.selectPolicy!=='Disabled')throw Error('Scale-out hold not confirmed');
 const metric=JSON.parse(k('get','--raw','/apis/external.metrics.k8s.io/v1beta1/namespaces/releaseguard/s0-rabbitmq-releaseguard-evaluate?labelSelector=scaledobject.keda.sh%2Fname%3Devaluation-worker'));
 if(!metric.items?.length)throw Error('External metric unavailable');
 report.metricWarmup={elapsedMs:Date.now()-warmStart,hpaCreatedAt:hpa.metadata.creationTimestamp,metric};
 const enqueueToken=await cloudToken();let next=0;await Promise.all(Array.from({length:8},async()=>{while(next<700){const i=next++;const q=await required('jobs',enqueueToken,{appId:a.id,suiteId:s.id,candidate:'autoscale-'+i,commitRef:process.env.RG_COMMIT??'cloud-trial',source:'replay'},key());ids.push(q.id)}}));
 report.enqueued=ids.length;report.unpausedAt=new Date().toISOString();
 k('patch','scaledobject','evaluation-worker','--type=merge','-p',JSON.stringify({spec:{minReplicaCount:1}}));
 k('annotate','scaledobject/evaluation-worker','autoscaling.keda.sh/paused-scale-out-');
 let up=false,down=false;const end=Date.now()+210000;
 while(Date.now()<end){const d=JSON.parse(k('get','deployment','worker','-o','json'));let h;try{h=JSON.parse(k('get','hpa','keda-hpa-evaluation-worker','-o','json'))}catch{}const sample={at:new Date().toISOString(),desired:d.spec.replicas,ready:d.status.readyReplicas??0,hpaDesired:h?.status?.desiredReplicas,metrics:h?.status?.currentMetrics,conditions:h?.status?.conditions};samples.push(sample);console.log(JSON.stringify({at:sample.at,desired:sample.desired,ready:sample.ready,hpaDesired:sample.hpaDesired}));if(sample.ready>=3)up=true;if(up&&sample.desired===1&&sample.ready===1){down=true;break}await sleep(3000)}
 report.automaticScaleUp=up;report.automaticScaleDown=down;
 const verifyToken=await cloudToken(),rows=[];let cursor=0;await Promise.all(Array.from({length:8},async()=>{while(cursor<ids.length){const j=await required('jobs/'+ids[cursor++],verifyToken);rows.push({id:j.id,status:j.status,gate:j.result?.gate,attempts:j.attempts,workerId:j.worker_id})}}));
 report.jobs=rows;report.completed=rows.filter(j=>j.status==='succeeded'&&j.gate==='passed').length;report.workerIds=[...new Set(rows.map(j=>j.workerId))];
 report.events=JSON.parse(k('get','events','--field-selector','involvedObject.name=keda-hpa-evaluation-worker','-o','json')).items.filter(e=>Date.parse(e.lastTimestamp??e.metadata.creationTimestamp)>=Date.parse(report.unpausedAt)).map(e=>({reason:e.reason,message:e.message,lastTimestamp:e.lastTimestamp}));
 report.passed=up&&down&&report.completed===700;if(!report.passed)process.exitCode=1;
}catch(e){report.error=String(e);report.passed=false;process.exitCode=1}
finally{
 // Ensure a failed proof cannot leave consumers disabled. Pause at one for CD.
 try{k('patch','scaledobject','evaluation-worker','--type=merge','-p',JSON.stringify({spec:{minReplicaCount:originalMin}}));k('annotate','scaledobject/evaluation-worker','autoscaling.keda.sh/paused-scale-out-');k('annotate','scaledobject/evaluation-worker','autoscaling.keda.sh/paused-replicas=1','--overwrite');report.pausedAtOneForDeployment=true}catch(e){report.cleanupError=String(e);process.exitCode=1}
 report.finishedAt=new Date().toISOString();await mkdir('evidence/current',{recursive:true});await writeFile('evidence/current/cloud-autoscale.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,scaleUp:report.automaticScaleUp,scaleDown:report.automaticScaleDown,completed:report.completed,error:report.error}));
}
