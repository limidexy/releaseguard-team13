// Independent, disposable RFC6902 subset used by these object-level tests.
// Changes are committed only after every operation passes. No actual API.
import assert from 'node:assert/strict';
export const runId='81111111-1111-4111-8111-111111111111';
export function objectFixture(kind='Deployment',name='worker'){
 const metadata={name,namespace:'releaseguard',uid:'synthetic-'+kind+'-'+name,resourceVersion:'opaque:initial',generation:3,labels:{team:'synthetic'},annotations:{'releaseguard/source':'a'.repeat(40)},finalizers:['synthetic.example/keep']};
 if(kind==='ConfigMap')return {apiVersion:'v1',kind,metadata,data:{AUTH_MODE:'oidc',SYNTHETIC_SETTING:'before'},binaryData:{fixture:'eA=='},immutable:false};
 if(kind==='Service')return {apiVersion:'v1',kind,metadata,spec:{type:'ClusterIP',clusterIP:'192.0.2.25',clusterIPs:['192.0.2.25'],ipFamilies:['IPv4'],ipFamilyPolicy:'SingleStack',selector:{app:name},ports:[{port:8080,targetPort:8080,protocol:'TCP'}]}};
 return {apiVersion:'apps/v1',kind,metadata,spec:{replicas:1,selector:{matchLabels:{app:name}},strategy:{type:'RollingUpdate',rollingUpdate:{maxUnavailable:0,maxSurge:1}},template:{metadata:{labels:{app:name},annotations:{'synthetic/template':'before'}},spec:{automountServiceAccountToken:false,containers:[{name,image:'registry.example.invalid/rg@sha256:'+'a'.repeat(64),env:[{name:'SYNTHETIC_SETTING',value:'before'}],resources:{requests:{cpu:'100m',memory:'128Mi'},limits:{cpu:'500m',memory:'384Mi'}}}]}}},status:{observedGeneration:3,readyReplicas:1}};
}
export function atomicObjectAPI(initial){
 let state=structuredClone(initial),version=0;const writes=[];
 const read=()=>structuredClone(state);
 function patch(operations){
  const next=read();
  for(const p of operations){
   assert.match(p.path,/^\//);const path=p.path.slice(1).split('/').map(k=>{assert.doesNotMatch(k,/~(?:[^01]|$)/);return k.replace(/~1/g,'/').replace(/~0/g,'~');});let parent=next;
   for(const k of path.slice(0,-1)){assert.ok(parent&&Object.hasOwn(parent,k),'missing parent');parent=parent[k];}
   const key=path.at(-1);assert.ok(parent&&typeof parent==='object'&&!Array.isArray(parent));
   if(p.op==='test'){assert.ok(Object.hasOwn(parent,key),'missing test path');assert.deepEqual(parent[key],p.value,'synthetic conditional patch conflict');}
   else if(p.op==='remove'){assert.ok(Object.hasOwn(parent,key));delete parent[key];}
   else if(p.op==='replace'){assert.ok(Object.hasOwn(parent,key));parent[key]=structuredClone(p.value);}
   else {assert.equal(p.op,'add');parent[key]=structuredClone(p.value);}
  }
  next.metadata.resourceVersion='opaque:write-'+(++version);if(JSON.stringify(state.spec)!==JSON.stringify(next.spec))next.metadata.generation++;
  writes.push(structuredClone(operations));state=next;return read();
 }
 return {read,patch,writes,mutate(fn,{bump=true}={}){fn(state);if(bump)state.metadata.resourceVersion='opaque:external-'+(++version);}};
}
