// Owned in-memory API boundary only; no Kubernetes/defaulting fidelity claim.
import assert from 'node:assert/strict';
import {runId,objectFixture,atomicObjectAPI} from './deploy-object-api.mjs';
import {deployRefs} from '../../scripts/deploy-core.mjs';
import {deploymentFieldManager as manager} from '../../scripts/deploy-object-core.mjs';
export function deployFixture(options={}){
 const c={allowDeployment:true,isolatedAdminWindow:true,runId,deadlineMs:900000,sourceCommit:'b'.repeat(40),image:'registry.example.invalid/rg@sha256:'+'b'.repeat(64),proveRollback:false,
  cloud:{project:'synthetic-rg',zone:'asia-southeast1-a',cluster:'test-cluster',clusterId:'synthetic-cluster-id',namespace:'releaseguard',namespaceUid:'synthetic-namespace-uid',context:'gke_synthetic-rg_asia-southeast1-a_test-cluster',account:'synthetic@example.invalid',gcloudExecutable:'/synthetic/bin/gcloud',kubectlExecutable:'/synthetic/bin/kubectl',pluginExecutable:'/synthetic/bin/gke-gcloud-auth-plugin',gcloudConfigDirectory:'/synthetic/cloud-config',kubeconfigFile:'/synthetic/input/kube.json'},
  render:{origin:'https://releaseguard.example.test',issuer:'https://issuer.example.test/realms/rg',jwks:'https://issuer.example.test/realms/rg/certs',clockSkewBoundMs:100,internalCA:false,trialSmall:true,environment:'gcp-trial'},allowedOrigins:['https://releaseguard.example.test'],authFile:'/synthetic/input/auth.json'};
 const key=r=>r.kind+'/'+r.name,api=new Map(),initial=new Map(),events=[],files=new Map(),controller=new AbortController(),cleanup=new AbortController();let now=0,owned=false,smokes=0,created=0;
 function ready(d){if(d.kind==='Deployment')d.status={observedGeneration:d.metadata.generation,replicas:d.spec.replicas,readyReplicas:d.spec.replicas,availableReplicas:d.spec.replicas,updatedReplicas:d.spec.replicas};return d;}
 for(const r of deployRefs){const d=ready(objectFixture(r.kind,r.name));if(options.missing?.includes(key(r)))continue;api.set(key(r),atomicObjectAPI(d));initial.set(key(r),structuredClone(d));}
 const desired=deployRefs.map(r=>{const d=objectFixture(r.kind,r.name);delete d.status;d.metadata={name:r.name,namespace:r.namespace,labels:{team:'candidate'}};if(r.kind==='Deployment'){d.spec.template.spec.containers[0].image=c.image;d.spec.template.spec.containers[0].env=[{name:'SYNTHETIC_SETTING',value:'candidate'}];}if(r.kind==='ConfigMap')d.data={AUTH_MODE:'oidc',SYNTHETIC_SETTING:'candidate'};return d;});
 const event=async(kind,arg,fn)=>{events.push({kind,arg:structuredClone(arg)});await options.before?.(kind,arg,{api,events,controller,cleanup,advance:ms=>now+=ms});const result=await fn();await options.after?.(kind,arg,result,{api,events,controller,cleanup,advance:ms=>now+=ms});return result;};
 const createDoc=doc=>{const d=structuredClone(doc);d.metadata={...d.metadata,uid:'synthetic-created-'+(++created),resourceVersion:'created:'+created,generation:1,managedFields:[{manager,operation:'Update',apiVersion:d.apiVersion,fieldsType:'FieldsV1',fieldsV1:{'f:metadata':{},['f:'+(d.kind==='ConfigMap'?'data':'spec')]:{}}}]};return d;};
 const io={signal:controller.signal,cleanupSignal:cleanup.signal,now:()=>now,get owned(){return owned;},async reserve(){if(owned)throw Error('duplicate run');owned=true;files.set('started.json',{runId});},async json(n,v){if(files.has(n))throw Error('overwrite');files.set(n,structuredClone(v));},async verifyRuntime(){},
  preflight:()=>event('preflight',{},()=>({synthetic:true})),render:()=>event('render',{},()=>structuredClone(desired)),
  get:r=>event('get',r,()=>api.has(key(r))?ready(api.get(key(r)).read()):null),
  previewPatch:p=>event('previewPatch',p,()=>api.get(key(p.before.ref)).preview(p.patch)),patch:p=>event('patch',p,()=>api.get(key(p.before.ref)).patch(p.patch)),
  previewApply:d=>event('previewApply',d,()=>{const old=api.get(d.kind+'/'+d.metadata.name).read(),result=structuredClone(old);result.metadata.labels={...old.metadata.labels,...d.metadata.labels};result.metadata.annotations={...old.metadata.annotations,...d.metadata.annotations};if(d.kind==='ConfigMap'){result.data=structuredClone(d.data);result.binaryData=d.binaryData;result.immutable=d.immutable;}else result.spec=structuredClone(d.spec);return result;}),
  previewCreate:d=>event('previewCreate',d,()=>createDoc(d)),create:d=>event('create',d,()=>{const k=d.kind+'/'+d.metadata.name;assert.ok(!api.has(k));const v=createDoc(d);api.set(k,atomicObjectAPI(v));return v;}),
  deleteCreated:s=>event('delete',s,()=>{const a=api.get(key(s.ref)),v=a.read();assert.equal(v.metadata.uid,s.uid);assert.equal(v.metadata.resourceVersion,s.resourceVersion);api.delete(key(s.ref));return {apiVersion:'v1',kind:'Status',status:'Success'};}),
  smoke:(label,selected)=>event('smoke',{label,selected},()=>{smokes++;return {passed:!options.failSmoke?.includes(label),source:'replay',modelCallsRequested:0,commit:selected.source,image:selected.image,independentReviewOrDeployment:false,created:{jobId:'synthetic-job-'+smokes}};}),
  async sleep(ms){now+=ms;},
 };
 return {c,io,api,initial,desired,events,files,controller,cleanup};
}
