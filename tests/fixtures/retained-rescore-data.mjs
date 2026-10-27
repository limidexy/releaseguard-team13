// SYNTHETIC retained records, never actual provider answers or measurements.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as domain from '../../dist/src/domain.js';
import * as policy from '../../dist/src/returns-policy.js';
import { outputs } from './comparison-data.mjs';
export const runtime={domain,policy},fixture=JSON.parse(readFileSync(new URL('../../public/demo-fixtures.json',import.meta.url)));
export const runId='b7df9b5c-08e9-4d1d-9c73-7cbd99bcb50a',credential='INSECURE_RETAINED_SYNTHETIC_TOKEN';
export const id=n=>'20000000-0000-4000-8000-'+String(n).padStart(12,'0');
export const config=(patch={})=>({allowImportedRescore:true,origin:'https://retained.example.test',allowedOrigins:['https://retained.example.test'],workspace:'synthetic-workspace',
 runId,commit:'b'.repeat(40),image:'sha256:'+'c'.repeat(64),authMode:'token',suiteRevision:'v2.1',deadlineMs:300000,...patch});
export function retainedSource(){
 return {schemaVersion:'2.2',createdAt:'2026-01-01T00:00:00.000Z',source:'real',cloud:true,declaredOrigin:'https://retained.example.test',workspace:'synthetic-workspace',
  appId:id(1),suiteId:id(2),evaluatorVersion:'legacy-literal-v1',cases:structuredClone(fixture.suite.cases),policy:structuredClone(fixture.suite.policy),
  runs:['v1','v2'].map((promptVersion,i)=>({id:id(10+i),workspace:'synthetic-workspace',created_by:'synthetic-source-only',status:'succeeded',attempts:1,
   input:{appId:id(1),suiteId:id(2),candidate:'synthetic-retained-'+promptVersion,commitRef:'a'.repeat(40),source:'real',promptVersion,scenario:'passing'},
   snapshot:{application:{id:id(1),data:structuredClone(fixture.application)},suite:{id:id(2),version:7,data:structuredClone(fixture.suite)}},
   result:domain.evaluate(fixture.suite.cases,fixture.suite.policy,outputs()),execution:{provenance:{source:'real',trust:'SYNTHETIC FIXTURE ONLY'}},
   created_at:'2026-01-01T00:00:00.000Z',started_at:'2026-01-01T00:00:00.001Z',finished_at:'2026-01-01T00:00:00.002Z'}))};
}
export const encoded=value=>Buffer.from(JSON.stringify(value,null,2)+'\n'),digest=b=>createHash('sha256').update(b).digest('hex');
export function apiFixture(c,source,{fault=''}={}){
 const calls=[],jobs=[],reads=new Map();let definition;
 const fetcher=async(url,init)=>{
  const path=new URL(url).pathname;if(!path.startsWith('/api/v2/'))throw Error('Wrong API prefix');const route=path.slice('/api/v2'.length),body=init.body?JSON.parse(init.body):undefined;
  calls.push({route,method:init.method,body,key:init.headers['idempotency-key']});const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json'}});
  const old=source.runs.find(j=>'/jobs/'+j.id===route);
  if(init.method==='GET'&&old){const n=(reads.get(old.id)??0)+1;reads.set(old.id,n);const copy=structuredClone(old);if(fault==='source-before'||fault==='source-after'&&n>1)copy.result.score=13;return json(copy);}
  if(fault==='http429'&&route==='/suites')return json({error:'SYNTHETIC_PRIVATE_QUOTA'},429);
  if(route==='/suites'&&init.method==='POST'){definition=body;return json({id:id(3),version:fault==='wrong-parent-version'?1:8,...body},201);}
  if(route==='/jobs'&&init.method==='POST'){
   if(fault==='unknown-post')throw Error('INSECURE_RETAINED_PRIVATE_DISCONNECT');
   const input=domain.jobSchema.parse(body);if(input.source!=='imported')throw Error('Model-capable source forbidden');
   const j={id:id(20+jobs.length),workspace:c.workspace,created_by:'synthetic-import-only',input:structuredClone(input),status:'succeeded',attempts:1,
    snapshot:{application:structuredClone(source.runs[0].snapshot.application),suite:{id:id(3),version:8,data:structuredClone(definition)}},
    result:domain.evaluate(definition.cases,definition.policy,input.outputs),execution:{provenance:{source:'imported',trust:'caller_supplied'}}};jobs.push(j);
   return json({id:j.id,status:'queued',replayed:false},202);
  }
  const job=jobs.find(j=>'/jobs/'+j.id===route);
  if(init.method==='GET'&&job){const j=structuredClone(job);
   if(fault==='wrong-case-status')j.result.results[0].status='failed';if(fault==='wrong-reason')j.result.results[0].reason='Wrong reason';
   if(fault==='wrong-workspace')j.workspace='foreign';if(fault==='wrong-snapshot')j.snapshot.suite.data.parentId=id(99);
   if(fault==='wrong-output')j.result.results[0].output='Rewritten answer';if(fault==='wrong-source')j.input.source='real';
   if(fault==='wrong-error')j.result.errors=0;if(fault==='failed-job')j.status='failed';if(fault==='queued')j.status='queued';
   return json(j);
  }
  throw Error('Unexpected retained synthetic route');
 };
 return {fetcher,calls,jobs,reads};
}
export function boundary(c=config(),source=retainedSource(),options={}){
 const api=apiFixture(c,source,options),events=[],retained={},controller=new AbortController();let owned=false,time=0;
 const io={signal:controller.signal,now:()=>time,get reservationOwned(){return owned;},reserve:async()=>{owned=true;events.push({reserved:true});},
  authInputs:async()=>({token:credential}),secrets:()=>[credential],authenticate:async()=>credential,
  source:async secrets=>({value:structuredClone(source),sha256:digest(encoded(source))}),retainSource:async raw=>{retained['source-original.json']=structuredClone(raw.value);},
  intent:async(n,v)=>{events.push({n,intent:structuredClone(v)});},observed:async(n,v)=>{events.push({n,observed:structuredClone(v)});},result:async(n,v)=>{events.push({n,result:structuredClone(v)});},
  retain:async(name,v)=>{if(Object.hasOwn(retained,name))throw Error('No overwrite');retained[name]=structuredClone(v);},
  terminal:async v=>{retained['terminal.json']=structuredClone(v);},sleep:async ms=>{time+=ms;},
  request:async(origin,op,token,timeout,signal,secrets)=>{if(events.at(-1)?.intent?.route!==op.route)throw Error('No persisted matching intent');const {retainedRequest}=await import('../../scripts/retained-rescore-http.mjs');return retainedRequest(origin,op,token,timeout,signal,api.fetcher,secrets);},
 };
 return {c,source,io,api,events,retained,controller,advance:ms=>{time+=ms;}};
}
export async function legacyProbe({fault=''}={}){
 const source=retainedSource(),raw=encoded(source),records=[],calls=[];let definition,saved;
 const text=readFileSync(new URL('./cloud-rescore-source-pr1.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
 const required=async(path,token,body,key)=>{calls.push({path,body});if(path==='suites'){definition=body;return {id:id(3),version:8,...body};}records.push(body);return {id:id(20+records.length)};};
 const completed=async key=>{const input=records[records.length-1],result=domain.evaluate(definition.cases,definition.policy,input.outputs);if(fault==='wrong-case-status')result.results[0].status='failed';
  return {id:key,status:'succeeded',input:structuredClone(input),result};};
 const assert=(await import('node:assert/strict')).default;
 const fn=new (Object.getPrototypeOf(async()=>{}).constructor)('assert','readFile','writeFile','mkdir','createHash','revisedReturnsSuite','returnsEvaluatorVersion','evaluate','caseSchema','required','completed','base','cloudToken','process','console',text);
 await fn(assert,async()=>raw,async(p,v)=>{saved=JSON.parse(v);},async()=>{},createHash,policy.revisedReturnsSuite,policy.returnsEvaluatorVersion,domain.evaluate,domain.caseSchema,required,completed,'https://retained.example.test',async()=>{calls.push({auth:true});return credential;},
  {argv:['node','legacy.mjs','retained.json'],env:{RG_ALLOW_CLOUD_SMOKE:'true',RG_CLOUD_ALLOWED_ORIGINS:'https://retained.example.test',RG_COMMIT:'b'.repeat(40),RG_IMAGE:'sha256:'+'c'.repeat(64)}},{log(){}});
 return {saved,calls,source};
}
