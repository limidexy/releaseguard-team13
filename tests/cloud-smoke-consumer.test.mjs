// Actual registry handlers, job schema, support replay and evaluator. PostgreSQL,
// queue/admission, Worker and HTTPS remain synthetic; not a deployment/E2E claim.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { SignJWT } from 'jose';
import { runCloudReplaySmoke } from '../scripts/cloud-smoke-core.mjs';
import { smokeRequest } from '../scripts/cloud-smoke-http.mjs';
import { boundary,fixture,ids } from './fixtures/cloud-smoke-data.mjs';
net.Socket.prototype.connect=()=>{throw Error('Native TCP forbidden');};
globalThis.fetch=()=>{throw Error('Native fetch forbidden');};
const secret='INSECURE_TEST_ONLY_SMOKE_'+ 'x'.repeat(40);
Object.assign(process.env,{AUTH_MODE:'dev',ALLOW_DEV_AUTH:'true',AUTH_SECRET:secret,INTERNAL_SECRET:secret,SERVICE_ROLE:'support',SUBMISSION_CLOCK_SKEW_BOUND_MS:'0',RUNNER_ORIGINS:'http://support:8080',DATABASE_URL:'postgres://blocked:blocked@127.0.0.1:1/blocked'});delete process.env.AUTH_ISSUER;
const common=await import('../dist/src/common.js'),domain=await import('../dist/src/domain.js'),{registry}=await import('../dist/src/registry.js'),{support}=await import('../dist/src/support.js');
const sql=[];let application,suite;
const query=async(text,params)=>{sql.push({text,params});return {rows:[],rowCount:1};};
common.pool.query=query;common.pool.connect=async()=>({query,release(){}});
const assets=common.server(),runner=common.server();assets.log.level='silent';runner.log.level='silent';await registry(assets);await support(runner);
after(async()=>{await assets.close();await runner.close();await common.pool.end();});
const jwt=async(claims,issuer,aud)=>new SignJWT(claims).setProtectedHeader({alg:'HS256'}).setIssuer(issuer).setAudience(aud).setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(secret));
test('new smoke payloads pass the actual registry/schema/replay/evaluator consumers without a provider or database',async()=>{
 const auth=await jwt({sub:'synthetic-smoke',workspace:'synthetic-only',role:'contributor',service:true,principal:'synthetic-accountable'},'releaseguard-local','releaseguard');
 const internal=await jwt({caller:'worker'},'releaseguard-services','support');const b=boundary();b.io.authorize=async()=>auth;let input,requests=0;
 b.io.request=(origin,op,token,remaining,signal)=>smokeRequest(origin,op,token,remaining,signal,async(url,init)=>{
  requests++;assert.equal(init.redirect,'error');assert.equal(init.headers.authorization,'Bearer '+auth);let body,status;
  if(['applications','suites'].includes(op.path)){
   const r=await assets.inject({method:'POST',url:'/'+op.path,headers:init.headers,payload:JSON.parse(init.body)});status=r.statusCode;body=r.json();assert.equal(status,201);
   if(op.path==='applications')application={id:body.id,data:JSON.parse(init.body)};else suite={id:body.id,version:body.version,data:JSON.parse(init.body)};
  }else if(op.path==='jobs'){
   input=domain.jobSchema.parse(JSON.parse(init.body));assert.match(init.headers['idempotency-key'],/^[-a-zA-Z0-9_]{8,100}$/);status=202;body={id:ids.job,status:'queued',replayed:false};
  }else{
   const r=await runner.inject({method:'POST',url:'/execute',headers:{authorization:'Bearer '+internal},payload:{source:input.source,promptVersion:input.promptVersion,scenario:input.scenario,cases:suite.data.cases}});assert.equal(r.statusCode,200);const original=r.json();assert.equal(original.provenance.source,'replay');
   status=200;body={id:ids.job,input,snapshot:{application,suite},status:'succeeded',result:domain.evaluate(suite.data.cases,suite.data.policy,original.outputs)};
  }
  return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
 });
 const r=await runCloudReplaySmoke(b.c,b.io);assert.equal(r.passed,true);assert.equal(requests,4);assert.equal(b.retained.result.total,10);assert.equal(b.retained.result.gate,'passed');assert.equal(b.retained.result.results[0].output,'Unused products can be returned within 30 days with a receipt.');
 assert.deepEqual(domain.suiteSchema.parse(suite.data),fixture.suite);assert.equal(sql.filter(v=>v.text.startsWith('INSERT INTO applications')).length,1);assert.equal(sql.filter(v=>v.text.startsWith('INSERT INTO suites')).length,1);assert.equal(r.actualProviderCallsIndependentlyMeasured,false);
});
test('actual support failing replay remains blocked; smoke does not change evaluator rules',async()=>{
 const internal=await jwt({caller:'worker'},'releaseguard-services','support');const r=await runner.inject({method:'POST',url:'/execute',headers:{authorization:'Bearer '+internal},payload:{source:'replay',promptVersion:'v1',scenario:'failing',cases:fixture.suite.cases}});assert.equal(r.statusCode,200);const result=domain.evaluate(fixture.suite.cases,fixture.suite.policy,r.json().outputs);assert.equal(result.gate,'blocked');assert.ok(result.criticalFailures>0);assert.ok(result.score<95);
});
