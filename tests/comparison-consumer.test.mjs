// Actual registry/auth/support replay/domain consumers. Admission, DB, queue,
// Worker and network/TLS are fake boundaries: this is NOT deployment acceptance.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { SignJWT } from 'jose';
import { runComparison } from '../scripts/comparison-core.mjs';
import { comparisonRequest } from '../scripts/comparison-http.mjs';
import { boundary,config,runtime,id } from './fixtures/comparison-data.mjs';
net.Socket.prototype.connect=()=>{throw Error('Native TCP forbidden');};net.Server.prototype.listen=()=>{throw Error('Native listener forbidden');};
globalThis.fetch=()=>{throw Error('Provider/target fetch forbidden');};
const secret='INSECURE_SYNTHETIC_COMPARISON_'+'x'.repeat(40);
Object.assign(process.env,{AUTH_MODE:'dev',ALLOW_DEV_AUTH:'true',AUTH_SECRET:secret,INTERNAL_SECRET:secret,SERVICE_ROLE:'support',SUBMISSION_CLOCK_SKEW_BOUND_MS:'0',RUNNER_ORIGINS:'http://support:8080',DATABASE_URL:'postgres://blocked:blocked@127.0.0.1:1/blocked'});delete process.env.AUTH_ISSUER;
const common=await import('../dist/src/common.js'),{registry}=await import('../dist/src/registry.js'),{support}=await import('../dist/src/support.js');
const sql=[];const query=async(text,params)=>{assert.ok(text.startsWith('CREATE TABLE')||text.startsWith('INSERT INTO applications')||text.startsWith('INSERT INTO suites')||['BEGIN','COMMIT','ROLLBACK'].includes(text));sql.push({text,params});return {rows:[],rowCount:1};};
common.pool.query=query;common.pool.connect=async()=>({query,release(){}});
const assets=common.server(),runner=common.server();assets.log.level='silent';runner.log.level='silent';await registry(assets);await support(runner);
after(async()=>{await assets.close();await runner.close();await common.pool.end();});
const jwt=async(claims,issuer,audience)=>new SignJWT(claims).setProtectedHeader({alg:'HS256'}).setIssuer(issuer).setAudience(audience).setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(secret));
for(const revision of ['legacy','v2.1','v2.2'])test('complete comparison '+revision+' drives actual two prompt replay/evaluator handlers without model or database',async()=>{
 const b=boundary(config({suiteRevision:revision})),auth=await jwt({sub:'comparison-local-test',workspace:b.c.workspace,role:'contributor'},'releaseguard-local','releaseguard'),internal=await jwt({caller:'worker'},'releaseguard-services','support');
 b.io.authenticate=async()=>auth;let application,suite;const jobs=[];
 b.io.request=(origin,op,token,remaining,signal,secrets)=>comparisonRequest(origin,op,token,remaining,signal,async(url,init)=>{
  assert.equal(url,origin+'/api/v2'+op.route);let body,status;
  if(['/applications','/suites'].includes(op.route)){
   const response=await assets.inject({method:'POST',url:op.route,headers:init.headers,payload:JSON.parse(init.body)});status=response.statusCode;body=response.json();assert.equal(status,201);
   if(op.route==='/applications')application={id:body.id,data:JSON.parse(init.body)};else suite={id:body.id,version:body.version,data:JSON.parse(init.body)};
  }else if(op.route==='/jobs'){
   const input=runtime.domain.jobSchema.parse(JSON.parse(init.body));jobs.push({id:id(10+jobs.length),input});body={id:jobs.at(-1).id,status:'queued',replayed:false};status=202;
  }else{
   const job=jobs.find(j=>'/jobs/'+j.id===op.route);assert.ok(job);const response=await runner.inject({method:'POST',url:'/execute',headers:{authorization:'Bearer '+internal},payload:{source:job.input.source,promptVersion:job.input.promptVersion,scenario:job.input.scenario,cases:suite.data.cases}});
   assert.equal(response.statusCode,200);const original=response.json();body={...job,workspace:b.c.workspace,snapshot:{application,suite},status:'succeeded',attempts:1,
    result:runtime.domain.evaluate(suite.data.cases,suite.data.policy,original.outputs),execution:{provenance:original.provenance}};status=200;
  }
  return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
 },secrets);
 const r=await runComparison(b.c,b.io,runtime);assert.equal(r.status,'completed');assert.deepEqual(jobs.map(j=>j.input.promptVersion),['v1','v2']);
 assert.equal(r.report.runs.every(j=>j.result.score===100&&j.result.total===10&&j.execution.provenance.source==='replay'),true);
 assert.equal(r.report.runs[0].result.results[0].output,'Unused products can be returned within 30 days with a receipt.');assert.deepEqual(r.report.runs[0].result.results.map(r=>r.output),r.report.runs[1].result.results.map(r=>r.output));
 assert.equal(r.modelRequestsReserved,0);assert.equal(r.report.semanticConclusion.startsWith('NOT_ASSESSED'),true);assert.equal(sql.some(q=>q.text.startsWith('UPDATE')),false);
});
