// Synthetic HTTP/Kubernetes/clock/storage boundary; no sockets or cloud.
import {readFileSync} from 'node:fs';
import {sha256} from '../../scripts/comparison-files.mjs';
import {benchmarkRequest} from '../../scripts/cloud-benchmark-http.mjs';
import {benchmarkTarget} from '../../scripts/cloud-benchmark-target.mjs';
import {targetFixture} from './cloud-benchmark-target.mjs';
const bytes=readFileSync(new URL('../../public/demo-fixtures.json',import.meta.url));
export const fixture=JSON.parse(bytes),fixtureBytes=bytes;
export const token=Buffer.from(JSON.stringify({alg:'HS256'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:'synthetic-service',principal:'synthetic-principal',workspace:'synthetic-workspace',role:'contributor',service:true})).toString('base64url')+'.'+'x'.repeat(43);
export function protocolBoundary(options={}){
 const f=targetFixture(),{runId,namespace,imageDigest,...selected}=f.config;
 const c={allowPairedReplay:true,runId,deadlineMs:1200000,jobs:20,origin:'https://releaseguard.example.test',allowedOrigins:['https://releaseguard.example.test'],commit:'a'.repeat(40),image:'registry.example.invalid/releaseguard@'+imageDigest,
  workspace:'synthetic-workspace',authMode:'token',authFile:'/synthetic-private/selected.json',fixtureSHA256:sha256(bytes),target:selected,identity:{path:'/synthetic-private/identity.json',sha256:'a'.repeat(64)},
  cloud:{project:'synthetic-project',zone:'asia-southeast1-b',cluster:'synthetic-cluster',clusterId:'synthetic-cluster-id',namespace,namespaceUid:'synthetic-namespace-uid',context:'gke_synthetic-project_asia-southeast1-b_synthetic-cluster',account:'synthetic@example.test',gcloudExecutable:'/synthetic/bin/gcloud',kubectlExecutable:'/synthetic/bin/kubectl',pluginExecutable:'/synthetic/bin/gke-gcloud-auth-plugin',gcloudConfigDirectory:'/synthetic/config',kubeconfigFile:'/synthetic-private/kube.json'}};
 const records=new Map(),calls=[],jobs=new Map(),assets=new Map(),auth=[],controller=new AbortController();let serial=0,owned=false,used=false,posts=0;
 const nextId=()=> '00000000-0000-4000-8000-'+String(++serial).padStart(12,'0');
 const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
 const fetcher=async(url,init)=>{
  const u=new URL(url),body=init.body?JSON.parse(init.body):null,call={url,route:u.pathname,query:u.search,method:init.method,body,key:init.headers['idempotency-key']};calls.push(call);f.advance(1);
  if(options.fetcher)return options.fetcher(call,{jobs,assets,f,nextId,json,c,token});
  if(call.route==='/api/v2/applications'||call.route==='/api/v2/suites'){const id=nextId();assets.set(id,body);return json({id,version:1},201);}
  if(call.route==='/api/v2/jobs'&&init.method==='POST'){
   posts++;const id=nextId();jobs.set(id,{input:body,index:posts});
   if(options.disconnectPost===posts)throw Error('SYNTHETIC disconnect after acceptance');
   if(options.statusPost===posts)return json({error:'SYNTHETIC503 after possible commit'},503);
   return json({id,status:'queued',replayed:false},202);
  }
  if(call.route==='/api/v2/jobs')return json([]);
  const id=call.route.split('/').at(-1),row=jobs.get(id);if(!row)throw Error('Unexpected synthetic route');
  const workers=f.state.pods.items.map(p=>p.metadata.name),input=structuredClone(row.input),job={id,workspace:c.workspace,created_by:'synthetic-principal',input,
   snapshot:{application:{id:input.appId,data:assets.get(input.appId)},suite:{id:input.suiteId,data:assets.get(input.suiteId)}},status:'succeeded',worker_id:workers[(row.index-1)%workers.length],attempts:1,
   created_at:'2026-10-11T00:00:00.000Z',started_at:'2026-10-11T00:00:00.010Z',finished_at:'2026-10-11T00:00:00.030Z',
   result:{total:10,passed:10,errors:0,criticalFailures:0,score:100,gate:'passed',results:fixture.suite.cases.map(c=>({caseId:c.id,status:'passed',output:'SYNTHETIC ONLY',latencyMs:0}))}};
  options.mutateJob?.(job,row,f);
  if(options.queued&&row.polls===undefined){row.polls=1;job.status='running';job.result=null;}
  return json(job);
 };
 const io={signal:controller.signal,now:f.io.now,remaining:cleanup=>(cleanup?1200000:900000)-f.io.now(),get owned(){return owned;},
  async reserve(){if(used)throw Error('Already used');used=true;owned=true;},
  async json(name,v){if(records.has(name))throw Error('Overwrite refused');options.onPersist?.(name,v,{controller,f});records.set(name,structuredClone(v));},
  fixture:async()=>({bytes:Buffer.from(bytes),value:structuredClone(fixture)}),
  async target(){if(options.targetRefused)throw Error('Synthetic target proof failed');return benchmarkTarget(f.config,{...f.io,remaining:io.remaining});},
  async authInputs(){auth.push('inputs');return token;},async authorize(){auth.push('authorize');return options.token??token;},
  request:(origin,op,auth,timeout,signal)=>benchmarkRequest(origin,op,auth,timeout,signal,fetcher),
  async sleep(ms){f.advance(ms);},async verifyRuntime(){if(options.sourceDrift)throw Error('Synthetic source drift');},
  terminal:v=>io.json('terminal.json',v),
 };
 return {c,io,f,records,calls,jobs,assets,auth,controller,fetcher};
}
