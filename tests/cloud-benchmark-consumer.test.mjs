// Actual registry/auth/Worker/replay/evaluator and evaluation GET consumers.
// Admission, SQL, AMQP, Pod scheduling and time are fake. No deployment, load,
// cloud, external TLS/OIDC, PostgreSQL or maximum-capacity claim.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import os from 'node:os';
import {EventEmitter} from 'node:events';
import {Worker} from 'node:worker_threads';
import {SignJWT} from 'jose';
import amqp from 'amqplib';
import {runPairedBenchmark} from '../scripts/cloud-benchmark-core.mjs';
import {benchmarkRequest} from '../scripts/cloud-benchmark-http.mjs';
import {protocolBoundary} from './fixtures/cloud-benchmark-protocol.mjs';
net.Socket.prototype.connect=()=>{throw Error('Native TCP forbidden');};net.Server.prototype.listen=()=>{throw Error('Native listener forbidden');};
const secret='INSECURE_BENCHMARK_CONSUMER_'+'x'.repeat(40);
Object.assign(process.env,{AUTH_MODE:'dev',ALLOW_DEV_AUTH:'true',AUTH_SECRET:secret,INTERNAL_SECRET:secret,SERVICE_ROLE:'worker',SUBMISSION_CLOCK_SKEW_BOUND_MS:'0',
 DATABASE_URL:'postgres://blocked:blocked@127.0.0.1:1/blocked',AMQP_URL:'amqp://blocked:blocked@127.0.0.1:1',RUNNER_ORIGINS:'http://support:8080'});delete process.env.AUTH_ISSUER;
const common=await import('../dist/src/common.js'),domain=await import('../dist/src/domain.js'),{registry}=await import('../dist/src/registry.js'),{evaluation}=await import('../dist/src/evaluation.js'),{worker}=await import('../dist/src/worker.js');
const jobs=new Map(),consumers=new Map(),apps=[],sql=[],acks=[],originalConnect=amqp.connect,originalHostname=os.hostname;let initializing;
amqp.connect=async()=>Object.assign(new EventEmitter(),{createConfirmChannel:async()=>{const name=initializing;return {
 assertQueue:async()=>{},prefetch:async()=>{},consume:async(_q,fn)=>{assert.ok(name);consumers.set(name,fn);},ack:msg=>acks.push(JSON.parse(msg.content).jobId),waitForConfirms:async()=>{},close:async()=>{},sendToQueue:()=>{throw Error('Background publication not part of this fixture');}
 };}});
