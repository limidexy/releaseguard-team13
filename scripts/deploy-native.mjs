// Closed argv for this inactive deploy consumer. No arbitrary command, shell,
// cluster, namespace, HPA, KEDA, Secret, PVC, database or node mutation.
// Each invocation is attempted once by us. Client-internal transport behavior
// and real API-server defaulting/SSA compatibility remain separately unverified.
import {isAbsolute,basename} from 'node:path';
import {isDeepStrictEqual as same} from 'node:util';
import {deploymentObjectRef as reference,deploymentFieldManager as manager} from './deploy-object-core.mjs';
import {evidenceCommand} from './gcp-evidence-core.mjs';
const deny=()=>{throw Error('Deployment native command refused');};
export function deployCommand(c,kind,{ref,document,plan,snapshot,file}={}){
 const x=c.cloud,k=args=>({command:x.kubectlExecutable,args:['--kubeconfig='+x.kubeconfigFile,'--context='+x.context,'--request-timeout=20s','-n',x.namespace,...args]});
 if(['cluster','namespace'].includes(kind))return evidenceCommand(x,kind);
 const selected=reference((ref??plan?.before?.ref??snapshot?.ref??document)?.kind,(ref??plan?.before?.ref??snapshot?.ref)?.name??document?.metadata?.name);
 if(ref&&!same(selected,ref))deny();
 if(kind==='get')return k(['get',selected.kind,selected.name,'--ignore-not-found=true','--show-managed-fields=true','-o','json']);
 if(['patch','previewPatch'].includes(kind)){
  if(!plan||!Array.isArray(plan.patch)||typeof file!=='string'||!isAbsolute(file)||!/^request-\d{6}\.json$/.test(basename(file))&&!/^cleanup-request-\d{6}\.json$/.test(basename(file)))deny();
  return k(['patch',selected.kind,selected.name,'--type=json','--patch-file='+file,'--field-manager='+manager,...(kind==='previewPatch'?['--dry-run=server']:[]),'--show-managed-fields=true','-o','json']);
 }
 if(['previewApply','previewCreate','create'].includes(kind)){
  if(!document||document.metadata?.namespace!==selected.namespace||kind!=='previewApply'&&selected.kind==='Deployment')deny();
  return {...k([kind==='previewApply'?'apply':'create',...(kind==='previewApply'?['--server-side']:[]),'--field-manager='+manager,...(kind!=='create'?['--dry-run=server']:[]),'--validate=strict','--show-managed-fields=true','-f','-','-o','json']),input:Buffer.from(JSON.stringify(document))};
 }
 if(kind==='deleteCreated'){
  if(selected.kind==='Deployment'||typeof snapshot.uid!=='string'||typeof snapshot.resourceVersion!=='string')deny();
  const resource=selected.kind==='Service'?'services':'configmaps',path='/api/v1/namespaces/releaseguard/'+resource+'/'+selected.name;
  return {...k(['delete','--raw='+path,'-f','-']),input:Buffer.from(JSON.stringify({apiVersion:'v1',kind:'DeleteOptions',preconditions:{uid:snapshot.uid,resourceVersion:snapshot.resourceVersion},propagationPolicy:'Background'}))};
 }
 deny();
}
