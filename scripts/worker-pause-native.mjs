// Closed fault-tool command surface. No process, credential or IO on import.
import {autoscaleCommand} from './cloud-autoscale-native.mjs';
import {workerPauseProgram} from './worker-pause-program.mjs';
import {workerPauseInitSHA256} from './worker-pause-init.mjs';
export {confirmAutoscaleCloud as confirmWorkerPauseCloud} from './cloud-autoscale-native.mjs';
const deny=()=>{throw Error('Worker fault command refused');};
export function workerPauseCommand(c,kind,patchFile,selected){
 if(['cluster','namespace','nodes','worker','controller','hpas','pods','replicaSets','patch-controller'].includes(kind)&&selected===undefined)return autoscaleCommand(c,kind,patchFile);
 const modes={'fault-inspect':'inspect','fault-start':'start','fault-status':'status','fault-request-resume':'request-resume'};
 if(!Object.hasOwn(modes,kind)||patchFile!==undefined||!selected?.pod||!selected.packet)deny();const {pod,packet}=selected;
 if(!/^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/.test(pod.name??'')||!/^[-A-Za-z0-9]{1,100}$/.test(pod.uid??'')||packet.podUID!==pod.uid||packet.runId!==c.runId||packet.mode!==modes[kind]||
  packet.mainSHA256!==c.fault.mainSHA256||packet.launcherSHA256!==workerPauseInitSHA256||packet.pauseMs!==17000||Object.keys(packet).sort().join(',')!=='launcherSHA256,mainSHA256,mode,notAfterEpochMs,pauseMs,pidNamespace,pidStartTicks,podUID,runId,workerPID'||
  (packet.mode==='inspect'?packet.workerPID!==null:!Number.isInteger(packet.workerPID)||packet.workerPID<=1))deny();
 const x=c.cloud;return {command:x.kubectlExecutable,args:['--kubeconfig='+x.kubeconfigFile,'--context='+x.context,'--request-timeout=15s','-n',x.namespace,'exec',pod.name,'-c','worker','--','/usr/local/bin/node','-e',workerPauseProgram,JSON.stringify(packet)]};
}
