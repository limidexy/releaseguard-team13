import test from 'node:test';
import assert from 'node:assert/strict';
import { comparisonRequest } from '../scripts/comparison-http.mjs';
import { cloudRequest } from '../scripts/cloud-http.mjs';
const origin='https://comparison.example.test',token='INSECURE_SYNTHETIC_HTTP_ONLY',job='10000000-0000-4000-8000-000000000010';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
for(const op of [{method:'POST',route:'/applications',body:{name:'Synthetic'}},{method:'POST',route:'/suites',body:{cases:[]}},{method:'POST',route:'/jobs',key:'synthetic-key',body:{}},{method:'GET',route:'/jobs/'+job}])test('closed HTTP route uses actual /api/v2 prefix, bounded no-redirect transport: '+op.route,async()=>{
 let calls=0;const r=await comparisonRequest(origin,op,token,1000,undefined,async(url,init)=>{calls++;assert.equal(url,origin+'/api/v2'+op.route);assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');assert.equal(init.headers.authorization,'Bearer '+token);return json({synthetic:true},op.method==='GET'?200:201);});
 assert.equal(calls,1);assert.equal(r.code,'response_received');assert.deepEqual(JSON.parse(Buffer.from(r.rawEntityBase64,'base64')),r.body);
});
for(const op of [{method:'POST',route:'/releases',body:{}},{method:'POST',route:'/reviews',body:{}},{method:'POST',route:'/jobs/'+job,body:{}},{method:'DELETE',route:'/jobs/'+job},
 {method:'GET',route:'/jobs'},{method:'GET',route:'/jobs/'+job+'?token=bad'},{method:'GET',route:'/jobs/'+job,body:{}},{method:'POST',route:'/applications',originHeader:origin,body:{}}])test('comparison cannot dispatch review/admin/unlisted operation '+JSON.stringify(op),async()=>{
 let calls=0;await assert.rejects(comparisonRequest(origin,op,token,1000,undefined,async()=>{calls++;return json({});}));assert.equal(calls,0);
});
test('loopback is available only by comparison opt-in; existing cloud acceptance/smoke default remains HTTPS-only',async()=>{
 const local='http://127.0.0.1:34567',op={method:'GET',route:'/jobs/'+job};let calls=0;
 const fetcher=async()=>{calls++;return json({synthetic:true});};
 assert.equal((await cloudRequest(local,op,token,1000,undefined,fetcher)).networkEntered,false);
 assert.equal((await comparisonRequest(local,op,token,1000,undefined,fetcher)).code,'response_received');assert.equal(calls,1);
 for(const target of ['http://127.0.0.1:5193','http://localhost:34567','http://0.0.0.0:34567','http://127.0.0.1:80'])assert.equal((await comparisonRequest(target,op,token,1000,undefined,fetcher)).networkEntered,false);
 assert.equal(calls,1);
});
test('redirect/error/credential echo preserves a bounded observation but never follows or retries',async()=>{
 for(const [body,code]of [[json({echo:token}),'credential_echo_withheld'],[new Response(null,{status:302,headers:{location:'https://foreign.example.test'}}),'invalid_json']]){
  let calls=0;const r=await comparisonRequest(origin,{method:'GET',route:'/jobs/'+job},token,1000,undefined,async()=>{calls++;return body;});assert.equal(calls,1);assert.equal(r.code,code);
  if(code==='credential_echo_withheld'){assert.equal(r.rawEntityBase64,null);assert.equal(r.body,null);assert.equal(r.credentialEchoWithheld,true);assert.match(r.sha256,/^[a-f0-9]{64}$/);}
 }
});
test('deadline covers an uncooperative fetch and entire streamed body, with partial bytes unchanged',async()=>{
 const op={method:'GET',route:'/jobs/'+job};let calls=0;
 const hung=await comparisonRequest(origin,op,token,15,undefined,()=>{calls++;return new Promise(()=>{});});assert.equal(calls,1);assert.equal(hung.code,'deadline_exceeded');assert.equal(hung.networkEntered,true);
 const part=Buffer.from('{"incomplete":'),stream=new ReadableStream({start(c){c.enqueue(part);}}),r=await comparisonRequest(origin,op,token,15,undefined,async()=>new Response(stream,{headers:{'content-type':'application/json'}}));
 assert.equal(r.code,'deadline_exceeded');assert.equal(r.bodyComplete,false);assert.deepEqual(Buffer.from(r.rawEntityBase64,'base64'),part);
});
test('cancellation before dispatch sends zero; too-large response retains bounded prefix and stops',async()=>{
 const controller=new AbortController();controller.abort();let calls=0;const op={method:'GET',route:'/jobs/'+job};
 assert.equal((await comparisonRequest(origin,op,token,1000,controller.signal,async()=>{calls++;return json({});})).networkEntered,false);assert.equal(calls,0);
 const r=await comparisonRequest(origin,op,token,1000,undefined,async()=>new Response('x'.repeat(2*1024*1024+1),{headers:{'content-type':'application/json'}}));
 assert.equal(r.code,'response_too_large');assert.equal(r.decodedEntityBytes,2*1024*1024);assert.equal(r.bodyTruncated,true);assert.equal(Buffer.from(r.rawEntityBase64,'base64').length,2*1024*1024);
});
