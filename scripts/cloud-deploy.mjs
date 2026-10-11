import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const roles=['registry','evaluation','governance','support','worker','gateway'];
const required=name=>{if(!process.env[name])throw Error('Missing '+name);return process.env[name]};
const image=required('RG_IMAGE'),source=required('RG_COMMIT');
if(!/@sha256:[a-f0-9]{64}$/.test(image)||!/^[a-f0-9]{40}$/.test(source))throw Error('Immutable image and exact source required');
const k=(...args)=>execFileSync('kubectl',['-n','releaseguard',...args],{encoding:'utf8',timeout:360000});
const node=(file,env={})=>execFileSync(process.execPath,[file],{stdio:'inherit',timeout:180000,env:{...process.env,...env}});
const snapshot=()=>roles.map(role=>{const d=JSON.parse(k('get','deployment',role,'-o','json'));return{role,image:d.spec.template.spec.containers[0].image,source:d.metadata.annotations?.['releaseguard/source']??null,desired:d.spec.replicas,ready:d.status.readyReplicas??0}});
const rollout=()=>{for(const role of roles)console.log(k('rollout','status','deployment/'+role,'--timeout=240s').trim())};
const report={at:new Date().toISOString(),source,image,ciRun:process.env.RG_CI_RUN,approval:'Manual workflow dispatch; no independent human approval gate on this free-private trial.',stages:[]};
await mkdir('evidence/current',{recursive:true});
const smoke=async(label,env={})=>{node('scripts/cloud-smoke.mjs',env);const s=JSON.parse(await readFile('evidence/cloud-smoke.json','utf8'));await writeFile('evidence/current/cloud-smoke-'+label+'.json',JSON.stringify(s,null,2));report.stages.push({name:label,passed:true,jobId:s.job.id})};
let before,changed=false;
const restore=()=>{for(const d of before){k('set','image','deployment/'+d.role,d.role+'='+d.image,'--field-manager=kubectl');k('annotate','deployment/'+d.role,'releaseguard/source='+(d.source??'unrecorded'),'--overwrite','--field-manager=kubectl')}rollout()};
try{
 before=snapshot();report.before=before;
 if(before.some(d=>!d.ready||!/@sha256:[a-f0-9]{64}$/.test(d.image)))throw Error('Previous deployments must be healthy and digest-pinned');
 if(process.env.RG_PROVE_ROLLBACK==='true'&&before.some(d=>d.image===image))throw Error('Rollback proof needs a different previous image');
 node('scripts/render-cloud.mjs');changed=true;
 console.log(k('apply','--server-side','--field-manager=kubectl','-f','deploy/k8s/rendered/services.yaml'));rollout();
 await smoke('candidate');
 if(process.env.RG_PROVE_ROLLBACK==='true'){
   restore();await smoke('previous',{RG_COMMIT:before[0].source??'unrecorded',RG_IMAGE:before[0].image});report.rollbackTested=true;
   console.log(k('apply','--server-side','--field-manager=kubectl','-f','deploy/k8s/rendered/services.yaml'));rollout();await smoke('restored-candidate');
 }
 for(const role of roles)k('annotate','deployment/'+role,'releaseguard/source='+source,'--overwrite','--field-manager=kubectl');
 report.after=snapshot();
 if(report.after.some(d=>d.image!==image||d.ready<d.desired||d.source!==source))throw Error('Deployed identity or readiness mismatch');
 report.passed=true;
}catch(e){
 report.passed=false;report.error=String(e);process.exitCode=1;
 if(changed&&before){try{restore();await smoke('failure-recovery',{RG_COMMIT:before[0].source??'unrecorded',RG_IMAGE:before[0].image});report.recoveredPrevious=true}catch(r){report.recoveryError=String(r)}}
}finally{
 report.finishedAt=new Date().toISOString();await writeFile('evidence/current/cloud-deployment.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({passed:report.passed,rollbackTested:report.rollbackTested??false,recoveredPrevious:report.recoveredPrevious??false,error:report.error}));
}
