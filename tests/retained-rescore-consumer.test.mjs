// Actual JWT/registry/Worker imported branch/evaluator. PostgreSQL, admission,
// AMQP and HTTPS/OIDC are controlled boundaries; not live deployment/E2E proof.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import amqp from 'amqplib';
import { SignJWT } from 'jose';
import { runRetainedRescore } from '../scripts/retained-rescore-core.mjs';
import { retainedRequest } from '../scripts/retained-rescore-http.mjs';
import { boundary,config,retainedSource,runtime,id } from './fixtures/retained-rescore-data.mjs';
net.Socket.prototype.connect=()=>{throw Error('Native TCP forbidden');};net.Server.prototype.listen=()=>{throw Error('Native listener forbidden');};
let runnerRequests=0;globalThis.fetch=()=>{runnerRequests++;throw Error('Support/provider/target fetch forbidden');};
const secret='INSECURE_RETAINED_CONSUMER_'+'x'.repeat(40);
Object.assign(process.env,{AUTH_MODE:'dev',ALLOW_DEV_AUTH:'true',AUTH_SECRET:secret,INTERNAL_SECRET:secret,SERVICE_ROLE:'worker',SUBMISSION_CLOCK_SKEW_BOUND_MS:'0',
 DATABASE_URL:'postgres://blocked:blocked@127.0.0.1:1/blocked',AMQP_URL:'amqp://blocked:blocked@127.0.0.1:1',RUNNER_ORIGINS:'http://support:8080'});delete process.env.AUTH_ISSUER;
const common=await import('../dist/src/common.js'),{registry}=await import('../dist/src/registry.js'),{worker}=await import('../dist/src/worker.js');
let consume,activeSource;const jobs=new Map(),sql=[],acks=[];
const channel={assertQueue:async()=>{},prefetch:async()=>{},consume:async(_name,fn)=>{consume=fn;},ack:msg=>acks.push(JSON.parse(msg.content).jobId)};
const originalConnect=amqp.connect;amqp.connect=async()=>Object.assign(new EventEmitter(),{createConfirmChannel:async()=>channel});
const query=async(text,params=[])=>{
 sql.push({text,params});let rows=[];
 if(text==='SELECT version FROM suites WHERE id=$1 AND workspace=$2'){assert.equal(params[0],activeSource.suiteId);assert.equal(params[1],'synthetic-workspace');rows=[{version:7}];}
 else if(text.includes('RETURNING *')){const j=jobs.get(params[0]);assert.ok(j,'Only newly imported jobs can be claimed');j.status='running';j.lease_id=params[1];rows=[structuredClone(j)];}
 else if(text.includes("SET status='succeeded'")){const j=jobs.get(params[0]);assert.ok(j);assert.equal(j.lease_id,params[1]);j.status='succeeded';j.result=structuredClone(params[2]);j.execution=structuredClone(params[3]);}
 else if(text.startsWith('UPDATE jobs'))throw Error('Unexpected Worker failure or original-row update');
 else assert.ok(text.startsWith('CREATE TABLE')||text.startsWith('INSERT INTO suites')||['BEGIN','COMMIT','ROLLBACK'].includes(text),'Unexpected SQL boundary');
 return {rows,rowCount:rows.length};
};
common.pool.query=query;common.pool.connect=async()=>({query,release(){}});
const assets=common.server(),workerApp=common.server();assets.log.level='silent';workerApp.log.level='silent';await registry(assets);await worker(workerApp);
after(async()=>{await assets.close();await workerApp.close();await common.pool.end();amqp.connect=originalConnect;});
for(const [revision,withError]of [['v2.1',false],['v2.2',false],['v2.2',true]])test('actual imported Worker '+revision+' preserves outputs'+(withError?' and original execution error':'')+' without any runner dispatch',async()=>{
 jobs.clear();const source=retainedSource();if(withError){source.runs[0].result.results[0].status='error';source.runs[0].result.results[0].reason='Original provider failure';}
 activeSource=source;const b=boundary(config({suiteRevision:revision}),source);let child,submitted=0;
 const token=await new SignJWT({sub:'synthetic-retained-service',principal:'synthetic-accountable',service:true,workspace:b.c.workspace,role:'contributor'})
  .setProtectedHeader({alg:'HS256'}).setIssuer('releaseguard-local').setAudience('releaseguard').setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(secret));
 b.io.authenticate=async()=>token;
 b.io.request=(origin,op,credential,remaining,signal,secrets)=>retainedRequest(origin,op,credential,remaining,signal,async(url,init)=>{
  assert.equal(url,origin+'/api/v2'+op.route);let body,status=200;
  const old=source.runs.find(j=>'/jobs/'+j.id===op.route);
  if(old){assert.equal(init.method,'GET');body=structuredClone(old);}
  else if(op.route==='/suites'){
   const r=await assets.inject({method:'POST',url:'/suites',headers:init.headers,payload:JSON.parse(init.body)});assert.equal(r.statusCode,201);status=201;body=r.json();child={id:body.id,version:body.version,data:JSON.parse(init.body)};
  }else if(op.route==='/jobs'){
   const input=runtime.domain.jobSchema.parse(JSON.parse(init.body));assert.equal(input.source,'imported');const j={id:id(20+submitted++),workspace:b.c.workspace,input,status:'queued',attempts:1,
    snapshot:{application:structuredClone(source.runs[0].snapshot.application),suite:structuredClone(child)}};jobs.set(j.id,j);body={id:j.id,status:'queued',replayed:false};status=202;
  }else{
   const j=jobs.get(op.route.slice('/jobs/'.length));assert.ok(j);await consume({content:Buffer.from(JSON.stringify({jobId:j.id}))});body=structuredClone(j);
  }
  return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
 },secrets);
 const r=await runRetainedRescore(b.c,b.io,runtime);assert.equal(r.status,'completed');assert.equal(submitted,2);assert.equal(runnerRequests,0);assert.equal(r.report.originalJobsUnchangedObserved,true);
 assert.equal(r.report.runs[0].importedJob.result.total,10);assert.equal(r.report.runs[0].importedJob.result.score,withError?90:100);assert.equal(r.report.runs[0].importedJob.result.errors,withError?1:0);
 assert.deepEqual(r.report.runs[0].importedJob.result.results.map(x=>x.output),source.runs[0].result.results.map(x=>x.output));
 assert.equal(r.report.runs.every(s=>s.importedJob.execution.provenance.source==='imported'),true);assert.deepEqual(acks.slice(-2),[id(20),id(21)]);
});
