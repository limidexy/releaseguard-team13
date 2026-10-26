import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { smokeRequest } from '../scripts/cloud-smoke-http.mjs';
import { token,ids } from './fixtures/cloud-smoke-data.mjs';
net.Socket.prototype.connect=()=>{throw Error('Native TCP forbidden');};
globalThis.fetch=()=>{throw Error('Native fetch forbidden');};
const target='https://releaseguard.example.test',op={path:'jobs',method:'POST',key:'synthetic-unique',body:{source:'replay'}},json=v=>new Response(JSON.stringify(v),{headers:{'content-type':'application/json'}});
const request=(f,options={})=>smokeRequest(options.origin??target,options.op??op,options.token??token,options.ms??1000,options.signal,f);
test('actual request serialization is HTTPS JSON, no redirect/cache, one bearer and unchanged status/entity bytes',async()=>{
 let n=0;const value={id:ids.job,status:'queued'},r=await request(async(url,init)=>{n++;assert.equal(url,target+'/api/v2/jobs');assert.equal(init.method,'POST');assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');assert.equal(init.headers.authorization,'Bearer '+token);assert.equal(init.headers['idempotency-key'],'synthetic-unique');assert.deepEqual(JSON.parse(init.body),op.body);return new Response(JSON.stringify(value),{status:202,headers:{'content-type':'application/json'}});});
 assert.equal(n,1);assert.equal(r.status,202);assert.equal(r.code,'response_received');assert.deepEqual(r.body,value);const raw=Buffer.from(r.rawEntityBase64,'base64');assert.equal(raw.toString(),JSON.stringify(value));assert.equal(r.decodedEntityBytes,raw.length);assert.equal(r.sha256,createHash('sha256').update(raw).digest('hex'));assert.equal(JSON.stringify(r).includes(token),false);
});
for(const [method,path]of [['POST','applications'],['POST','suites'],['GET','jobs/'+ids.job]])test(method+' '+path+' preserves the route and method',async()=>{
 const r=await request(async(url,init)=>{assert.equal(url,target+'/api/v2/'+path);assert.equal(init.method,method);if(method==='GET')assert.equal(init.body,undefined);return json({});},{op:{method,path,body:{}}});assert.equal(r.code,'response_received');
});
for(const status of [201,202,400,401,403,429,503,504])test('HTTP'+status+' is retained, not retried or promoted to another status',async()=>{
 let n=0;const r=await request(async()=>{n++;return new Response('{"original":"synthetic error or result"}',{status,headers:{'content-type':'application/json'}});});assert.equal(n,1);assert.equal(r.status,status);assert.equal(r.code,'response_received');assert.equal(r.body.original,'synthetic error or result');
});
for(const [name,options]of [
 ['HTTP',{origin:'http://cloud.example.test'}],['URL credentials',{origin:'https://user:pass@cloud.example.test'}],['origin path',{origin:target+'/other'}],
 ['wrong route',{op:{method:'POST',path:'reviews'}}],['wrong method',{op:{method:'DELETE',path:'jobs'}}],['GET mutation route',{op:{method:'GET',path:'jobs'}}],['POST observer',{op:{method:'POST',path:'jobs/'+ids.job}}],
 ['header injection',{token:'bad\r\nvalue'}],['invalid deadline',{ms:15001}],
])test('refuses '+name+' without entering fetch',async()=>{let n=0;const r=await request(async()=>{n++;return json({});},options);assert.equal(n,0);assert.equal(r.networkEntered,false);assert.equal(r.code,'invalid_request');});
test('already aborted signal refuses without dispatch',async()=>{const c=new AbortController();c.abort();let n=0;const r=await request(async()=>{n++;return json({});},{signal:c.signal});assert.equal(n,0);assert.equal(r.code,'cancelled');});
test('transport exception is unknown, has no retry and exposes no exception detail',async()=>{let n=0;const r=await request(async()=>{n++;throw Error('PRIVATE '+token);});assert.equal(n,1);assert.equal(r.code,'transport_unknown');assert.equal(r.status,null);assert.equal(JSON.stringify(r).includes('PRIVATE'),false);});
test('redirect response is rejected without following it',async()=>{const response=json({});Object.defineProperty(response,'redirected',{value:true});const r=await request(async()=>response);assert.equal(r.code,'unexpected_response');assert.equal(r.body,null);});
for(const [name,body,type]of [['non JSON','<html>original</html>','text/html'],['malformed JSON','{"partial":','application/json'],['invalid UTF8',new Uint8Array([0xff,0xfe]),'application/json']])test(name+' original entity is retained, never interpreted as success',async()=>{const r=await request(async()=>new Response(body,{headers:{'content-type':type}}));assert.equal(r.code,'invalid_json');assert.equal(r.bodyComplete,true);assert.equal(r.body,null);assert.deepEqual(Buffer.from(r.rawEntityBase64,'base64'),Buffer.from(body));});
test('stalled response body is deadline bounded and preserves partial bytes/status',async()=>{
 const bytes=new TextEncoder().encode('{"partial":');const r=await request(async()=>new Response(new ReadableStream({start(c){c.enqueue(bytes);}}),{status:504,headers:{'content-type':'application/json'}}),{ms:30});assert.equal(r.code,'deadline_exceeded');assert.equal(r.status,504);assert.equal(r.bodyComplete,false);assert.equal(Buffer.from(r.rawEntityBase64,'base64').toString(),'{"partial":');
});
test('hung fetch that ignores abort cannot keep the caller pending',async()=>{const r=await request(()=>new Promise(()=>{}),{ms:20});assert.equal(r.code,'deadline_exceeded');assert.equal(r.networkEntered,true);});
test('external cancellation while reading stops without another request',async()=>{const c=new AbortController();let n=0;const r=await request(async()=>{n++;queueMicrotask(()=>c.abort());return json({});},{signal:c.signal});assert.equal(n,1);assert.equal(r.code,'cancelled');});
test('oversized body retains a bounded original prefix and records truncation',async()=>{const r=await request(async()=>new Response('X'.repeat(2*1024*1024+1),{headers:{'content-type':'application/json'}}));assert.equal(r.code,'response_too_large');assert.equal(r.bodyTruncated,true);assert.equal(r.bodyComplete,false);assert.equal(r.decodedEntityBytes,2*1024*1024);assert.equal(Buffer.from(r.rawEntityBase64,'base64').length,2*1024*1024);});
for(const echo of [token,token.replaceAll('_','\\u005f')])test('known raw/JSON escaped credential echo is withheld, not silently rewritten',async()=>{const r=await request(async()=>new Response('{"echo":"'+echo+'"}',{headers:{'content-type':'application/json'}}));assert.equal(r.code,'credential_echo_withheld');assert.equal(r.credentialEchoWithheld,true);assert.equal(r.body,null);assert.equal(r.rawEntityBase64,null);assert.ok(r.decodedEntityBytes>0);assert.match(r.sha256,/^[a-f0-9]{64}$/);assert.equal(JSON.stringify(r).includes(token),false);});
test('invalid UTF8 cannot bypass withholding of literal credential bytes',async()=>{
 const r=await request(async()=>new Response(Buffer.concat([Buffer.from([0xff]),Buffer.from(token)]),{headers:{'content-type':'application/json'}}));assert.equal(r.credentialEchoWithheld,true);assert.equal(r.rawEntityBase64,null);
});
