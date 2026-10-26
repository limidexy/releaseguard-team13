// Explicit service-client authentication only. No environment/files/network on
// import; the external fetch boundary is required. Opaque tokens are not decoded
// or treated as verified human identities. The API still verifies issuer/signature,
// audience, workspace, service/principal and role. No token/error body is logged.
import { performance } from 'node:perf_hooks';
const fields=['allowServiceAuthentication','targetOrigin','allowedOrigins','issuer','clientId','clientSecret','timeoutMs'];
const invalid=()=>{throw Error('Invalid explicit service authentication configuration');};
function plain(v){return v&&Object.getPrototypeOf(v)===Object.prototype;}
function origin(v){
 if(typeof v!=='string'||v.length>2048||/[\x00-\x20\x7f]/.test(v))invalid();
 const u=new URL(v);if(u.protocol!=='https:'||u.username||u.password||u.origin!==v)invalid();return v;
}
function configuration(input){
 if(!plain(input)||Object.keys(input).length!==fields.length||fields.some(k=>!Object.hasOwn(input,k))||input.allowServiceAuthentication!==true)invalid();
 const target=origin(input.targetOrigin),a=input.allowedOrigins;
 if(!Array.isArray(a)||a.length<1||a.length>20)invalid();for(const v of a)origin(v);if(!a.includes(target))invalid();
 const text=input.issuer;if(typeof text!=='string'||text.length>2048||/[\x00-\x20\x7f%\\?#]/.test(text))invalid();
 const issuer=new URL(text);
 if(issuer.protocol!=='https:'||issuer.username||issuer.password||issuer.origin!==target||
  text!==(issuer.pathname==='/'?issuer.origin:issuer.href)||
  issuer.pathname!=='/'&&(!/^\/(?:[A-Za-z0-9._~-]+\/)*[A-Za-z0-9._~-]+$/.test(issuer.pathname)||issuer.pathname.split('/').some(s=>s==='.'||s==='..')))invalid();
 if(typeof input.clientId!=='string'||!/^[A-Za-z0-9._-]{1,150}$/.test(input.clientId)||
  typeof input.clientSecret!=='string'||!input.clientSecret.length||input.clientSecret.length>4096||/[\x00-\x1f\x7f]/.test(input.clientSecret)||
  !Number.isInteger(input.timeoutMs)||input.timeoutMs<1||input.timeoutMs>15000)invalid();
 return {endpoint:text+'/protocol/openid-connect/token',clientId:input.clientId,clientSecret:input.clientSecret,timeoutMs:input.timeoutMs};
}
function publicError(code,sent,status){
 const e=new Error('Cloud service authentication failed ('+code+'). No retry; retain the caller attempt.');
 e.name='CloudServiceAuthenticationError';e.code=code;e.outcome=sent?'failed_or_unknown':'not_sent';if(status!==null)e.status=status;return e;
}
function cancel(body){try{Promise.resolve(body?.cancel()).catch(()=>{});}catch{}}
export async function requestServiceToken(input,runtime){
 let code='invalid_configuration',sent=false,status=null,controller,timer,reader,response,abortListener,removeCaller;
 const stop=reason=>{code=reason;throw Error('Stopped');};
 try{
  const c=configuration(input);
  if(!plain(runtime)||Object.keys(runtime).some(k=>!['fetch','signal'].includes(k))||typeof runtime.fetch!=='function'||runtime.signal!==undefined&&!(runtime.signal instanceof AbortSignal))invalid();
  if(runtime.signal?.aborted)stop('cancelled');
  const fetcher=runtime.fetch,caller=runtime.signal;
  controller=new AbortController();const began=performance.now(),deadline=began+c.timeoutMs;
  const aborted=new Promise((_,reject)=>{abortListener=()=>reject(Error('Stopped'));controller.signal.addEventListener('abort',abortListener,{once:true});});
  // Race handlers are installed immediately; a cancelled future fetch/body cannot
  // become a later success, even if an injected/misbehaving transport ignores abort.
  aborted.catch(()=>{});
  const abort=reason=>{if(!controller.signal.aborted){code=reason;controller.abort();}};
  const check=()=>{if(performance.now()>=deadline)abort('deadline_exceeded');if(controller.signal.aborted)throw Error('Stopped');};
  const until=async promise=>{check();const result=await Promise.race([promise,aborted]);check();return result;};
  code='request_failed';const onCaller=()=>abort('cancelled');caller?.addEventListener('abort',onCaller,{once:true});removeCaller=()=>caller?.removeEventListener('abort',onCaller);
  if(caller?.aborted)onCaller();timer=setTimeout(()=>abort('deadline_exceeded'),c.timeoutMs);check();
  const pending=Promise.resolve().then(()=>{
   check();sent=true;
   return fetcher(c.endpoint,{method:'POST',redirect:'error',cache:'no-store',headers:{accept:'application/json','content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'client_credentials',client_id:c.clientId,client_secret:c.clientSecret}),signal:controller.signal});
  });
  pending.then(r=>{if(controller.signal.aborted||performance.now()>=deadline)cancel(r?.body);}).catch(()=>{});
  response=await until(pending);
  if(!(response instanceof Response))stop('invalid_token_response');
  status=Number.isInteger(response.status)&&response.status>=100&&response.status<=599?response.status:null;
  if(status!==200)stop('issuer_http_error');
  if(response.redirected||response.url&&response.url!==c.endpoint||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??''))stop('invalid_token_response');
  const length=response.headers.get('content-length');
  if(length!==null&&(!/^\d+$/.test(length)||BigInt(length)>65536n))stop('response_too_large');
  if(!response.body)stop('invalid_token_response');
  reader=response.body.getReader();let size=0;const chunks=[];
  for(;;){const part=await until(reader.read());if(part.done)break;
   if(!(part.value instanceof Uint8Array))stop('invalid_token_response');size+=part.value.byteLength;
   if(size>65536)stop('response_too_large');chunks.push(part.value);
  }
  check();let body;
  try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size)));}catch{stop('invalid_token_response');}
  if(!plain(body)||typeof body.access_token!=='string'||body.access_token.length>16384||!/^[-A-Za-z0-9._~+/]+=*$/.test(body.access_token)||
   typeof body.token_type!=='string'||body.token_type.toLowerCase()!=='bearer'||
   Object.hasOwn(body,'expires_in')&&(!Number.isSafeInteger(body.expires_in)||body.expires_in<=0||(performance.now()-began)/1000>=body.expires_in)||
   Object.hasOwn(body,'scope')&&(typeof body.scope!=='string'||body.scope.length>2048||/[\x00-\x1f\x7f]/.test(body.scope)))stop('invalid_token_response');
  check();return body.access_token;
 }catch{
  // Never attach a raw exception/cause, private URL, payload or token. A transport
  // failure after send may already have issued a token; do not claim rejection.
  controller?.abort();if(reader){try{Promise.resolve(reader.cancel()).catch(()=>{});}catch{}}else cancel(response?.body);
  return Promise.reject(publicError(code,sent,status));
 }finally{
  clearTimeout(timer);removeCaller?.();if(abortListener)controller?.signal.removeEventListener('abort',abortListener);
  try{reader?.releaseLock();}catch{}
 }
}
