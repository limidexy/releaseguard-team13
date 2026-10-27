// Inactive per-object prerequisite for the future six-service deploy consumer.
// Pure JSON plans only: no environment, credentials, filesystem or native IO.
// Hashes detect accidental receipt changes; they are not signatures, identity
// or deployment authorization. The caller must persist intent, validate its
// selected cluster/namespace and desired server dry-run, and never retry an
// unknown mutation. This module does not make a multi-object transaction.
// Snapshots require unstripped managedFields. Successful response verification
// requires the selected server's exact JSON-patch dry-run bound to this plan.
// Writable configuration is restored; server field-management history is not.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as same} from 'node:util';

export const deploymentRoles=Object.freeze(['registry','evaluation','governance','support','worker','gateway']);
export const deploymentOwnerAnnotation='releaseguard.io/deployment-run';
export const deploymentFieldManager='releaseguard-owned-deploy';
const deny=()=>{throw Error('Deployment object transition refused');};
const clone=x=>structuredClone(x);
const plain=x=>x!==null&&typeof x==='object'&&Object.getPrototypeOf(x)===Object.prototype;
const exact=(x,keys)=>{if(!plain(x)||!same(Object.keys(x).sort(),[...keys].sort()))deny();};
const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':plain(x)?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
const hash=x=>createHash('sha256').update(canonical(x)).digest('hex');
const run=x=>{if(typeof x!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(x))deny();return x;};
function json(x,limit=1024*1024){
 let count=0;
 function visit(v,depth){
  if(depth>32||++count>100000)deny();
  if(v===null||typeof v==='boolean'||typeof v==='string')return;
  if(typeof v==='number'){if(!Number.isFinite(v))deny();return;}
  if(!Array.isArray(v)&&!plain(v))deny();
  const descriptors=Object.getOwnPropertyDescriptors(v),keys=Object.keys(v);
  if(Reflect.ownKeys(v).some(k=>typeof k!=='string')||Array.isArray(v)&&(keys.length!==v.length||keys.some((k,i)=>k!==String(i))||Reflect.ownKeys(v).length!==keys.length+1))deny();
  for(const k of keys){if(['__proto__','constructor','prototype'].includes(k)||!descriptors[k].enumerable||!Object.hasOwn(descriptors[k],'value'))deny();visit(descriptors[k].value,depth+1);}
  if(!Array.isArray(v)&&Reflect.ownKeys(v).length!==keys.length)deny();
 }
 visit(x,0);if(Buffer.byteLength(canonical(x))>limit)deny();return clone(x);
}
function ref(value){
 exact(value,['apiVersion','kind','namespace','name']);
 if(value.namespace!=='releaseguard'||!(['Deployment','Service'].includes(value.kind)?deploymentRoles.includes(value.name):value.kind==='ConfigMap'&&value.name==='rg-config')||value.apiVersion!==(value.kind==='Deployment'?'apps/v1':'v1'))deny();
 return clone(value);
}
export const deploymentObjectRef=(kind,name)=>ref({apiVersion:kind==='Deployment'?'apps/v1':'v1',kind,name,namespace:'releaseguard'});
const fieldPaths={labels:'/metadata/labels',annotations:'/metadata/annotations',spec:'/spec',data:'/data',binaryData:'/binaryData',immutable:'/immutable'};
const fieldNames=r=>['labels','annotations',...(r.kind==='ConfigMap'?['data','binaryData','immutable']:['spec'])];
const slot=(x,k)=>Object.hasOwn(x,k)?{exists:true,value:clone(x[k])}:{exists:false};
function strings(x){if(!plain(x)||Object.values(x).some(v=>typeof v!=='string'))deny();}
function fields(value,r){
 exact(value,fieldNames(r));
 for(const [key,s]of Object.entries(value)){
  if(!plain(s)||typeof s.exists!=='boolean')deny();exact(s,s.exists?['exists','value']:['exists']);
  if(!s.exists)continue;
  if(['labels','annotations','data','binaryData'].includes(key))strings(s.value);
  if(key==='immutable'&&typeof s.value!=='boolean')deny();
  if(key==='spec'&&!plain(s.value))deny();
 }
 if(r.kind!=='ConfigMap'&&!value.spec.exists)deny();
 return clone(value);
}
const owner=f=>f.annotations.exists?f.annotations.value[deploymentOwnerAnnotation]:undefined;
function context(value){exact(value,['ownerReferences','finalizers','managedFields']);for(const s of Object.values(value)){if(!plain(s)||typeof s.exists!=='boolean')deny();exact(s,s.exists?['exists','value']:['exists']);if(s.exists&&!Array.isArray(s.value))deny();}if(!value.managedFields.exists||value.managedFields.value.some(e=>!plain(e)))deny();return clone(value);}
// Preserve raw managedFields in each snapshot and conditional patch test. For
// comparisons, timestamps are not ownership. Only an entry whose entire field
// set is status is excluded; a status-labelled spec/metadata claim is retained.
function ownership(c){
 const entries=c.managedFields.value.map(e=>{if(!plain(e))deny();const x=clone(e);delete x.time;return x;}).filter(e=>!(e.subresource==='status'&&e.fieldsType==='FieldsV1'&&plain(e.fieldsV1)&&Object.keys(e.fieldsV1).every(k=>k==='f:status')));
 entries.sort((a,b)=>canonical(a)<canonical(b)?-1:canonical(a)>canonical(b)?1:0);return {ownerReferences:c.ownerReferences,finalizers:c.finalizers,managedFields:entries};
}
const sameOwnership=(a,b)=>same(ownership(a),ownership(b));
const sameFixedContext=(a,b)=>same(a.ownerReferences,b.ownerReferences)&&same(a.finalizers,b.finalizers);
function snapshot(value){
 const x=json(value,2*1024*1024);exact(x,['formatVersion','ref','uid','resourceVersion','fields','context','observationSHA256','checksum']);
 if(x.formatVersion!==1||typeof x.uid!=='string'||!/^[-A-Za-z0-9]{1,128}$/.test(x.uid)||typeof x.resourceVersion!=='string'||!x.resourceVersion||x.resourceVersion.length>256||/[\x00-\x20\x7f]/.test(x.resourceVersion)||!/^[a-f0-9]{64}$/.test(x.observationSHA256))deny();
 ref(x.ref);fields(x.fields,x.ref);context(x.context);const {checksum,...body}=x;if(checksum!==hash(body))deny();return x;
}
export function captureDeploymentObject(reference,document){
 const r=ref(json(reference)),d=json(document),m=d.metadata;
 if(d.apiVersion!==r.apiVersion||d.kind!==r.kind||!plain(m)||m.name!==r.name||m.namespace!==r.namespace||m.deletionTimestamp!=null||Object.hasOwn(m,'deletionGracePeriodSeconds'))deny();
 if(r.kind==='ConfigMap'&&Object.hasOwn(d,'spec')||r.kind!=='ConfigMap'&&['data','binaryData','immutable'].some(k=>Object.hasOwn(d,k)))deny();
 const f={labels:slot(m,'labels'),annotations:slot(m,'annotations')};for(const key of fieldNames(r).slice(2))f[key]=slot(d,key);
 const body={formatVersion:1,ref:r,uid:m.uid,resourceVersion:m.resourceVersion,fields:f,context:{ownerReferences:slot(m,'ownerReferences'),finalizers:slot(m,'finalizers'),managedFields:slot(m,'managedFields')},observationSHA256:hash(d)};
 return snapshot({...body,checksum:hash(body)});
}
function immutable(before,target){
 const r=before.ref,a=before.fields,b=target;
 if(r.kind==='Deployment'&&!same(a.spec.value.selector,b.spec.value.selector))deny();
 if(r.kind==='Service'){
  if(a.spec.value.type!=='ClusterIP'||b.spec.value.type!=='ClusterIP')deny();
  for(const key of ['clusterIP','clusterIPs','ipFamilies','ipFamilyPolicy'])if(!same(slot(a.spec.value,key),slot(b.spec.value,key)))deny();
 }
 if(r.kind==='ConfigMap'){
  if(b.immutable.exists&&b.immutable.value===true&&!(a.immutable.exists&&a.immutable.value===true))deny();
  if(a.immutable.exists&&a.immutable.value===true&&['immutable','data','binaryData'].some(k=>!same(a[k],b[k])))deny();
 }
}
function makePlan(operation,input,target,runId){
 run(runId);const before=snapshot(input),after=fields(json(target,2*1024*1024),before.ref);immutable(before,after);
 if(!['claim','update','restore','release'].includes(operation))deny();
 if(operation==='claim'){
  if(before.fields.annotations.exists&&Object.hasOwn(before.fields.annotations.value,deploymentOwnerAnnotation)||owner(after)!==runId)deny();
  const claimed=clone(before.fields);claimed.annotations={exists:true,value:{...(claimed.annotations.exists?claimed.annotations.value:{}),[deploymentOwnerAnnotation]:runId}};if(!same(claimed,after))deny();
 }else if(owner(before.fields)!==runId||operation==='update'&&owner(after)!==runId||['restore','release'].includes(operation)&&after.annotations.exists&&Object.hasOwn(after.annotations.value,deploymentOwnerAnnotation))deny();
 if(operation==='release'){
  const released=clone(before.fields);delete released.annotations.value[deploymentOwnerAnnotation];if(Object.keys(released.annotations.value).length===0)released.annotations={exists:false};if(!same(released,after))deny();
 }
 if(same(before.fields,after))return null;
 const patch=[{op:'test',path:'/metadata/uid',value:before.uid},{op:'test',path:'/metadata/resourceVersion',value:before.resourceVersion}];
 for(const [key,s]of Object.entries(before.fields))if(s.exists)patch.push({op:'test',path:fieldPaths[key],value:clone(s.value)});
 for(const [key,s]of Object.entries(before.context))if(s.exists)patch.push({op:'test',path:'/metadata/'+key,value:clone(s.value)});
 for(const key of fieldNames(before.ref)){const a=before.fields[key],b=after[key];if(same(a,b))continue;patch.push(b.exists?{op:a.exists?'replace':'add',path:fieldPaths[key],value:clone(b.value)}:{op:'remove',path:fieldPaths[key]});}
 const body={formatVersion:1,operation,runId,before,afterFields:after,patch};return {...body,checksum:hash(body)};
}
export function planDeploymentClaim(input,runId){
 const s=snapshot(input);run(runId);if(s.fields.annotations.exists&&Object.hasOwn(s.fields.annotations.value,deploymentOwnerAnnotation))deny();
 const after=clone(s.fields);after.annotations={exists:true,value:{...(after.annotations.exists?after.annotations.value:{}),[deploymentOwnerAnnotation]:runId}};
 return makePlan('claim',s,after,runId);
}
export function planDeploymentUpdate(input,desiredServerDryRun,runId){
 const s=snapshot(input),d=captureDeploymentObject(s.ref,desiredServerDryRun);run(runId);
 if(s.uid!==d.uid||s.resourceVersion!==d.resourceVersion||owner(s.fields)!==runId||owner(d.fields)!==runId||!sameFixedContext(s.context,d.context))deny();
 return makePlan('update',s,d.fields,runId);
}
function selectedOwned(last,latest,runId){
 const a=snapshot(last),b=snapshot(latest);run(runId);
 if(!same(a.ref,b.ref)||a.uid!==b.uid||owner(a.fields)!==runId||owner(b.fields)!==runId||!same(a.fields,b.fields)||!sameOwnership(a.context,b.context))deny();
 return b;
}
export function planDeploymentRestore(baseline,last,latest,runId){
 const original=snapshot(baseline),current=selectedOwned(last,latest,runId);
 if(!same(original.ref,current.ref)||original.uid!==current.uid||!sameFixedContext(original.context,current.context)||original.fields.annotations.exists&&Object.hasOwn(original.fields.annotations.value,deploymentOwnerAnnotation))deny();
 return makePlan('restore',current,original.fields,runId);
}
export function planDeploymentRelease(last,latest,runId){
 const current=selectedOwned(last,latest,runId),after=clone(current.fields);delete after.annotations.value[deploymentOwnerAnnotation];if(Object.keys(after.annotations.value).length===0)after.annotations={exists:false};
 return makePlan('release',current,after,runId);
}
function verifiedPreview(plan,serverDryRun){
 const p=json(plan,8*1024*1024);exact(p,['formatVersion','operation','runId','before','afterFields','patch','checksum']);
 if(p.formatVersion!==1||!['claim','update','restore','release'].includes(p.operation))deny();
 const rebuilt=makePlan(p.operation,p.before,p.afterFields,p.runId);if(!rebuilt||!same(rebuilt,p))deny();
 // The exact conditional JSON patch must be previewed by the selected server.
 // Its managed-field ownership effects cannot be guessed locally or treated as
 // identical to SSA. The caller retains both raw preview and real response.
 const preview=json(serverDryRun,2*1024*1024);exact(preview,['planChecksum','observation']);if(preview.planChecksum!==p.checksum)deny();
 const expected=captureDeploymentObject(p.before.ref,preview.observation);
 if(expected.uid!==p.before.uid||expected.resourceVersion!==p.before.resourceVersion||!sameFixedContext(expected.context,p.before.context)||!same(expected.fields,p.afterFields))deny();
 return {plan:p,expected};
}
// Validate the real preview before mutation without inventing any response or
// changing a raw server observation. This alone is not an executed change.
export function verifyDeploymentPreview(plan,serverDryRun){return verifiedPreview(plan,serverDryRun).expected;}
export function verifyDeploymentChange(plan,observed,serverDryRun){
 const {plan:p,expected}=verifiedPreview(plan,serverDryRun),s=captureDeploymentObject(p.before.ref,observed);
 if(s.uid!==p.before.uid||s.resourceVersion===p.before.resourceVersion||!sameOwnership(s.context,expected.context)||!same(s.fields,p.afterFields))deny();return s;
}
