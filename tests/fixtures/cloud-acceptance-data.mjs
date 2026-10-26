// Controlled API/clock/storage only. Protocol and native HTTP adapter stay real.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { acceptanceRequest } from '../../scripts/cloud-acceptance-http.mjs';
export const fixture=JSON.parse(readFileSync(new URL('../../public/demo-fixtures.json',import.meta.url)));
export const runId='00000000-0000-4000-8000-000000000011',ids={app:'00000000-0000-4000-8000-000000000012',suite:'00000000-0000-4000-8000-000000000013',job:'00000000-0000-4000-8000-000000000014',release:'00000000-0000-4000-8000-000000000015'};
export const config=()=>({allowAcceptance:true,allowNegativeReviewProbe:true,origin:'https://releaseguard.example.test',allowedOrigins:['https://releaseguard.example.test'],runId,commit:'a'.repeat(40),image:'example.test/rg@sha256:'+'b'.repeat(64),workspace:'synthetic-workspace',authMode:'tokens'});
export function token(role,changes={}){return Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:'synthetic-'+role,principal:'synthetic-accountable-'+role,workspace:'synthetic-workspace',role,service:true,...changes})).toString('base64url')+'.'+'x'.repeat(43);}
export function fixtureDigest(v){const sorted=x=>Array.isArray(x)?x.map(sorted):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,sorted(x[k])])):x;return createHash('sha256').update(JSON.stringify(sorted(v))).digest('hex');}
export function apiFixture(options={}){
 const calls=[];let application,suite,input,posts=0,polls=0,evidence,job;
 const tokens={contributor:token('contributor'),viewer:token('viewer')};
 const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json'}});
 async function fetcher(url,init){
  const path=new URL(url).pathname,body=init.body?JSON.parse(init.body):undefined,bearer=init.headers.authorization?.slice(7),name=options.currentName?.();calls.push({url,path,method:init.method,body,key:init.headers['idempotency-key'],origin:init.headers.origin,redirect:init.redirect});
  if(options.throwAt===name)throw Error('SYNTHETIC_PRIVATE_DISCONNECT');
  if(options.failureAt===name)return json({error:'SYNTHETIC_PRIVATE_UPSTREAM'},options.status??503);
  if(path==='/auth/admin/')return new Response('<h1>Not Found</h1>',{status:404,headers:{'content-type':'text/html'}});
  if(bearer!==tokens.contributor&&bearer!==tokens.viewer)return json({error:'Invalid or expired identity'},401);
  if(init.method==='POST'&&init.headers.origin==='https://untrusted.invalid')return json({error:'Origin rejected'},403);
  if(path.endsWith('/review'))return json({error:'Human reviewer required'},403);
  if(init.method==='POST'&&bearer===tokens.viewer)return json({error:'Write role required'},403);
  if(path==='/api/v2/applications'){application=body;return json({id:ids.app,...body},201);}
  if(path==='/api/v2/suites'){suite=body;return json({id:ids.suite,version:1,...body},201);}
  if(path==='/api/v2/jobs'){
   posts++;if(posts===1)input=structuredClone(body);return json({id:options.duplicateOther&&posts===2?ids.app:ids.job,status:'queued',replayed:posts>1},posts===1?202:200);
  }
  if(path==='/api/v2/jobs/'+ids.job){
   job={id:ids.job,workspace:'synthetic-workspace',created_by:'synthetic-accountable-contributor',input:structuredClone(input),snapshot:{application:{id:ids.app,data:application},suite:{id:ids.suite,version:1,data:suite}},status:'succeeded',attempts:1,result:{score:100,gate:'passed',total:10,passed:10,errors:0,criticalFailures:0,results:suite.cases.map(c=>({caseId:c.id,status:'passed',output:'SYNTHETIC TEST ONLY',latencyMs:0}))}};
   polls++;if(polls<=(options.queued??0)){job.status='running';job.result=null;}if(options.observationPadding)job.diagnostic='X'.repeat(options.observationPadding);options.mutateJob?.(job);return json(job);
  }
  if(path==='/api/v2/releases'){
   const note=body.note;evidence={schemaVersion:'2.0',release:{id:ids.release,job_id:ids.job,workspace:'synthetic-workspace',created_by:job.created_by,requested_by:'synthetic-accountable-contributor',status:'pending',version:1,reviewed_by:null,reviewed_at:null,review_note:null,request_note:note,evidence:structuredClone(job)},audit:[{id:ids.suite,seq:'1',workspace:'synthetic-workspace',actor:'synthetic-contributor',action:'ReleaseRequested',entity_id:ids.release,details:{jobId:ids.job,note,previousJobId:null,previousReleaseId:null,evidenceDigest:fixtureDigest(job)}}],evidenceDigest:fixtureDigest(job),scope:'Rule evidence and human decision; no automatic external deployment or cryptographic provenance guarantee'};return json({id:ids.release,status:'pending',version:1},201);
  }
  if(path==='/api/v2/evidence/'+ids.release){const copy=structuredClone(evidence);options.mutateEvidence?.(copy,name);return json(copy);}
  throw Error('Unexpected synthetic API route');
 }
 return {tokens,calls,fetcher};
}
export function boundary(options={}){
 const events=[],observed=[],retained={},terminals=[];let clock=0,owned=false,used=false,currentName;
 const api=apiFixture({...options,currentName:()=>currentName}),c=config(),controller=new AbortController();
 const fault=(kind,n)=>{if(options.fail?.[0]===kind&&options.fail[1]===n)throw Error('SYNTHETIC_PRIVATE_FAILURE');};
 const io={signal:controller.signal,now:()=>clock,get reservationOwned(){return owned;},
  async reserve(){owned=false;events.push(['reserve']);if(used)throw Error('Already reserved');used=true;owned=true;fault('reserve',0);},
  async intent(n,v){events.push(['intent',n,v]);currentName=v.name;fault('intent',n);if(options.lateIntent===v.name)clock+=120001;if(options.abortAtIntent===n)controller.abort();},
  async result(n,v){events.push(['result',n,v]);fault('result',n);},
  async observed(n,v){events.push(['observed',n]);observed.push(structuredClone(v));fault('observed',n);},
  async fixture(){return structuredClone(fixture);},async authInputs(){events.push(['auth-inputs']);return structuredClone(api.tokens);},
  async authenticate(role,value){events.push(['authenticate',role]);fault('authenticate',role);return options.tokenChange?.(role)??value;},
  async request(origin,op,credentials,remaining,signal,allow){events.push(['request',op.name]);if(options.lateResponse===op.name)clock+=120001;return acceptanceRequest(origin,op,credentials,remaining,signal,api.fetcher,allow);},
  async sleep(ms){clock+=ms;events.push(['sleep']);},async retain(name,value){fault('retain',name);retained[name]=structuredClone(value);},
  async terminal(r){terminals.push(structuredClone(r));fault('terminal',0);if(options.lateTerminal)clock+=180001;},
 };return {c,io,events,observed,retained,terminals,api,controller};
}
