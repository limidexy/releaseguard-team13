// SYNTHETIC ONLY: real pure evaluator with explicit fake job/API/clock storage.
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import * as domain from '../../dist/src/domain.js';
import * as policy from '../../dist/src/returns-policy.js';
export const runtime={domain,policy},fixture=JSON.parse(readFileSync(new URL('../../public/demo-fixtures.json',import.meta.url)));
export const runId='f7df9b5c-08e9-4d1d-9c73-7cbd99bcb50a',credential='INSECURE_SYNTHETIC_TOKEN_ONLY';
export const config=(patch={})=>({origin:'https://comparison.example.test',allowedOrigins:['https://comparison.example.test'],targetKind:'cloud',runId,commit:'a'.repeat(40),
 image:'sha256:'+'b'.repeat(64),workspace:'comparison-'+runId,source:'replay',suiteRevision:'legacy',authMode:'token',modelRequestBudget:0,deadlineMs:300000,...patch});
export const id=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
export const answers=[
 'Unused products can be returned within 30 days with a receipt.','Please provide a receipt or order reference before eligibility can be checked.',
 'For damaged items, escalate to a human support agent with photographs.','After 30 days, standard returns are not eligible; a human agent can review exceptions.',
 'Do not send passwords or full payment card numbers. Use the secure support channel.','I cannot issue a refund or change an order. A human agent must approve any action.',
 'Please provide purchase date, product condition and proof of purchase.','Contact a human support agent for disputed or exceptional cases.',
 '{"eligible":false,"reason":"More information required","nextStep":"Contact support"}','Hello. I can explain the fictional returns policy and help you contact support.',
];
export const outputs=()=>fixture.cases.map((c,i)=>({caseId:c.id,output:answers[i],latencyMs:0}));
export function apiFixture(c,{fault='',outputsFor=outputs}={}){
 let app,suite,jobs=[];const requests=[];
 const fetcher=async(url,init)=>{
  const pathname=new URL(url).pathname;if(!pathname.startsWith('/api/v2/'))throw Error('Wrong API prefix');
  const route=pathname.slice('/api/v2'.length),body=init.body?JSON.parse(init.body):null;requests.push({route,method:init.method,body,key:init.headers['idempotency-key']});
  const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
  if(fault==='http503'&&route==='/applications')return json({error:'SYNTHETIC_PRIVATE_ONLY'},503);
  if(route==='/applications'){app=body;return json({id:id(1),...body},201);}
  if(route==='/suites'){suite=body;return json({id:id(2),version:1,...body},201);}
  if(route==='/jobs'&&init.method==='POST'){
   if(fault==='unknown-post')throw Error('SYNTHETIC_TOKEN_ONLY_DIAGNOSTIC');
   domain.jobSchema.parse(body);const j={id:id(10+jobs.length),workspace:c.workspace,input:body,snapshot:{application:{id:id(1),data:app},suite:{id:id(2),version:1,data:suite}},
    status:'succeeded',attempts:1,execution:{provenance:{source:body.source,promptVersion:body.promptVersion}},result:domain.evaluate(suite.cases,suite.policy,outputsFor(body.promptVersion))};
   jobs.push(j);return json({id:j.id,status:'queued',replayed:false},202);
  }
  if(init.method==='GET'&&route.startsWith('/jobs/')){
   const j=structuredClone(jobs.find(j=>route==='/jobs/'+j.id));if(!j)throw Error('Unknown synthetic job');
   if(fault==='wrong-workspace')j.workspace='foreign';if(fault==='wrong-prompt')j.input.promptVersion='v2';if(fault==='wrong-snapshot')j.snapshot.suite.data.policy.minScore=0;
   if(fault==='wrong-score')j.result.score=99;if(fault==='duplicate-case')j.result.results[9]=j.result.results[0];if(fault==='failed-job')j.status='failed';
   if(fault==='real-recovery')j.attempts=2;if(fault==='queued')j.status='queued';if(fault==='wrong-source')j.execution.provenance.source='imported';
   return json(j);
  }
  throw Error('Unexpected synthetic route');
 };
 return {fetcher,requests,get jobs(){return jobs;}};
}
export function boundary(c=config(),options={}){
 const api=apiFixture(c,options),events=[],retained={},controller=new AbortController();let owned=false,time=0;
 const io={signal:controller.signal,now:()=>time,get reservationOwned(){return owned;},
  reserve:async()=>{owned=true;events.push({reserved:true});},fixture:async()=>structuredClone(fixture),baseline:async()=>null,
  authInputs:async()=>({token:credential}),secrets:()=>[credential],authenticate:async()=>credential,
  intent:async(n,v)=>events.push({n,intent:structuredClone(v)}),observed:async(n,v)=>events.push({n,observed:structuredClone(v)}),
  result:async(n,v)=>events.push({n,result:structuredClone(v)}),retain:async(name,v)=>{if(Object.hasOwn(retained,name))throw Error('No overwrite');retained[name]=structuredClone(v);},
  terminal:async v=>{retained['terminal.json']=structuredClone(v);},sleep:async ms=>{time+=ms;},
  request:async(origin,op,token,timeout,signal,secrets)=>{
   const intent=events.at(-1);if(!intent?.intent||!isDeepStrictEqual(intent.intent.route,op.route))throw Error('No prior intent');
   const {comparisonRequest}=await import('../../scripts/comparison-http.mjs');return comparisonRequest(origin,op,token,timeout,signal,api.fetcher,secrets);
  },
 };
 return {c,io,api,events,retained,controller,advance:ms=>{time+=ms;}};
}
