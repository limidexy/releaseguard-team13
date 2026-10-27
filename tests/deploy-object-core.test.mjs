import test from 'node:test';import assert from 'node:assert/strict';
import {captureDeploymentObject as capture,deploymentObjectRef as ref,deploymentRoles,planDeploymentClaim as claim,planDeploymentUpdate as update,planDeploymentRestore as restore,planDeploymentRelease as release,verifyDeploymentChange as observed,deploymentOwnerAnnotation as owner} from '../scripts/deploy-object-core.mjs';
import {objectFixture,atomicObjectAPI,runId} from './fixtures/deploy-object-api.mjs';
const snapshot=(api,r)=>capture(r,api.read());
function setup(kind='Deployment',name='worker'){
 const initial=objectFixture(kind,name),r=ref(kind,name),api=atomicObjectAPI(initial),baseline=capture(r,initial),p=claim(baseline,runId),owned=observed(p,api.patch(p.patch));return {initial,r,api,baseline,owned};
}
function desired(api,kind){
 const d=api.read();d.metadata.labels.changed='synthetic';d.metadata.annotations['releaseguard/source']='b'.repeat(40);
 if(kind==='Deployment'){const c=d.spec.template.spec.containers[0];c.image='registry.example.invalid/rg@sha256:'+'b'.repeat(64);c.env[0].value='candidate';c.resources.requests.cpu='150m';d.spec.template.metadata.annotations['synthetic/template']='candidate';d.spec.strategy.rollingUpdate.maxSurge=2;}
 else if(kind==='Service'){d.spec.selector.revision='synthetic-candidate';d.spec.ports[0].targetPort=8081;}
 else{d.data.SYNTHETIC_SETTING='candidate';d.binaryData.fixture='eQ==';}
 return d;
}
for(const kind of ['Deployment','Service','ConfigMap'])for(const name of kind==='ConfigMap'?['rg-config']:deploymentRoles){
 test(kind+'/'+name+': claim, full non-image transition, conditional restoration and original metadata presence',()=>{
  const x=setup(kind,name),candidate=desired(x.api,kind),p=update(x.owned,candidate,runId),after=observed(p,x.api.patch(p.patch));
  assert.deepEqual(after.fields,capture(x.r,candidate).fields);assert.equal(x.api.read().metadata.annotations[owner],runId);
  const rollback=restore(x.baseline,after,snapshot(x.api,x.r),runId),final=observed(rollback,x.api.patch(rollback.patch));
  assert.deepEqual(final.fields,x.baseline.fields);assert.deepEqual(final.context,x.baseline.context);assert.equal(x.api.read().metadata.uid,x.initial.metadata.uid);assert.equal(Object.hasOwn(x.api.read().metadata.annotations,owner),false);
 });
}
test('release removes only this run marker while retaining candidate data and source annotation',()=>{
 const x=setup('ConfigMap','rg-config'),p=update(x.owned,desired(x.api,'ConfigMap'),runId),after=observed(p,x.api.patch(p.patch)),leave=release(after,snapshot(x.api,x.r),runId),done=observed(leave,x.api.patch(leave.patch));
 assert.equal(done.fields.data.value.SYNTHETIC_SETTING,'candidate');assert.equal(done.fields.annotations.value['releaseguard/source'],'b'.repeat(40));assert.equal(Object.hasOwn(done.fields.annotations.value,owner),false);
});
test('missing labels/annotations/data/binaryData are restored as absent, not invented empty maps',()=>{
 const initial=objectFixture('ConfigMap','rg-config');delete initial.metadata.labels;delete initial.metadata.annotations;delete initial.binaryData;delete initial.data;delete initial.immutable;
 const r=ref('ConfigMap','rg-config'),api=atomicObjectAPI(initial),baseline=capture(r,initial),take=claim(baseline,runId),owned=observed(take,api.patch(take.patch)),d=api.read();d.data={SYNTHETIC:'new'};d.binaryData={synthetic:'eA=='};d.metadata.labels={synthetic:'new'};
 const change=update(owned,d,runId),after=observed(change,api.patch(change.patch)),back=restore(baseline,after,capture(r,api.read()),runId),done=observed(back,api.patch(back.patch));
 assert.deepEqual(done.fields,baseline.fields);for(const key of ['labels','annotations'])assert.equal(Object.hasOwn(api.read().metadata,key),false);for(const key of ['data','binaryData','immutable'])assert.equal(Object.hasOwn(api.read(),key),false);
});
test('status-only update and opaque resourceVersion can be read freshly before recovery',()=>{
 const x=setup(),p=update(x.owned,desired(x.api,'Deployment'),runId),after=observed(p,x.api.patch(p.patch));
 x.api.mutate(d=>{d.status.readyReplicas=0;d.status.observedGeneration++;});
 const back=restore(x.baseline,after,snapshot(x.api,x.r),runId);assert.equal(back.patch[1].value,x.api.read().metadata.resourceVersion);const done=observed(back,x.api.patch(back.patch));assert.deepEqual(done.fields,x.baseline.fields);assert.equal(x.api.read().status.readyReplicas,0);
});
for(const [label,change] of [
 ['UID',d=>{d.metadata.uid='synthetic-foreign';}],['namespace',d=>{d.metadata.namespace='foreign';}],['name',d=>{d.metadata.name='gateway';}],
 ['owner',d=>{d.metadata.annotations[owner]='82222222-2222-4222-8222-222222222222';}],['new annotation',d=>{d.metadata.annotations.foreign='keep';}],
 ['image',d=>{d.spec.template.spec.containers[0].image='registry.example.invalid/foreign@sha256:'+'c'.repeat(64);}],
 ['non-image configuration',d=>{d.spec.template.spec.containers[0].env[0].value='foreign';}],['labels',d=>{d.metadata.labels.foreign='keep';}],
 ['ownerReferences',d=>{d.metadata.ownerReferences=[{apiVersion:'v1',kind:'Synthetic',name:'foreign',uid:'foreign'}];}],['finalizers',d=>{d.metadata.finalizers.push('synthetic/foreign');}],
 ['deletion',d=>{d.metadata.deletionTimestamp='2000-01-01T00:00:00Z';}]
]){
 test('foreign '+label+' is preserved: no restoration or release plan is produced',()=>{
  const x=setup();x.api.mutate(change);const before=x.api.read(),writes=x.api.writes.length;
  assert.throws(()=>restore(x.baseline,x.owned,capture(x.r,x.api.read()),runId));assert.throws(()=>release(x.owned,capture(x.r,x.api.read()),runId));assert.deepEqual(x.api.read(),before);assert.equal(x.api.writes.length,writes);
 });
}
for(const [label,mutate] of [
 ['resourceVersion',d=>{d.metadata.resourceVersion='opaque:race';}],['UID',d=>{d.metadata.uid='synthetic-raced';}],['whole spec despite unchanged RV',d=>{d.spec.replicas=7;}],['whole annotations despite unchanged RV',d=>{d.metadata.annotations.foreign='keep';}]
]){
 test('conditional '+label+' conflict rejects the whole patch without partial state',()=>{
  const x=setup(),p=update(x.owned,desired(x.api,'Deployment'),runId);x.api.mutate(mutate,{bump:false});const before=x.api.read();assert.throws(()=>x.api.patch(p.patch));assert.deepEqual(x.api.read(),before);
 });
}
for(const marker of ['',runId,'foreign'])test('a pre-existing run marker is refused even when equal or empty: '+JSON.stringify(marker),()=>{
 const d=objectFixture();d.metadata.annotations[owner]=marker;assert.throws(()=>claim(capture(ref('Deployment','worker'),d),runId));
});
test('an update cannot remove ownership, redirect selected UID/RV or mutate ownership context',()=>{
 const x=setup();for(const modify of [d=>{delete d.metadata.annotations[owner];},d=>{d.metadata.uid='foreign';},d=>{d.metadata.resourceVersion='opaque:foreign';},d=>{d.metadata.finalizers=[];}]){const d=desired(x.api,'Deployment');modify(d);assert.throws(()=>update(x.owned,d,runId));}
});
test('unchanged server projection yields no mutation plan',()=>{const x=setup();assert.equal(update(x.owned,x.api.read(),runId),null);assert.equal(x.api.writes.length,1);});
for(const key of ['clusterIP','clusterIPs','ipFamilies','ipFamilyPolicy','type'])test('Service identity field '+key+' cannot be changed by this reversible primitive',()=>{
 const x=setup('Service','gateway'),d=desired(x.api,'Service');d.spec[key]=key==='clusterIPs'?['192.0.2.99']:key==='ipFamilies'?['IPv6']:key==='type'?'LoadBalancer':'synthetic-change';assert.throws(()=>update(x.owned,d,runId));
});
test('Deployment selector and irreversible ConfigMap changes are refused before an API operation',()=>{
 const x=setup(),d=desired(x.api,'Deployment');d.spec.selector.matchLabels.app='foreign';assert.throws(()=>update(x.owned,d,runId));
 const y=setup('ConfigMap','rg-config'),c=y.api.read();c.immutable=true;assert.throws(()=>update(y.owned,c,runId));
});
test('an already immutable ConfigMap permits marker ownership and release, but no data or immutability change',()=>{
 const d=objectFixture('ConfigMap','rg-config');d.immutable=true;const r=ref('ConfigMap','rg-config'),api=atomicObjectAPI(d),base=capture(r,d),p=claim(base,runId),owned=observed(p,api.patch(p.patch));const changed=api.read();changed.data.AUTH_MODE='foreign';assert.throws(()=>update(owned,changed,runId));changed.data.AUTH_MODE='oidc';changed.immutable=false;assert.throws(()=>update(owned,changed,runId));assert.ok(release(owned,capture(r,api.read()),runId));
});
test('receipt/plan mutation, stale echo, admission mutation and wrong observed UID cannot report success',()=>{
 const x=setup(),p=update(x.owned,desired(x.api,'Deployment'),runId),actual=x.api.patch(p.patch);
 const altered=structuredClone(p);altered.patch.at(-1).value='tampered';assert.throws(()=>observed(altered,actual));
 for(const modify of [d=>{d.metadata.uid='foreign';},d=>{d.metadata.resourceVersion=p.before.resourceVersion;},d=>{d.spec.replicas=99;},d=>{d.metadata.finalizers=[];}]){const d=structuredClone(actual);modify(d);assert.throws(()=>observed(p,d));}
 const bad=structuredClone(x.owned);bad.fields.spec.value.replicas=99;assert.throws(()=>release(bad,capture(x.r,actual),runId));
});
for(const [kind,name]of [['Secret','rg-internal'],['StatefulSet','postgres'],['Deployment','foreign'],['Namespace','releaseguard'],['Service','postgres']])test('unselected '+kind+'/'+name+' has no reference or patch capability',()=>assert.throws(()=>ref(kind,name)));
test('malformed or non-JSON observations fail without invoking accessors or mutating caller data',()=>{
 const r=ref('Deployment','worker'),d=objectFixture(),before=structuredClone(d);let called=false;
 const accessor={...d};Object.defineProperty(accessor,'spec',{enumerable:true,get(){called=true;throw Error('must not enter');}});assert.throws(()=>capture(r,accessor));assert.equal(called,false);
 const values=[{...d,spec:undefined},{...d,spec:NaN},{...d,spec:1n},{...d,spec:new Date()},{...d,spec:{x:Infinity}},{...d,spec:JSON.parse('{"__proto__":{"foreign":true}}')}];
 const sparse=new Array(1);sparse.foreign=1;values.push({...d,spec:{sparse}});const hidden={};Object.defineProperty(hidden,'foreign',{value:1});values.push({...d,spec:hidden});const cyclic={};cyclic.x=cyclic;values.push({...d,spec:cyclic});
 for(const v of values)assert.throws(()=>capture(r,v));assert.deepEqual(d,before);assert.equal({}.foreign,undefined);
});
test('bounded observations and invalid run identities cannot produce a plan',()=>{
 const d=objectFixture();d.spec.tooLarge='x'.repeat(1024*1024);assert.throws(()=>capture(ref('Deployment','worker'),d));
 const s=capture(ref('Deployment','worker'),objectFixture());for(const id of ['','not-a-run','81111111-1111-1111-8111-111111111111','81111111-1111-4111-7111-111111111111'])assert.throws(()=>claim(s,id));
});
test('restoration cannot borrow a baseline from another UID, resource or ownership context',()=>{
 const x=setup();
 for(const modify of [d=>{d.metadata.uid='different-original';},d=>{d.metadata.name='evaluation';},d=>{d.metadata.finalizers=[];},d=>{d.metadata.annotations[owner]='';}]){
  const d=structuredClone(x.initial);modify(d);const r=ref('Deployment',d.metadata.name),baseline=capture(r,d);assert.throws(()=>restore(baseline,x.owned,snapshot(x.api,x.r),runId));
 }
});
test('confirmed release cannot be silently reused as an owned continuation or automatic retry',()=>{
 const x=setup(),p=release(x.owned,snapshot(x.api,x.r),runId),released=observed(p,x.api.patch(p.patch));
 assert.throws(()=>release(x.owned,released,runId));assert.throws(()=>restore(x.baseline,x.owned,released,runId));
});
test('claim and plan builders preserve caller snapshots and desired objects byte-for-byte',()=>{
 const d=objectFixture(),r=ref('Deployment','worker'),s=capture(r,d),before=JSON.stringify({d,s}),p=claim(s,runId);assert.equal(JSON.stringify({d,s}),before);
 const api=atomicObjectAPI(d),owned=observed(p,api.patch(p.patch)),target=desired(api,'Deployment'),frozen=JSON.stringify({owned,target});update(owned,target,runId);assert.equal(JSON.stringify({owned,target}),frozen);
});
