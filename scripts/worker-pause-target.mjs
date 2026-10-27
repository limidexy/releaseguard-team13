// Complete owned fault lifecycle. No direct signal boundary here: the exact
// in-container agent alone sends STOP/CONT; request/status never send signals.
// CAS ownership is per object. In-container UID/PID checks reduce name/restart
// races; same-UID malicious code, node/agent death and live recovery are unproven.
import {isDeepStrictEqual as same} from 'node:util';
import {autoscaleTarget} from './cloud-autoscale-target.mjs';
import {workerPauseInitProgram,workerPauseInitSHA256} from './worker-pause-init.mjs';
const owner='releaseguard.io/worker-pause',step=owner+'-step',pauses=['autoscaling.keda.sh/paused','autoscaling.keda.sh/paused-replicas','autoscaling.keda.sh/paused-scale-in','autoscaling.keda.sh/paused-scale-out'];
const ann=x=>x.metadata.annotations??{},ptr=k=>k.replace(/~/g,'~0').replace(/\//g,'~1'),clone=x=>structuredClone(x),deny=()=>{throw Error('Worker fault target unconfirmed');};
const stamp=x=>({spec:clone(x.spec),owner:ann(x)[owner],step:ann(x)[step],pauses:Object.fromEntries(pauses.filter(k=>Object.hasOwn(ann(x),k)).map(k=>[k,ann(x)[k]]))});
export function workerPauseTarget(c,io){
 const inspect=autoscaleTarget(c,io);let original,accepted,attempted,mutated=false,prepared=false,selection,fingerprint,packet,startAttempted=false,startConfirmed=false,requestAttempted=false,resumeProof,
  finished=false,finishResult,last=-Infinity;const journal=[];
 const check=clean=>{const now=io.now();if(!Number.isFinite(now)||now<last||io.remaining(clean)<=0)deny();last=now;};
 const own=s=>{if(![accepted,attempted].some(v=>v&&same(stamp(s),v)))deny();return s;};
 async function snapshot(clean=false){check(clean);const s=await inspect.inspectCurrent(clean);check(clean);if(original)own(s.controller);return s;}
 function faultFixture(w){
  const p=w.spec.template.spec,a=p.containers[0];
  if(p.hostPID===true||p.shareProcessNamespace===true||p.automountServiceAccountToken!==false||p.securityContext?.runAsUser!==1000||p.securityContext?.fsGroup!==1000||a.securityContext?.readOnlyRootFilesystem!==true||
   !same(a.env?.find(e=>e.name==='RG_TRIAL_POD_UID'),{name:'RG_TRIAL_POD_UID',valueFrom:{fieldRef:{apiVersion:'v1',fieldPath:'metadata.uid'}}})||
   a.env?.find(e=>e.name==='SERVICE_ROLE')?.value!=='worker'||!same(a.command,['/usr/local/bin/node','-e',workerPauseInitProgram])||
   !same(p.volumes?.find(v=>v.name==='worker-fault-journal'),{name:'worker-fault-journal',emptyDir:{medium:'Memory',sizeLimit:'1Mi'}})||
   !same(a.volumeMounts?.find(v=>v.name==='worker-fault-journal'),{name:'worker-fault-journal',mountPath:'/run/releaseguard-fault'}))deny();
 }
 async function patch(s,changes,clean=false){
  check(clean);const before=own(s),expected=clone(before);expected.metadata.annotations={...ann(before)};
  const ops=[{op:'test',path:'/metadata/uid',value:before.metadata.uid},{op:'test',path:'/metadata/resourceVersion',value:before.metadata.resourceVersion},{op:'test',path:'/spec',value:before.spec}];
  if(!before.metadata.annotations)ops.push({op:'add',path:'/metadata/annotations',value:{}});
  for(const [key,value]of Object.entries(changes)){
   if(Object.hasOwn(ann(before),key))ops.push({op:'test',path:'/metadata/annotations/'+ptr(key),value:ann(before)[key]});
   if(value===undefined){delete expected.metadata.annotations[key];if(Object.hasOwn(ann(before),key))ops.push({op:'remove',path:'/metadata/annotations/'+ptr(key)});}
   else{expected.metadata.annotations[key]=value;ops.push({op:Object.hasOwn(ann(before),key)?'replace':'add',path:'/metadata/annotations/'+ptr(key),value});}
  }
  mutated=true;attempted=stamp(expected);const r=await io.patch('controller',ops,clean);check(clean);if(!same(stamp(r),attempted))deny();accepted=stamp(r);attempted=null;return r;
 }
 function associated(r){return r&&r.runId===c.runId&&r.podUID===selection.uid;}
 function boundFingerprint(f){return f&&f.podUID===selection.uid&&f.mainSHA256===c.mainSHA256&&f.launcherSHA256===workerPauseInitSHA256&&Number.isInteger(f.workerPID)&&f.workerPID>1&&/^pid:\[\d+\]$/.test(f.pidNamespace??'')&&/^\d{1,24}$/.test(f.pidStartTicks??'');}
 function ended(r){
  if(!associated(r))return null;
  if(r.state==='cancelled_before_start'&&boundFingerprint(r.identity)&&!['T','t','Z','X'].includes(r.identity.workerState))return {confirmed:true,state:'cancelled_before_start',journal:clone(journal),raw:r};
  if(r.state!=='finished')return null;const f=r.finished;
  const ok=boundFingerprint(r.identity)&&r.identity.pidNamespace===fingerprint.pidNamespace&&r.identity.pidStartTicks===fingerprint.pidStartTicks&&f?.runId===c.runId&&f.podUID===selection.uid&&f.resumeObserved===true&&
   r.identity.workerPID===fingerprint.workerPID&&!['T','t','Z','X'].includes(r.identity.workerState)&&[0,1].includes(f.continueSignalAttempts)&&Number.isFinite(f.pauseMs)&&f.pauseMs>=0;
  return {confirmed:ok,state:ok?'resumed_observed':'failed_or_unknown_retained',journal:clone(journal),raw:r};
 }
 async function exec(kind,p,clean=false){check(clean);const r=await io.exec(kind,selection,p,clean);check(clean);journal.push({kind,body:clone(r)});return r;}
 async function resume(clean=true){
  if(!startAttempted)return {confirmed:true,state:'no_fault_started',journal:clone(journal)};
  if(resumeProof)return clone(resumeProof);
  let r;
  if(!requestAttempted){requestAttempted=true;try{r=await exec('fault-request-resume',{...packet,mode:'request-resume'},clean);}catch{}}
  const end=io.now()+40000;
  for(let n=0;n<41;n++){
   check(clean);if(n&&io.now()>=end)break;
   if(!r)try{r=await exec('fault-status',{...packet,mode:'status'},clean);}catch{break;}
   if(!associated(r))break;
   const endProof=ended(r);if(endProof)return resumeProof=endProof;
   r=null;await io.sleep(1000,clean);
  }
  return resumeProof={confirmed:false,state:'resume_unconfirmed_no_retry',journal:clone(journal)};
 }
 return {
  async preflight(){
   if(original)deny();await inspect.preflight();const s=await snapshot();faultFixture(s.worker);
   if([s.worker,s.controller].some(x=>Object.hasOwn(ann(x),owner)||Object.hasOwn(ann(x),step)))deny();original=clone(s.controller);accepted=stamp(original);
   return {controllerUID:c.controllerUID,workerUID:c.workerUID,explicitFaultFixture:true,notSameResourceEnvironmentAsHistoricalTrial:true};
  },
  async prepare(){
   if(!original||prepared)deny();let s=await snapshot();await patch(s.controller,{[owner]:c.runId,[step]:'active',[pauses[1]]:undefined});
   const end=io.now()+240000;let warm;
   for(let n=0;n<49;n++){check(false);if(io.now()>=end)deny();s=await snapshot();
    if(s.cohort?.desired===1&&s.cohort.ready===1&&s.hpa?.status?.desiredReplicas===1&&s.hpa.status.conditions?.some(x=>x.type==='ScalingActive'&&x.status==='True')){warm=s;break;}
    await io.sleep(5000,false);
   }
   if(!warm)deny();selection=clone(warm.cohort.pods[0]);
   const r=await exec('fault-inspect',{mode:'inspect',runId:c.runId,podUID:selection.uid,mainSHA256:c.mainSHA256,pidNamespace:null,pidStartTicks:null,workerPID:null,launcherSHA256:workerPauseInitSHA256,notAfterEpochMs:null,pauseMs:17000});
   if(r?.state!=='inspected'||!boundFingerprint(r.identity)||['T','t','Z','X'].includes(r.identity.workerState))deny();fingerprint=clone(r.identity);prepared=true;
   return {selectedPod:clone(selection),fingerprint:clone(fingerprint),warmHPA:clone(warm.hpa),watchdogRequestedMs:17000,agentHardKillRecoveryGuaranteed:false};
  },
  async start(){
   if(!prepared||startAttempted)deny();const s=await snapshot();if(s.cohort?.desired!==1||s.cohort.ready!==1||!same(s.cohort.pods[0],selection)||s.hpa?.status?.desiredReplicas!==1)deny();
   packet={mode:'start',runId:c.runId,podUID:selection.uid,mainSHA256:c.mainSHA256,pidNamespace:fingerprint.pidNamespace,pidStartTicks:fingerprint.pidStartTicks,workerPID:fingerprint.workerPID,launcherSHA256:workerPauseInitSHA256,notAfterEpochMs:io.wallNow()+10000,pauseMs:17000};
   startAttempted=true;const r=await exec('fault-start',packet);if(!associated(r)||r.state!=='stopped'||r.stopObserved!==true||r.watchdogArmed!==true||!boundFingerprint(r.identity)||r.identity.pidNamespace!==fingerprint.pidNamespace||r.identity.pidStartTicks!==fingerprint.pidStartTicks)deny();startConfirmed=true;return clone(r);
  },
  async sample(){const s=await snapshot();if(startAttempted&&!resumeProof){const r=await exec('fault-status',{...packet,mode:'status'});if(!associated(r))deny();const p=ended(r);if(p)resumeProof=p;}
   return {at:new Date(io.wallNow()).toISOString(),desired:s.worker.spec.replicas,ready:s.worker.status?.readyReplicas??0,verifiedCohort:Boolean(s.cohort),pods:clone(s.cohort?.pods??[]),hpaDesired:s.hpa?.status?.desiredReplicas??null,metrics:clone(s.hpa?.status?.currentMetrics??null),conditions:clone(s.hpa?.status?.conditions??null)};},
  resume,
  workers:inspect.workers,
  details:()=>({startAttempted,startConfirmed,requestAttempted,selection:clone(selection??null),resumeProof:clone(resumeProof??null),journal:clone(journal)}),
  async finish(success,postcondition){
   if(finished)return clone(finishResult??{state:'unknown_no_retry'});finished=true;finishResult={state:'failed_or_unknown_retained',originalStateRestored:false,pausedOneHandoff:false,retryAllowed:false};
   try{
    if(!mutated)return {...finishResult,state:'no_mutation',originalStateRestored:true};
    const resumed=await resume(true);if(!resumed.confirmed)deny();const current=await snapshot(true);if(current.cohort?.desired!==1||current.cohort.ready!==1)deny();
    const handoff=success&&postcondition==='paused-one-for-cd',changes={};for(const key of pauses)changes[key]=handoff?(key===pauses[1]?'1':undefined):ann(original)[key];changes[owner]=handoff?c.runId:undefined;changes[step]=handoff?'handoff':undefined;
    await patch(current.controller,changes,true);const end=io.now()+30000;
    for(let n=0;n<31;n++){
     check(true);if(io.now()>=end)deny();const s=await inspect.inspectCurrent(true),a=ann(s.controller);
     if(!same(s.controller.spec,original.spec)||Object.entries(changes).some(([k,v])=>a[k]!==v))deny();
     const full=changes[pauses[1]]!==undefined;
     if(s.cohort?.desired===1&&s.cohort.ready===1&&(full?s.hpa===null:s.hpa!==null)){
      finishResult={state:handoff?'owned_paused_one_handoff':'restored',originalStateRestored:!handoff,pausedOneHandoff:handoff,resume:resumed,finalReplicas:1,notZeroNodesOrDeploymentProof:true,retryAllowed:false};return clone(finishResult);
     }await io.sleep(1000,true);
    }deny();
   }catch{return {...finishResult,manualRecoveryMayBeRequired:true,fault:clone(resumeProof??null)};}
  },
 };
}
