// Source: pre-M6D2 main1811aa91, scripts/render-cloud.mjs; body below guard is frozen.
// Frozen historical generator, only for output-equivalence tests. Not an operational entry point.
import { statSync as fixtureStat } from 'node:fs';
import { basename as fixtureBasename } from 'node:path';
const fixtureRoot = process.env.RG_RENDER_FIXTURE_ROOT;
if (!fixtureRoot || !/^rg-render-[A-Za-z0-9_-]+$/.test(fixtureBasename(fixtureRoot))) throw Error('Owned render fixture required');
const fixtureIdentity = fixtureStat(fixtureRoot, { bigint: true }), cwdIdentity = fixtureStat(process.cwd(), { bigint: true });
if (!fixtureIdentity.isDirectory() || fixtureIdentity.ino === 0n || fixtureIdentity.dev !== cwdIdentity.dev || fixtureIdentity.ino !== cwdIdentity.ino) throw Error('Owned render fixture required');
import { mkdir, writeFile } from 'node:fs/promises';
const required=name=>{const value=process.env[name];if(!value)throw new Error('Required cloud configuration: '+name);return value};
const image=required('RG_IMAGE'),origin=required('PUBLIC_ORIGIN'),issuer=required('AUTH_ISSUER'),jwks=required('OIDC_JWKS_URL');
if(!/^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/.test(image))throw new Error('Use a tested immutable image digest, not a mutable tag');
for(const value of [origin,issuer,jwks])if(new URL(value).protocol!=='https:'||new URL(value).hostname.endsWith('.invalid'))throw new Error('Cloud URLs must be actual HTTPS endpoints');
const namespace='releaseguard',documents=[],roles=['registry','evaluation','governance','support','worker','gateway'];
documents.push({apiVersion:'v1',kind:'Namespace',metadata:{name:namespace}});
documents.push({apiVersion:'v1',kind:'ConfigMap',metadata:{name:'rg-config',namespace},data:{AUTH_MODE:'oidc',AUTH_ISSUER:issuer,OIDC_JWKS_URL:jwks,PUBLIC_ORIGIN:origin,RUNNER_ORIGINS:'http://support:8080',REGISTRY_URL:'http://registry:8080',EVALUATION_URL:'http://evaluation:8080',GOVERNANCE_URL:'http://governance:8080',LEASE_MS:'60000'}});
const fromSecret=(name,key,optional=false)=>({secretKeyRef:{name,key,optional}});
for(const role of roles){
  const env=[{name:'SERVICE_ROLE',value:role},{name:'INTERNAL_SECRET',valueFrom:fromSecret('rg-internal','INTERNAL_SECRET')}];
  if(['registry','evaluation','governance','worker'].includes(role))env.push({name:'DATABASE_URL',valueFrom:fromSecret('rg-'+(role==='worker'?'evaluation':role),'DATABASE_URL')});
  if(['evaluation','worker'].includes(role))env.push({name:'AMQP_URL',valueFrom:fromSecret('rg-broker','AMQP_URL')});
  if(role==='support'){for(const name of ['MODEL_API_URL','MODEL_API_KEY','MODEL_ID','ALLOW_REAL_MODEL'])env.push({name,valueFrom:fromSecret('rg-provider',name,true)})}
  const labels={app:role,'app.kubernetes.io/part-of':'releaseguard'};
  documents.push({apiVersion:'apps/v1',kind:'Deployment',metadata:{name:role,namespace},spec:{replicas:role==='gateway'?2:1,strategy:{type:'RollingUpdate',rollingUpdate:{maxUnavailable:0,maxSurge:1}},selector:{matchLabels:{app:role}},template:{metadata:{labels},spec:{automountServiceAccountToken:false,terminationGracePeriodSeconds:30,securityContext:{runAsNonRoot:true,runAsUser:1000,runAsGroup:1000},containers:[{name:role,image,imagePullPolicy:'IfNotPresent',envFrom:[{configMapRef:{name:'rg-config'}}],env,ports:[{containerPort:8080}],resources:{requests:{cpu:'250m',memory:'128Mi'},limits:{cpu:'500m',memory:'384Mi'}},securityContext:{allowPrivilegeEscalation:false,readOnlyRootFilesystem:true,capabilities:{drop:['ALL']}},startupProbe:{httpGet:{path:'/health/ready',port:8080},periodSeconds:5,failureThreshold:30},readinessProbe:{httpGet:{path:'/health/ready',port:8080},periodSeconds:5},livenessProbe:{httpGet:{path:'/health/live',port:8080},periodSeconds:10}}]}}}});
  documents.push({apiVersion:'v1',kind:'Service',metadata:{name:role,namespace},spec:{selector:{app:role},ports:[{port:8080,targetPort:8080}],type:'ClusterIP'}});
}
await mkdir('deploy/k8s/rendered',{recursive:true});
await writeFile('deploy/k8s/rendered/services.yaml',documents.map(d=>JSON.stringify(d,null,2)).join('\n---\n')+'\n');
console.log('Rendered cloud services. No deployment was performed. Provision secrets, private DB/broker and HTTPS ingress first.');
