import test from 'node:test';
import assert from 'node:assert/strict';
import { retainedRequest } from '../scripts/retained-rescore-http.mjs';
const origin='https://retained.example.test',token='INSECURE_HTTP_ONLY',id='20000000-0000-4000-8000-000000000010';
const json=v=>new Response(JSON.stringify(v),{headers:{'content-type':'application/json'}});
for(const op of [{method:'GET',route:'/jobs/'+id},{method:'POST',route:'/suites',body:{parentId:id}},{method:'POST',route:'/jobs',key:'synthetic-key',body:{source:'imported',outputs:[]}}])test('closed native route '+op.route+' uses actual prefix and never follows/retries',async()=>{
 let calls=0;const r=await retainedRequest(origin,op,token,1000,undefined,async(url,init)=>{calls++;assert.equal(url,origin+'/api/v2'+op.route);assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');assert.equal(init.headers.authorization,'Bearer '+token);return json({synthetic:true});});
 assert.equal(calls,1);assert.equal(r.code,'response_received');assert.deepEqual(JSON.parse(Buffer.from(r.rawEntityBase64,'base64')),r.body);
});
for(const op of [
 {method:'POST',route:'/jobs',key:'synthetic-key',body:{source:'real',outputs:[]}},{method:'POST',route:'/jobs',key:'synthetic-key',body:{source:'replay',outputs:[]}},
 {method:'POST',route:'/jobs',key:'synthetic-key',body:{source:'imported',outputs:Array(11).fill({})}},{method:'POST',route:'/suites',body:{}},
 {method:'GET',route:'/applications'},{method:'POST',route:'/applications',body:{}},{method:'POST',route:'/releases',body:{}},{method:'POST',route:'/releases/'+id+'/review',body:{}},
 {method:'DELETE',route:'/jobs/'+id},{method:'GET',route:'/jobs/'+id,body:{}},{method:'GET',route:'/jobs/'+id+'?workspace=foreign'},
])test('refuses model-capable/unlisted operation before fetch '+JSON.stringify(op),async()=>{
 let calls=0;await assert.rejects(retainedRequest(origin,op,token,1000,undefined,async()=>{calls++;return json({});}));assert.equal(calls,0);
});
test('ambiguous duplicate response keys stay raw evidence, never a passing parsed response',async()=>{
 const raw='{"workspace":"foreign","workspace":"synthetic"}',r=await retainedRequest(origin,{method:'GET',route:'/jobs/'+id},token,1000,undefined,async()=>new Response(raw,{headers:{'content-type':'application/json'}}));
 assert.equal(r.status,200);assert.equal(r.code,'ambiguous_or_invalid_json');assert.equal(r.body,null);assert.equal(Buffer.from(r.rawEntityBase64,'base64').toString(),raw);
});
test('HTTP, pre-cancelled signal and known credential echo cannot enter a follow-up request',async()=>{
 let calls=0;const op={method:'GET',route:'/jobs/'+id},fetcher=async()=>{calls++;return json({});},signal=new AbortController();signal.abort();
 assert.equal((await retainedRequest('http://127.0.0.1:5193',op,token,1000,undefined,fetcher)).networkEntered,false);
 assert.equal((await retainedRequest(origin,op,token,1000,signal.signal,fetcher)).networkEntered,false);assert.equal(calls,0);
 const echo=await retainedRequest(origin,op,token,1000,undefined,async()=>json({echo:'INSECURE_SELECTED_SECRET'}),['INSECURE_SELECTED_SECRET']);
 assert.equal(echo.code,'credential_echo_withheld');assert.equal(echo.rawEntityBase64,null);assert.equal(echo.body,null);
});
test('whole-response deadline includes a stuck body; partial bytes/status are retained',async()=>{
 const op={method:'GET',route:'/jobs/'+id},part=new TextEncoder().encode('{"partial":'),stream=new ReadableStream({start(c){c.enqueue(part);}});
 const r=await retainedRequest(origin,op,token,15,undefined,async()=>new Response(stream,{headers:{'content-type':'application/json'}}));
 assert.equal(r.code,'deadline_exceeded');assert.equal(r.status,200);assert.equal(r.bodyComplete,false);assert.deepEqual(Buffer.from(r.rawEntityBase64,'base64'),Buffer.from(part));
});
