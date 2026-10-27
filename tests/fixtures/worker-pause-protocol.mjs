// Complete fault protocol boundary. The exact remote agent runs inside the
// owned VM fixture; Kubernetes, admission, scheduling and API persistence are
// synthetic. No actual signal, process forwarding, cloud or provider.
import {autoscaleBoundary} from './cloud-autoscale-protocol.mjs';
import {pauseProgramVM} from './worker-pause-program-vm.mjs';
import {workerPauseInitProgram} from '../../scripts/worker-pause-init.mjs';
import {workerPauseTarget} from '../../scripts/worker-pause-target.mjs';
import {benchmarkTargetHash} from '../../scripts/cloud-benchmark-target.mjs';
export {token} from './cloud-benchmark-protocol.mjs';
export function workerPauseBoundary(options={}){
 let threeWorkers=[];const b=autoscaleBoundary({...options,mutateJob:(j,row,f)=>{j.worker_id=threeWorkers[(row.index-1)%threeWorkers.length]??j.worker_id;options.mutateJob?.(j,row,f);}}),vm=pauseProgramVM({unknownCONT:options.unknownCONT});
 const {allowControlledBacklog,...rest}=b.c,c={...rest,allowWorkerPauseReplay:true,fault:{acknowledgement:'I_AUTHORIZE_THIS_ISOLATED_WORKER_CHILD_STOP_WITH_BOUNDED_AGENT_RESUME',mainSHA256:vm.config.mainSHA256}};b.c=c;
 const pod=b.f.state.worker.spec.template.spec,a=pod.containers[0];Object.assign(pod,{automountServiceAccountToken:false,securityContext:{runAsNonRoot:true,runAsUser:1000,runAsGroup:1000,fsGroup:1000},volumes:[{name:'worker-fault-journal',emptyDir:{medium:'Memory',sizeLimit:'1Mi'}}]});
 Object.assign(a,{command:['/usr/local/bin/node','-e',workerPauseInitProgram],env:[{name:'SERVICE_ROLE',value:'worker'},{name:'RG_TRIAL_POD_UID',valueFrom:{fieldRef:{apiVersion:'v1',fieldPath:'metadata.uid'}}}],securityContext:{readOnlyRootFilesystem:true,allowPrivilegeEscalation:false,capabilities:{drop:['ALL']}},volumeMounts:[{name:'worker-fault-journal',mountPath:'/run/releaseguard-fault'}]});
 b.f.state.pods.items=[];b.reconcile();vm.state.podUID=b.f.state.pods.items[0].metadata.uid;vm.init.process.env.RG_TRIAL_POD_UID=vm.state.podUID;
 c.target.workerSpecSHA256=benchmarkTargetHash('worker',b.f.state.worker.spec);
 let faultEntered=false,reads=0,upGroup=null,unknownUsed=false,interferenceUsed=false;const remote=[];
 const syncClock=async()=>{const delta=b.f.io.now()-vm.now();if(delta>0)await vm.advance(delta);};
 const originalSleep=b.io.sleep;b.io.sleep=async ms=>{await originalSleep(ms);await syncClock();};
 function reconcile(){
  b.reconcile();
  if(vm.state.workerState==='T'){
   const selected=b.f.state.pods.items.find(p=>p.metadata.uid===vm.state.podUID);if(selected){selected.status.conditions=[{type:'Ready',status:'False'}];selected.status.containerStatuses[0].ready=false;
    b.f.state.worker.status.readyReplicas=Math.max(0,b.f.state.worker.spec.replicas-1);b.f.state.worker.status.availableReplicas=Math.max(0,b.f.state.worker.spec.replicas-1);}
  }else for(const p of b.f.state.pods.items){p.status.conditions=[{type:'Ready',status:'True'}];p.status.containerStatuses[0].ready=true;}
 }
 const read=async(kind,clean)=>{
  if(kind==='worker'&&faultEntered&&!clean){await syncClock();const group=Math.floor(reads++/2);
   if(options.externalResume&&!interferenceUsed){interferenceUsed=true;vm.state.workerState='S';await vm.advance(100);}
   const wanted=options.noScale?1:upGroup!==null&&group>upGroup?1:options.onlyFive?5:3;b.f.state.worker.spec.replicas=wanted;b.f.state.worker.metadata.resourceVersion=String(Number(b.f.state.worker.metadata.resourceVersion)+1);reconcile();
   if(wanted===3&&vm.state.workerState!=='T'){upGroup??=group;threeWorkers=b.f.state.pods.items.map(p=>p.metadata.name);}
  }else reconcile();
  if(options.foreignHPA&&kind==='hpas'){const v=structuredClone(b.f.state.hpas);if(v.items[0])v.items[0].metadata.ownerReferences[0].uid='foreign';return v;}
  if(options.externalReplica&&clean&&kind==='worker'&&faultEntered){b.f.state.worker.spec.replicas=2;reconcile();}
  b.f.events.push({type:'read',kind,cleanup:clean});return structuredClone(b.f.state[kind]);
 };
 const patch=async(kind,ops,clean)=>{b.f.events.push({type:'patch',kind,ops:structuredClone(ops),cleanup:clean});if(options.cleanupFailure&&clean)throw Error('Synthetic cleanup failure');b.f.apply(kind,ops);reconcile();return structuredClone(b.f.state[kind]);};
 const exec=async(kind,selection,packet,clean)=>{
  remote.push({kind,selection:structuredClone(selection),packet:structuredClone(packet),cleanup:clean});await syncClock();
  if(options.foreignPod&&kind==='fault-start')vm.state.podUID='foreign-reused-pod';
  if(options.unknownStartBefore&&kind==='fault-start'&&!unknownUsed){unknownUsed=true;throw Error('Synthetic unknown before start');}
  const r=await vm.run(packet);if(packet.mode==='start'&&vm.signals.some(s=>s.signal==='SIGSTOP'))faultEntered=true;
  if(options.agentDeath&&kind==='fault-start')vm.killAgent();
  if(options.unknownStartAfter&&kind==='fault-start'&&!unknownUsed){unknownUsed=true;throw Error('Synthetic unknown after start');}
  if(r.exitCode!==0||r.output.length!==1)throw Error('Synthetic helper command refused or unknown');return r.output[0];
 };
 const targetIO={now:b.f.io.now,wallNow:b.io.wallNow,remaining:b.io.remaining,sleep:b.io.sleep,read,patch,exec};
 b.io.target=async()=>workerPauseTarget({...c.target,runId:c.runId,namespace:c.cloud.namespace,imageDigest:c.image.split('@')[1],mainSHA256:c.fault.mainSHA256},targetIO);
 reconcile();return {...b,c,vm,remote,targetIO,nativeRead:read,nativePatch:patch,nativeExec:exec,syncClock,reconcile,get threeWorkers(){return [...threeWorkers];}};
}
