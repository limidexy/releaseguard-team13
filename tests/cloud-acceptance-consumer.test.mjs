// Actual JWT/registry/Governance/gateway origin guard and evaluator consumers.
// PostgreSQL, admission/queue/Worker, TLS/OIDC and edge admin are synthetic.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { SignJWT,jwtVerify } from 'jose';
import { runCloudAcceptance } from '../scripts/cloud-acceptance-core.mjs';
import { acceptanceRequest } from '../scripts/cloud-acceptance-http.mjs';
import { boundary,fixture,ids } from './fixtures/cloud-acceptance-data.mjs';
net.Socket.prototype.connect=()=>{throw Error('Native TCP forbidden');};
const secret='INSECURE_TEST_ONLY_ACCEPTANCE_'+ 'x'.repeat(40);
Object.assign(process.env,{AUTH_MODE:'dev',ALLOW_DEV_AUTH:'true',AUTH_SECRET:secret,INTERNAL_SECRET:secret,SERVICE_ROLE:'governance',SUBMISSION_CLOCK_SKEW_BOUND_MS:'0',RUNNER_ORIGINS:'http://support:8080',DATABASE_URL:'postgres://blocked:blocked@127.0.0.1:1/blocked',EVALUATION_URL:'http://evaluation.synthetic',PUBLIC_ORIGIN:'https://releaseguard.example.test'});delete process.env.AUTH_ISSUER;
const common=await import('../dist/src/common.js'),domain=await import('../dist/src/domain.js'),{registry}=await import('../dist/src/registry.js'),{governance}=await import('../dist/src/governance.js'),{gateway}=await import('../dist/src/gateway.js');
const sql=[];let job,release,audits=[],application,suite,input;
const query=async(text,values=[])=>{
 sql.push({text,values});let rows=[];
 if(text.startsWith('INSERT INTO releases'))release={id:values[0],workspace:values[1],job_id:values[2],created_by:values[3],requested_by:values[4],evidence:structuredClone(values[5]),request_note:values[6],previous_release_id:values[7],status:'pending',version:1,review_note:null,reviewed_by:null,reviewed_at:null,created_at:'2026-10-27T00:00:00.000Z'};
 else if(text.startsWith('INSERT INTO audit'))audits.push({seq:String(audits.length+1),id:values[0],workspace:values[1],actor:values[2],action:values[3],entity_id:values[4],details:structuredClone(values[5]),created_at:'2026-10-27T00:00:00.000Z'});
 else if(text==='SELECT * FROM releases WHERE id=$1 AND workspace=$2')rows=release?.id===values[0]&&release.workspace===values[1]?[structuredClone(release)]:[];
 else if(text==='SELECT * FROM audit WHERE entity_id=$1 AND workspace=$2 ORDER BY seq')rows=audits.filter(a=>a.entity_id===values[0]&&a.workspace===values[1]).map(a=>structuredClone(a));
 else assert.ok(text.startsWith('CREATE TABLE')||text.startsWith('INSERT INTO applications')||text.startsWith('INSERT INTO suites')||['BEGIN','COMMIT','ROLLBACK'].includes(text),'Unexpected SQL boundary: '+text);
 return {rows,rowCount:rows.length};
};
common.pool.query=query;common.pool.connect=async()=>({query,release(){}});
globalThis.fetch=async url=>{assert.equal(url,'http://evaluation.synthetic/internal/jobs/'+ids.job+'?workspace=synthetic-workspace');return new Response(JSON.stringify(job),{headers:{'content-type':'application/json'}});};
const assets=common.server(),reviews=common.server(),edge=common.server();for(const app of [assets,reviews,edge])app.log.level='silent';await registry(assets);await governance(reviews);await gateway(edge);after(async()=>{for(const app of [assets,reviews,edge])await app.close();await common.pool.end();});
const outputs=[
 ['eligibility','Unused products can be returned within 30 days with a receipt.'],['receipt','Please provide a receipt or order reference before eligibility can be checked.'],['damaged','For damaged items, escalate to a human support agent with photographs.'],['expired','After 30 days, standard returns are not eligible; a human agent can review exceptions.'],['privacy','Do not send passwords or full payment card numbers. Use the secure support channel.'],['action','I cannot issue a refund or change an order. A human agent must approve any action.'],['missing','Please provide purchase date, product condition and proof of purchase.'],['escalation','Contact a human support agent for disputed or exceptional cases.'],['format','{"eligible":false,"reason":"More information required","nextStep":"Contact support"}'],['greeting','Hello. I can explain the fictional returns policy and help you contact support.'],
].map(([caseId,output])=>({caseId,output,latencyMs:0}));
test('full acceptance drives real auth/registry/review handlers and leaves exactly one pending request/audit, never an approval',async()=>{
 const jwt=async role=>new SignJWT({sub:'synthetic-'+role,principal:'synthetic-accountable-'+role,workspace:'synthetic-workspace',role,service:true}).setProtectedHeader({alg:'HS256'}).setIssuer('releaseguard-local').setAudience('releaseguard').setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(secret));
 const selected={contributor:await jwt('contributor'),viewer:await jwt('viewer')},b=boundary();b.io.authenticate=async role=>selected[role];let posts=0;
 globalThis.fetch=async(url,options)=>{assert.equal(url,'http://evaluation.synthetic/internal/jobs/'+ids.job+'?workspace=synthetic-workspace');const {payload}=await jwtVerify(options.headers.authorization.slice(7),new TextEncoder().encode(secret),{issuer:'releaseguard-services',audience:'evaluation',algorithms:['HS256']});assert.equal(payload.caller,'governance');return new Response(JSON.stringify(job),{headers:{'content-type':'application/json'}});};
 b.io.request=(origin,op,credentials,remaining,signal,allow)=>acceptanceRequest(origin,op,credentials,remaining,signal,async(url,init)=>{
  let response;
  if(op.name==='crossOrigin')response=await edge.inject({method:'POST',url:'/api/v2/applications',headers:init.headers,payload:JSON.parse(init.body)});
  else if(op.path==='applications'||op.path==='suites'){
   response=await assets.inject({method:init.method,url:'/'+op.path,headers:init.headers,...(init.body?{payload:JSON.parse(init.body)}:{})});
   if(op.name==='application'){const v=response.json();application={id:v.id,data:JSON.parse(init.body)};}
   if(op.name==='suite'){const v=response.json();suite={id:v.id,version:v.version,data:JSON.parse(init.body)};}
  }else if(op.path==='jobs'){
   const parsed=domain.jobSchema.parse(JSON.parse(init.body));posts++;if(posts===1)input=parsed;else assert.deepEqual(parsed,input);
   return new Response(JSON.stringify({id:ids.job,status:'queued',replayed:posts===2}),{status:posts===1?202:200,headers:{'content-type':'application/json'}});
  }else if(op.name==='observe'){
   job={id:ids.job,workspace:'synthetic-workspace',created_by:'synthetic-accountable-contributor',input,snapshot:{application,suite},status:'succeeded',attempts:1,result:domain.evaluate(suite.data.cases,suite.data.policy,outputs)};return new Response(JSON.stringify(job),{headers:{'content-type':'application/json'}});
  }else if(op.name==='admin')return new Response('Synthetic edge404 only; not Caddy acceptance',{status:404});
  else response=await reviews.inject({method:init.method,url:'/'+op.path,headers:init.headers,...(init.body?{payload:JSON.parse(init.body)}:{})});
  return new Response(response.body,{status:response.statusCode,headers:{'content-type':response.headers['content-type']}});
 },allow);
 const r=await runCloudAcceptance(b.c,b.io);assert.equal(r.passed,true);assert.equal(r.checks.length,9);assert.equal(release.status,'pending');assert.equal(release.reviewed_by,null);assert.equal(release.version,1);assert.equal(audits.length,1);assert.equal(audits[0].action,'ReleaseRequested');assert.deepEqual(b.retained['before.json'],b.retained['after.json']);assert.equal(sql.some(s=>s.text.startsWith('UPDATE')),false);assert.equal(posts,2);assert.equal(r.humanApproval,false);assert.equal(r.modelCallsRequested,0);assert.equal(common.digest(job),b.retained['before.json'].evidenceDigest);
});
