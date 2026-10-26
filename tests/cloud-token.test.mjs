// The original source baseline is invoked only with fake fetch and synthetic
// values; this file denies native TCP. It is never an issuer/login test.
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
net.Socket.prototype.connect=()=>{throw Error('Native network forbidden in token regressions');};
globalThis.fetch=()=>{throw Error('Native fetch forbidden in token regressions');};
const baseline=process.env.RG_TOKEN_SOURCE_BASELINE==='1';
const subject=await import(baseline?'./fixtures/cloud-token-source-pr1.mjs':'../scripts/cloud-token.mjs');
const origin='https://releaseguard.example.test',secret='INSECURE_TEST_ONLY_client_@:/?#%&=+'+'x'.repeat(40),token='INSECURE_TEST_ONLY.opaque-token.value';
const configuration=()=>({allowServiceAuthentication:true,targetOrigin:origin,allowedOrigins:[origin],issuer:origin+'/auth/realms/releaseguard',clientId:'rg-ci',clientSecret:secret,timeoutMs:15000});
function response(body={access_token:token,token_type:'Bearer',expires_in:300},options={}){
 return new Response(typeof body==='string'?body:JSON.stringify(body),{status:200,headers:{'content-type':'application/json;charset=UTF-8','cache-control':'no-store',pragma:'no-cache'},...options});
}
async function invoke(c,fetcher,options={}){
 if(!baseline)return subject.cloudToken(c,{fetch:fetcher,...options});
 const names=['AUTH_ISSUER','RELEASEGUARD_URL','RG_CLOUD_ALLOWED_ORIGINS','OIDC_CLIENT_ID','OIDC_CLIENT_SECRET'],old=Object.fromEntries(names.map(n=>[n,process.env[n]])),oldFetch=globalThis.fetch;
 Object.assign(process.env,{AUTH_ISSUER:c.issuer,RELEASEGUARD_URL:c.targetOrigin,RG_CLOUD_ALLOWED_ORIGINS:c.allowedOrigins.join(','),OIDC_CLIENT_ID:c.clientId,OIDC_CLIENT_SECRET:c.clientSecret});globalThis.fetch=fetcher;
 try{return await subject.cloudToken(c.clientId,c.clientSecret);}finally{globalThis.fetch=oldFetch;for(const n of names)if(old[n]===undefined)delete process.env[n];else process.env[n]=old[n];}
}
test('valid explicit client credentials return the original opaque token with no implicit model or API call',async()=>{
 let calls=0;const got=await invoke(configuration(),async(url,options)=>{
  calls++;assert.equal(url,origin+'/auth/realms/releaseguard/protocol/openid-connect/token');assert.equal(options.method,'POST');assert.equal(options.redirect,'error');
  assert.equal(options.headers['content-type'],'application/x-www-form-urlencoded');assert.deepEqual([...options.body],[['grant_type','client_credentials'],['client_id','rg-ci'],['client_secret',secret]]);
  assert.equal(String(url).includes(secret),false);assert.equal(options.signal instanceof AbortSignal,true);return response();
 });assert.equal(got,token);assert.equal(calls,1);
});
test('issuer query cannot divert a secret-bearing POST away from the literal token endpoint',async()=>{
 const c=configuration();c.issuer+='?debug=1';await assert.rejects(()=>invoke(c,async()=>response()));
});
test('missing explicit authentication opt-in is rejected rather than spending an ambient credential',async()=>{
 const c=configuration();c.allowServiceAuthentication=false;await assert.rejects(()=>invoke(c,async()=>response()));
});
for(const[name,value]of [['object',{sensitive:'not-a-string'}],['number',123],['CRLF','opaque\r\nInjected: value'],['whitespace','opaque token'],['oversized','a'.repeat(16385)]])
 test('non-header-safe bearer token is rejected: '+name,async()=>{await assert.rejects(()=>invoke(configuration(),async()=>response({access_token:value,token_type:'bearer'})));});
