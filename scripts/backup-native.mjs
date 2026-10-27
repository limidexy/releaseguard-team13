// Closed kube/SQL command plan. No shell code/configuration is caller-supplied.
// Kubernetes exec cannot CAS a Pod UID. The separate PostgreSQL system/start/
// database-OID guards protect each command; privileged concurrent DDL remains
// an explicit limitation, not an atomic ownership guarantee.
import {evidenceCommand} from './gcp-evidence-core.mjs';
import {sha256} from './comparison-files.mjs';
import {backupSQL,backupRemoteProgram,backupDatabases} from './backup-sql.mjs';
const deny=()=>{throw Error('Backup native target refused');};
export function backupCommand(c,kind,row,extra={}){
 const x=c.cloud,k=args=>({command:x.kubectlExecutable,args:['--kubeconfig='+x.kubeconfigFile,'--context='+x.context,'--request-timeout=120s','-n',x.namespace,...args]});
 if(['cluster','namespace'].includes(kind)&&row===undefined&&Object.keys(extra).length===0)return evidenceCommand(x,kind);
 if(kind==='pod'&&row===undefined&&Object.keys(extra).length===0)return k(['get','pod',c.target.podName,'-o','json']);
 if(!['identity','dump','source-tables','source-table','create','owned','restore','restored-tables','restored-table','drop'].includes(kind)||kind!=='identity'&&!backupDatabases.includes(row?.database))deny();
 if(Object.keys(extra).some(k=>!['scratchOID','table','input','dumpSHA256'].includes(k))||kind!=='restore'&&Object.hasOwn(extra,'input'))deny();
 const sql=backupSQL(c,kind,row?.database,extra.scratchOID,extra.table);
 if(kind==='restore'&&(!Buffer.isBuffer(extra.input)||extra.input.length>64*1024*1024||sha256(extra.input)!==extra.dumpSHA256))deny();
 const p=k(['exec',...(kind==='restore'?['-i']:[]),c.target.podName,'-c',c.target.containerName,'--','env','-i','PATH=/usr/local/bin:/usr/bin:/bin','HOME=/nonexistent','PGPASSFILE=/dev/null',
  'PGAPPNAME=releaseguard-backup-'+c.runId,'PGOPTIONS=-c timezone=UTC -c search_path=pg_catalog -c statement_timeout=110000 -c lock_timeout=10000',
  '/bin/sh','-eu','-c',backupRemoteProgram,'rg-backup',sql.database,sql.mode,sql.guard,sql.sql]);return {...p,...(kind==='restore'?{input:extra.input}:{})};
}
export function confirmBackupCloud(c,kube,{cluster,namespace}){
 const x=c.cloud;if(cluster?.name!==x.cluster||cluster.id!==x.clusterId||cluster.location!==x.zone||cluster.status!=='RUNNING'||
  !['zones','locations'].some(p=>cluster.selfLink==='https://container.googleapis.com/v1/projects/'+x.project+'/'+p+'/'+x.zone+'/clusters/'+x.cluster)||kube.server!=='https://'+cluster.endpoint||
  sha256(Buffer.from(cluster.masterAuth?.clusterCaCertificate??'','base64'))!==kube.caSHA256||namespace?.apiVersion!=='v1'||namespace.kind!=='Namespace'||namespace.metadata?.name!==x.namespace||namespace.metadata.uid!==x.namespaceUid||namespace.metadata.deletionTimestamp)deny();
 return {clusterId:x.clusterId,namespaceUID:x.namespaceUid,kubeCAsha256:kube.caSHA256,notFreeOrDeploymentAttestation:true};
}
export function confirmBackupPod(c,p){
 const t=c.target,v=p?.spec?.containers,s=p?.status?.containerStatuses;
 if(p?.apiVersion!=='v1'||p.kind!=='Pod'||p.metadata?.name!==t.podName||p.metadata.uid!==t.podUID||p.metadata.namespace!==c.cloud.namespace||p.metadata.deletionTimestamp||p.spec?.nodeName!==t.nodeName||
  !Array.isArray(v)||v.length!==1||v[0].name!==t.containerName||!Array.isArray(s)||s.length!==1||s[0].name!==t.containerName||s[0].containerID!==t.containerID||s[0].imageID?.match(/sha256:[a-f0-9]{64}$/)?.[0]!==t.imageDigest||
  !s[0].ready||!s[0].state?.running||!p.status?.conditions?.some(x=>x.type==='Ready'&&x.status==='True')||p.spec.hostPID===true)deny();
 return {podUID:t.podUID,containerID:t.containerID,imageDigest:t.imageDigest,nodeName:t.nodeName};
}
