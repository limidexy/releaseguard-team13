import test from 'node:test';
import assert from 'node:assert/strict';
import {benchmarkRequest} from '../scripts/cloud-benchmark-http.mjs';
import {cloudRequest} from '../scripts/cloud-http.mjs';
const origin='https://benchmark.example.test',token='INSECURE_SYNTHETIC_BENCHMARK_ONLY',id='20000000-0000-4000-8000-000000000001';
const payload={appId:id,suiteId:'20000000-0000-4000-8000-000000000002',candidate:'synthetic',commitRef:'1'.repeat(40),source:'replay'};
for(const offset of [0,25,50,75])test('actual bounded transport preserves original history limit25 offset'+offset+' and returned entity',async()=>{
 let seen;const r=await benchmarkRequest(origin,{method:'GET',route:'/jobs',offset},token,1000,undefined,async(url,init)=>{
  seen=url;assert.equal(init.method,'GET');assert.equal(init.redirect,'error');return new Response('[{"synthetic":true}]',{headers:{'content-type':'application/json'}});
 });
 assert.equal(seen,origin+'/api/v2/jobs?limit=25&offset='+offset);assert.equal(r.status,200);assert.deepEqual(r.body,[{synthetic:true}]);assert.equal(Buffer.from(r.rawEntityBase64,'base64').toString(),'[{"synthetic":true}]');
});
for(const op of [
 {method:'POST',route:'/jobs',key:'synthetic-0001',body:{...payload,source:'real'}},
 {method:'POST',route:'/jobs',key:'synthetic-0001',body:{...payload,source:'imported',outputs:[]}},
 {method:'POST',route:'/jobs',key:'synthetic-0001',body:{...payload,model:'any'}},
 {method:'POST',route:'/releases',body:{jobId:id}},
 {method:'GET',route:'/jobs',offset:100},
 {method:'GET',route:'/jobs',offset:'0&limit=999'},
 {method:'GET',route:'/jobs/'+id,offset:0}
])test('closed benchmark wrapper rejects non-original model/review/query route '+JSON.stringify(op),async()=>{
 let calls=0;await assert.rejects(benchmarkRequest(origin,op,token,1000,undefined,async()=>{calls++;}));assert.equal(calls,0);
});
test('replay POST uses unchanged payload/idempotency and a429 is retained once without retry',async()=>{
 let calls=0;const op={method:'POST',route:'/jobs',key:'synthetic-0001',body:payload};
 const r=await benchmarkRequest(origin,op,token,1000,undefined,async(url,init)=>{calls++;assert.equal(url,origin+'/api/v2/jobs');assert.equal(init.headers['idempotency-key'],'synthetic-0001');assert.deepEqual(JSON.parse(init.body),payload);return new Response('{"error":"quota"}',{status:429,headers:{'content-type':'application/json'}});});
 assert.equal(calls,1);assert.equal(r.status,429);assert.equal(r.code,'response_received');assert.deepEqual(r.body,{error:'quota'});
});
test('duplicate response keys preserve entity bytes but never become a validated job',async()=>{
 const r=await benchmarkRequest(origin,{method:'GET',route:'/jobs/'+id},token,1000,undefined,async()=>new Response('{"status":"failed","status":"succeeded"}',{headers:{'content-type':'application/json'}}));
 assert.equal(r.code,'ambiguous_or_invalid_json');assert.equal(r.body,null);assert.equal(Buffer.from(r.rawEntityBase64,'base64').toString(),'{"status":"failed","status":"succeeded"}');
});
test('known token echo is withheld, not printed or retained as raw response',async()=>{
 const r=await benchmarkRequest(origin,{method:'GET',route:'/jobs/'+id},token,1000,undefined,async()=>new Response(JSON.stringify({error:token}),{headers:{'content-type':'application/json'}}));
 assert.equal(r.credentialEchoWithheld,true);assert.equal(r.rawEntityBase64,null);assert.equal(r.body,null);
});
for(const op of [
 {method:'POST',route:'/api/v2/jobs',query:'limit=25&offset=0'},
 {method:'GET',route:'/api/v2/applications',query:'limit=25&offset=0'},
 {method:'GET',route:'/api/v2/jobs',query:'limit=250&offset=0'},
 {method:'GET',route:'/api/v2/jobs',query:'limit=25&offset=0#secret'},
 {method:'GET',route:'/api/v2/jobs',query:'limit=25&offset=0&token=secret'},
 {method:'GET',route:'/api/v2/jobs',query:{toString:()=> 'limit=25&offset=0'}}
])test('shared transport extension refuses query outside the exact original history contract '+JSON.stringify(op),async()=>{
 let calls=0;const r=await cloudRequest(origin,op,token,1000,undefined,async()=>{calls++;});assert.equal(calls,0);assert.equal(r.code,'invalid_request');
});