test('expired token lifetime cannot be returned as a usable token',async()=>{
 await assert.rejects(()=>invoke(configuration(),async()=>response({access_token:token,token_type:'bearer',expires_in:0})));
});
test('unbounded JSON padding is rejected even when the bearer token itself is small',async()=>{
 await assert.rejects(()=>invoke(configuration(),async()=>response({access_token:token,token_type:'bearer',padding:'x'.repeat(65536)})));
});
test('HTML or other media type cannot be accepted merely because its body parses as JSON',async()=>{
 await assert.rejects(()=>invoke(configuration(),async()=>response(undefined,{headers:{'content-type':'text/html'}})));
});
test('raw transport errors never disclose the client secret or returned payload through error fields',async()=>{
 let error;try{await invoke(configuration(),async()=>{throw Error('PRIVATE_TRANSPORT_'+secret);});}catch(e){error=e;}
 assert.ok(error);assert.equal(String(error).includes(secret),false);assert.equal(JSON.stringify(error).includes(secret),false);
});
if(!baseline){
 for(const[name,change]of [
  ['no opt-in',c=>{delete c.allowServiceAuthentication;}],['ambient env fallback',c=>{delete c.clientSecret;}],
  ['HTTP target',c=>{c.targetOrigin='http://releaseguard.example.test';}],['origin with path',c=>{c.targetOrigin+='/api';}],
  ['origin credentials',c=>{c.targetOrigin='https://operator:password@releaseguard.example.test';}],['noncanonical default port',c=>{c.targetOrigin+=':443';}],
  ['unapproved origin',c=>{c.allowedOrigins=['https://other.example.test'];}],['empty allowlist',c=>{c.allowedOrigins=[];}],
  ['invalid allowlist member',c=>{c.allowedOrigins.push('https://other.example.test/path');}],['issuer other origin',c=>{c.issuer='https://other.example.test/auth/realms/releaseguard';}],
  ['issuer credentials',c=>{c.issuer='https://user:password@releaseguard.example.test/auth/realms/releaseguard';}],
  ['issuer fragment',c=>{c.issuer+='#fragment';}],['issuer trailing slash',c=>{c.issuer+='/';}],['encoded issuer traversal',c=>{c.issuer=origin+'/auth/%2e%2e/realms/releaseguard';}],
  ['backslash issuer',c=>{c.issuer=origin+'/auth\\realms/releaseguard';}],['blank client',c=>{c.clientId='';}],['client control',c=>{c.clientId='rg-ci\n';}],
  ['empty secret',c=>{c.clientSecret='';}],['secret control',c=>{c.clientSecret+='\n';}],['too long secret',c=>{c.clientSecret='s'.repeat(4097);}],
  ['deadline zero',c=>{c.timeoutMs=0;}],['deadline extension',c=>{c.timeoutMs=15001;}],['fractional deadline',c=>{c.timeoutMs=2.5;}],['unknown provider key',c=>{c.MODEL_API_KEY='INSECURE_TEST_ONLY';}],
 ])test('invalid explicit configuration is not sent: '+name,async()=>{
  const c=configuration();change(c);let calls=0;const error=await invoke(c,async()=>{calls++;return response();}).catch(e=>e);
  assert.equal(error.code,'invalid_configuration');assert.equal(error.outcome,'not_sent');assert.equal(calls,0);assert.equal(String(error).includes(secret),false);
 });
 test('input and allowlist are not mutated by a request',async()=>{
  const c=configuration(),old=JSON.stringify(c);Object.freeze(c.allowedOrigins);Object.freeze(c);assert.equal(await invoke(c,async()=>response()),token);assert.equal(JSON.stringify(c),old);
 });
 test('viewer client request is distinct and preserves form encoding without confusing it with a human',async()=>{
  const c=configuration();c.clientId='rg-viewer';await invoke(c,async(_,o)=>{assert.equal(o.body.get('client_id'),'rg-viewer');assert.equal(o.body.get('client_secret'),secret);assert.ok(o.body.toString().includes('%40%3A%2F%3F%23%25%26%3D%2B'));return response();});
 });
 for(const status of [302,400,401,403,429,500,503])test('HTTP '+status+' is observed once without consuming the private error body or retrying',async()=>{
  let calls=0,cancels=0;const body=new ReadableStream({cancel(){cancels++;}}),r=new Response(body,{status,headers:{'content-type':'application/json'}});
  const e=await invoke(configuration(),async()=>{calls++;return r;}).catch(e=>e);assert.equal(e.code,'issuer_http_error');assert.equal(e.status,status);assert.equal(e.outcome,'failed_or_unknown');assert.equal(calls,1);assert.equal(cancels,1);
 });
 for(const body of [null,[],{}, {access_token:token,token_type:'MAC'}, {access_token:token,token_type:'Bearer',expires_in:'300'}, {access_token:token,token_type:'Bearer',scope:[]},'{bad JSON'])
  test('malformed OAuth envelope is rejected without returning a partial token: '+JSON.stringify(body),async()=>{
   const e=await invoke(configuration(),async()=>response(body)).catch(e=>e);assert.equal(e.code,'invalid_token_response');assert.equal(e.outcome,'failed_or_unknown');
  });
 test('unknown OAuth fields are ignored and no refresh token is returned or saved',async()=>{
  assert.equal(await invoke(configuration(),async()=>response({access_token:token,token_type:'bEaReR',refresh_token:'INSECURE_TEST_ONLY_UNUSED',vendor_extension:{ok:true}})),token);
 });
 test('declared oversized Content-Length is refused before reading and its stream is cancelled',async()=>{
  let pulls=0,cancels=0;const r=new Response(new ReadableStream({pull(){pulls++;},cancel(){cancels++;}}),{headers:{'content-type':'application/json','content-length':'65537'}});
  const e=await invoke(configuration(),async()=>r).catch(e=>e);assert.equal(e.code,'response_too_large');assert.equal(cancels,1);assert.ok(pulls<=1);
 });
 test('streamed bytes are bounded even without Content-Length or when it understates the size',async()=>{
  let cancels=0;const r=new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(65537));},cancel(){cancels++;}}),{headers:{'content-type':'application/json','content-length':'1'}});
  const e=await invoke(configuration(),async()=>r).catch(e=>e);assert.equal(e.code,'response_too_large');assert.equal(cancels,1);
 });
 test('invalid UTF8 cannot be silently repaired into an accepted token envelope',async()=>{
  const bytes=Buffer.concat([Buffer.from('{"access_token":"a","token_type":"bearer","note":"'),Buffer.from([0xc0,0xaf]),Buffer.from('"}')]);
  const e=await invoke(configuration(),async()=>new Response(bytes,{headers:{'content-type':'application/json'}})).catch(e=>e);assert.equal(e.code,'invalid_token_response');
 });
 test('already aborted caller sends zero requests and does not surface its private reason',async()=>{
  const controller=new AbortController();controller.abort(secret);let calls=0;
  const e=await invoke(configuration(),async()=>{calls++;return response();},{signal:controller.signal}).catch(e=>e);assert.equal(e.code,'cancelled');assert.equal(e.outcome,'not_sent');assert.equal(calls,0);assert.equal(String(e).includes(secret),false);
 });
 test('caller cancellation reaches an in-flight request and is not retried',async()=>{
  const controller=new AbortController();let seen,calls=0;
  const e=await invoke(configuration(),async(_,o)=>{calls++;seen=o.signal;controller.abort(secret);return new Promise(()=>{});},{signal:controller.signal}).catch(e=>e);
  assert.equal(e.code,'cancelled');assert.equal(e.outcome,'failed_or_unknown');assert.equal(seen.aborted,true);assert.equal(calls,1);assert.equal(String(e).includes(secret),false);
 });
 test('deadline bounds an issuer that never settles even when its injected transport ignores AbortSignal',async()=>{
  const c=configuration();c.timeoutMs=20;let calls=0,seen;const e=await invoke(c,async(_,o)=>{calls++;seen=o.signal;return new Promise(()=>{});}).catch(e=>e);
  assert.equal(e.code,'deadline_exceeded');assert.equal(e.outcome,'failed_or_unknown');assert.equal(seen.aborted,true);assert.equal(calls,1);
 });
 test('deadline includes stalled body reads and requests cancellation without waiting forever for stream cleanup',async()=>{
  const c=configuration();c.timeoutMs=20;let cancelled=0;
  const r=new Response(new ReadableStream({cancel(){cancelled++;return new Promise(()=>{});}}),{headers:{'content-type':'application/json'}});
  const e=await invoke(c,async()=>r).catch(e=>e);assert.equal(e.code,'deadline_exceeded');assert.equal(cancelled,1);
 });
 test('a late response after cancellation is discarded and its body is cancelled, never returned or retried',async()=>{
  const controller=new AbortController();let finish,cancels=0,calls=0;
  const pending=invoke(configuration(),async()=>{calls++;return new Promise(resolve=>{finish=resolve;});},{signal:controller.signal});
  await new Promise(resolve=>setImmediate(resolve));controller.abort();assert.equal((await pending.catch(e=>e)).code,'cancelled');
  finish(new Response(new ReadableStream({cancel(){cancels++;}}),{headers:{'content-type':'application/json'}}));await new Promise(resolve=>setImmediate(resolve));assert.equal(cancels,1);assert.equal(calls,1);
 });
 test('transport failure requests abort of its owned request without exposing the original exception',async()=>{
  let signal;const e=await invoke(configuration(),async(_,o)=>{signal=o.signal;throw Error(secret);}).catch(e=>e);
  assert.equal(e.code,'request_failed');assert.equal(signal.aborted,true);assert.equal(String(e).includes(secret),false);
 });
 test('token lifetime that elapsed while receiving the body is not returned as usable',async()=>{
  const bytes=new TextEncoder().encode(JSON.stringify({access_token:token,token_type:'bearer',expires_in:1}));
  const r=new Response(new ReadableStream({start(c){setTimeout(()=>{c.enqueue(bytes);c.close();},1050);}}),{headers:{'content-type':'application/json'}});
  const e=await invoke(configuration(),async()=>r).catch(e=>e);assert.equal(e.code,'invalid_token_response');
 });
 test('observed redirected or unexpected URL response cannot pass even if the injected transport violates redirect:error',async()=>{
  for(const props of [{redirected:true},{url:'https://other.example.test/token'}]){const r=response();for(const[k,v]of Object.entries(props))Object.defineProperty(r,k,{value:v});
   const e=await invoke(configuration(),async()=>r).catch(e=>e);assert.equal(e.code,'invalid_token_response');}
 });
}
