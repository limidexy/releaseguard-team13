// Frozen source behavior under owned in-memory kubectl, child-process and
// filesystem boundaries. No Docker, cloud, credential, network or deployment.
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {deploymentSource as source} from './deploy-source-pr1.mjs';
assert.equal(createHash('sha256').update(source).digest('hex'),'2107fa17a70856d5b34dc7c1cecae6ae3d1cd43c142c7b58749ddddab098a4c1');
const executable=source.replace("import { execFileSync } from 'node:child_process';\n",'').replace("import { mkdir, readFile, writeFile } from 'node:fs/promises';\n",'');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
export const roles=['registry','evaluation','governance','support','worker','gateway'];
export async function simulateDeployment(options={}){
 const oldImage='registry.example.invalid/releaseguard@sha256:'+'a'.repeat(64),newImage='registry.example.invalid/releaseguard@sha256:'+'b'.repeat(64),oldSource='1'.repeat(40),newSource='2'.repeat(40),calls=[],prints=[],overwrites=[],writes=options.writes??new Map();
 const deployments=new Map(roles.map(role=>[role,{metadata:{uid:'synthetic-'+role+'-uid',resourceVersion:'1',annotations:{'releaseguard/source':oldSource}},spec:{replicas:1,template:{spec:{containers:[{name:role,image:oldImage,env:[{name:'SYNTHETIC_SETTING',value:'before'}]}]}}},status:{readyReplicas:1}}]));
 let clock=0,smokes=0,applies=0,foreignOverwrites=0,candidateFailed=false;
 const env={RG_IMAGE:newImage,RG_COMMIT:newSource,RG_CI_RUN:'synthetic-ci',...options.env},process={env,execPath:'synthetic-owned-node',exitCode:0};
 class FakeDate extends Date{constructor(...args){super(...(args.length?args:[Date.parse('2000-01-01T00:00:00Z')+clock]));}}
 const put=(path,bytes)=>{if(writes.has(path))overwrites.push(path);writes.set(path,String(bytes));};
 function exec(command,args,opts){
  clock+=10;calls.push({command,args:[...args],at:clock,environmentKeys:Object.keys(opts?.env??{})});
  if(command==='synthetic-owned-node'){
   assert.equal(args.length,1);const file=args[0];
   if(file==='scripts/render-cloud.mjs')return '';
   assert.equal(file,'scripts/cloud-smoke.mjs');smokes++;
   if(options.failCandidateSmoke&&!candidateFailed){candidateFailed=true;
    if(options.foreignDuringFailure){const d=deployments.get('evaluation');d.metadata.uid='synthetic-foreign-uid';d.spec.template.spec.containers[0].image='registry.example.invalid/foreign@sha256:'+'c'.repeat(64);}
    throw Error('SYNTHETIC_CANDIDATE_SMOKE_FAILED');
   }
   put('evidence/cloud-smoke.json',JSON.stringify({job:{id:'synthetic-smoke-'+smokes},source:opts.env.RG_COMMIT,image:opts.env.RG_IMAGE}));
   return '';
  }
  assert.equal(command,'kubectl');assert.deepEqual(args.slice(0,2),['-n','releaseguard']);const a=args.slice(2);
  if(a[0]==='get'){assert.equal(a[1],'deployment');assert.deepEqual(a.slice(3),['-o','json']);return JSON.stringify(deployments.get(a[2]));}
  if(a[0]==='set'){
   assert.equal(a[1],'image');const role=a[2].slice('deployment/'.length),d=deployments.get(role);assert.ok(d);assert.ok(a[3].startsWith(role+'='));
   if(d.metadata.uid==='synthetic-foreign-uid')foreignOverwrites++;d.spec.template.spec.containers[0].image=a[3].slice(role.length+1);return '';
  }
  if(a[0]==='apply'){
   assert.deepEqual(a,['apply','--server-side','--field-manager=kubectl','-f','deploy/k8s/rendered/services.yaml']);applies++;
   // A non-image manifest field exists in the original apply surface.
   for(const d of deployments.values())d.spec.template.spec.containers[0].env[0].value='candidate';return '';
  }
  if(a[0]==='rollout'){assert.equal(a[1],'status');return 'SYNTHETIC rollout ready';}
  if(a[0]==='annotate'){
   const role=a[1].slice('deployment/'.length),d=deployments.get(role);assert.ok(d);
   if(d.metadata.uid==='synthetic-foreign-uid')foreignOverwrites++;assert.ok(a[2].startsWith('releaseguard/source='));d.metadata.annotations['releaseguard/source']=a[2].slice('releaseguard/source='.length);return '';
  }
  throw Error('Unselected synthetic boundary');
 }
 await new AsyncFunction('execFileSync','mkdir','readFile','writeFile','process','Date','console',executable)(
  exec,async()=>{},async path=>{assert.ok(writes.has(path));return writes.get(path);},async(path,bytes)=>put(path,bytes),process,FakeDate,{log:s=>prints.push(String(s))});
 const raw=writes.get('evidence/current/cloud-deployment.json');assert.equal(typeof raw,'string');
 return {report:JSON.parse(raw),rawReport:raw,exitCode:process.exitCode,calls,writes,overwrites,deployments,smokes,applies,foreignOverwrites,oldImage,newImage,oldSource,newSource,prints,
  simulation:{actualProcess:0,actualCloud:0,actualDocker:0,actualDeployment:0,clock:'synthetic year2000',notRuntimeAcceptance:true}};
}
