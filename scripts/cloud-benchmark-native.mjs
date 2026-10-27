// Closed native command plan and read-only GKE identity/topology proof.
// No IO or credentials on import; command execution belongs to the private CLI.
import {isDeepStrictEqual as same} from 'node:util';
import {evidenceCommand} from './gcp-evidence-core.mjs';
import {sha256} from './comparison-files.mjs';
const deny=()=>{throw Error('Paired native target unconfirmed');};
export function benchmarkCommand(c,kind,patchFile){
 const cloud=c.cloud,k=args=>({command:cloud.kubectlExecutable,args:['--kubeconfig='+cloud.kubeconfigFile,'--context='+cloud.context,'--request-timeout=15s','-n',cloud.namespace,...args]});
 if(['cluster','namespace','nodes'].includes(kind))return evidenceCommand(cloud,kind);
 const reads={worker:['deployment',c.target.workerName],controller:['scaledobject.keda.sh',c.target.controllerName],hpas:['hpa'],pods:['pods','-l','app=worker'],replicaSets:['replicasets','-l','app=worker']};
 if(Object.hasOwn(reads,kind)&&patchFile===undefined)return k(['get',...reads[kind],'-o','json']);
 if(['patch-worker','patch-controller'].includes(kind)&&typeof patchFile==='string'&&/^\/.+\/(?:cleanup-)?kube-patch-\d{6}\.json$/.test(patchFile)&&!/[\x00-\x1f\x7f]/.test(patchFile))
  return k(['patch',...(kind==='patch-worker'?reads.worker:reads.controller),'--type=json','--patch-file='+patchFile,'-o','json']);
 deny();
}
export function confirmBenchmarkCloud(c,kube,observations){
 const {cluster,namespace,nodes}=observations,x=c.cloud;
 if(cluster?.name!==x.cluster||cluster.id!==x.clusterId||cluster.location!==x.zone||cluster.status!=='RUNNING'||
  !['zones','locations'].some(p=>cluster.selfLink==='https://container.googleapis.com/v1/projects/'+x.project+'/'+p+'/'+x.zone+'/clusters/'+x.cluster)||
  kube.server!=='https://'+cluster.endpoint||sha256(Buffer.from(cluster.masterAuth?.clusterCaCertificate??'','base64'))!==kube.caSHA256||
  !Array.isArray(cluster.nodePools)||cluster.nodePools.length!==1||cluster.nodePools.some(p=>p.status!=='RUNNING'||p.config?.machineType!=='e2-standard-2'||p.autoscaling?.enabled===true))deny();
 if(namespace?.apiVersion!=='v1'||namespace.kind!=='Namespace'||namespace.metadata?.name!==x.namespace||namespace.metadata.uid!==x.namespaceUid||namespace.metadata.deletionTimestamp)deny();
 if(nodes?.apiVersion!=='v1'||nodes.kind!=='NodeList'||!Array.isArray(nodes.items)||nodes.items.length!==2||nodes.metadata?.continue||!nodes.metadata?.resourceVersion||
  !same(nodes.items.map(n=>n.metadata?.name).sort(),[...c.target.nodeNames].sort())||nodes.items.some(n=>n.metadata?.deletionTimestamp||n.spec?.unschedulable||
   typeof n.spec?.providerID!=='string'||!n.spec.providerID.startsWith('gce://'+x.project+'/'+x.zone+'/')||!n.status?.conditions?.some(c=>c.type==='Ready'&&c.status==='True')))deny();
 return {clusterId:x.clusterId,namespaceUid:x.namespaceUid,nodeNames:[...c.target.nodeNames],twoNodeObservationOnly:true,notCapacityOrCostAttestation:true};
}