const query=async(text,values=[])=>{
 sql.push({text,values});let rows=[];
 if(text.includes("status='running'")&&text.includes('RETURNING *')){const j=jobs.get(values[0]);assert.ok(j);assert.equal(j.status,'queued');j.status='running';j.lease_id=values[1];j.worker_id=values[3];j.started_at='2026-10-11T00:00:00.010Z';j.attempts++;rows=[structuredClone(j)];}
 else if(text.includes("SET status='succeeded'")){const j=jobs.get(values[0]);assert.ok(j);assert.equal(j.lease_id,values[1]);j.status='succeeded';j.result=structuredClone(values[2]);j.execution=structuredClone(values[3]);j.finished_at='2026-10-11T00:00:00.030Z';}
 else if(text.startsWith('SELECT id,workspace,created_by,input,snapshot,status,result,execution')){const j=jobs.get(values[0]);rows=j?.workspace===values[1]?[structuredClone(j)]:[];}
 else if(text.startsWith('SELECT id,status,created_by,created_at')){assert.equal(values[0],'synthetic-workspace');assert.equal(values[1],25);assert.equal([0,25,50,75].includes(values[2]),true);rows=[...jobs.values()].slice(values[2],values[2]+values[1]).map(j=>({id:j.id,status:j.status,worker_id:j.worker_id,candidate:j.input.candidate,source:j.input.source,gate:j.result?.gate??null}));}
 else assert.ok(text.startsWith('CREATE TABLE')||text.startsWith('INSERT INTO applications')||text.startsWith('INSERT INTO suites')||text.startsWith('SELECT id,job_id FROM outbox')||text.startsWith("UPDATE jobs SET status='queued'")||['BEGIN','COMMIT','ROLLBACK'].includes(text),'Unexpected SQL boundary: '+text);
 return {rows,rowCount:rows.length};
};
common.pool.query=query;common.pool.connect=async()=>({query,release(){}});
const assets=common.server(),observations=common.server();assets.log.level='silent';observations.log.level='silent';await registry(assets);await evaluation(observations);apps.push(assets,observations);
const thread=new Worker(new URL('./fixtures/cloud-benchmark-support-thread.mjs',import.meta.url),{workerData:{fixture:'cloud-benchmark-support',secret}}),pending=new Map();let messageId=0;
const ready=new Promise((resolve,reject)=>{thread.on('message',m=>{if(m.ready)resolve();else{const p=pending.get(m.id);if(p){pending.delete(m.id);p.resolve(m);}}});thread.on('error',e=>{reject(e);for(const p of pending.values())p.reject(e);pending.clear();});});await ready;
globalThis.fetch=async(url,init)=>{
 assert.equal(url,'http://support:8080/execute');const id=++messageId;
 const response=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('Owned support thread deadline'));},5000);pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});thread.postMessage({id,headers:init.headers,payload:JSON.parse(init.body)});});
 return new Response(response.body,{status:response.status,headers:{'content-type':'application/json'}});
};
after(async()=>{for(const app of apps)await app.close();await common.pool.end();await thread.terminate();amqp.connect=originalConnect;os.hostname=originalHostname;});
test('full paired tool consumes100actual Worker/replay executions and800actual workspace-scoped history handlers',async()=>{
 const b=protocolBoundary(),token=await new SignJWT({sub:'synthetic-benchmark-service',principal:'synthetic-principal',service:true,workspace:b.c.workspace,role:'contributor'})
  .setProtectedHeader({alg:'HS256'}).setIssuer('releaseguard-local').setAudience('releaseguard').setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(secret));
 b.io.authorize=async()=>token;const oldTarget=b.io.target;b.io.target=async()=>{const t=await oldTarget();return {...t,async scale(n){const ready=await t.scale(n);
  for(const name of ready.workerIds)if(!consumers.has(name)){initializing=name;os.hostname=()=>name;const app=common.server();app.log.level='silent';apps.push(app);await worker(app);}
  os.hostname=originalHostname;return ready;
 }};};
 const applications=new Map(),suites=new Map();let submitted=0;
 b.io.request=(origin,op,auth,timeout,signal)=>benchmarkRequest(origin,op,auth,timeout,signal,async(url,init)=>{
  b.f.advance(1);assert.equal(init.headers.authorization,'Bearer '+token);let response;
  if(['/applications','/suites'].includes(op.route)){
   response=await assets.inject({method:'POST',url:op.route,headers:init.headers,payload:JSON.parse(init.body)});assert.equal(response.statusCode,201);const value=response.json();
   if(op.route==='/applications')applications.set(value.id,{id:value.id,data:JSON.parse(init.body)});else suites.set(value.id,{id:value.id,version:value.version,data:JSON.parse(init.body)});
  }else if(op.route==='/jobs'&&op.method==='POST'){
   const input=domain.jobSchema.parse(JSON.parse(init.body)),id=common.uuid();assert.equal(input.source,'replay');submitted++;
   jobs.set(id,{id,workspace:b.c.workspace,created_by:'synthetic-principal',input,status:'queued',attempts:0,created_at:'2026-10-11T00:00:00.000Z',started_at:null,finished_at:null,worker_id:null,
    snapshot:{application:structuredClone(applications.get(input.appId)),suite:structuredClone(suites.get(input.suiteId))}});
   return new Response(JSON.stringify({id,status:'queued',replayed:false}),{status:202,headers:{'content-type':'application/json'}});
  }else{
   if(op.route!=='/jobs'){const job=jobs.get(op.route.slice(6));assert.ok(job);if(job.status==='queued'){const pods=b.f.state.pods.items;const name=pods[[...jobs.keys()].indexOf(job.id)%pods.length].metadata.name;await consumers.get(name)({content:Buffer.from(JSON.stringify({jobId:job.id}))});}}
   response=await observations.inject({method:'GET',url:op.route+(op.offset!==undefined?'?limit=25&offset='+op.offset:''),headers:init.headers});assert.equal(response.statusCode,200);
  }
  return new Response(response.body,{status:response.statusCode,headers:{'content-type':response.headers['content-type']}});
 });
 const r=await runPairedBenchmark(b.c,b.io);assert.equal(r.passed,true,JSON.stringify(r.errors));assert.equal(submitted,100);assert.equal(acks.length,100);assert.equal(messageId,100);
 assert.equal([...jobs.values()].every(j=>j.status==='succeeded'&&j.result.score===100&&j.result.total===10&&j.execution.provenance.source==='replay'),true);
 assert.equal([...jobs.values()][0].result.results[0].output,'Unused products can be returned within 30 days with a receipt.');assert.equal(r.summaries[1].rows.every(j=>r.stages[1].targetBefore.workerIds.includes(j.workerId)),true);
 assert.equal(sql.filter(q=>q.text.startsWith('SELECT id,status,created_by,created_at')).length,800);assert.equal(sql.filter(q=>q.text.includes('RETURNING *')).length,100);assert.equal(sql.some(q=>q.text.includes('releases')),false);
 assert.equal(r.actualProviderCallsIndependentlyMeasured,false);assert.equal(r.automaticScalingBenefitProven,false);assert.equal(r.maximumCapacityProven,false);
});
