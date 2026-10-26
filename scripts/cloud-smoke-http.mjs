// Native-only bounded transport for the explicitly guarded replay-smoke caller.
// Returns observed status/entity bytes BEFORE interpretation; no retry/redirect.
// Auth header and known credential echoes are never included in a receipt.
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
const max=2*1024*1024,hash=b=>createHash('sha256').update(b).digest('hex');
const discard=body=>{try{Promise.resolve(body?.cancel()).catch(()=>{});}catch{}};
export async function smokeRequest(origin,op,token,timeoutMs,signal,fetcher){
 let sent=false,status=null,response,reader,timer,off,code='invalid_request',size=0,complete=false,truncated=false,contentType=null;
 const chunks=[],controller=new AbortController();
 try{
  const url=new URL(origin);
  if(url.protocol!=='https:'||url.origin!==origin||url.username||url.password||
   !op||!['applications','suites','jobs'].includes(op.path)&&!/^jobs\/[0-9a-f-]{36}$/.test(op.path)||
   !['POST','GET'].includes(op.method)||op.method==='GET'!==op.path.startsWith('jobs/')||
   typeof token!=='string'||token.length>16384||!/^[-A-Za-z0-9._~+/]+=*$/.test(token)||
   !Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>15000||typeof fetcher!=='function'||signal!==undefined&&!(signal instanceof AbortSignal))throw Error('invalid');
  if(signal?.aborted){code='cancelled';throw Error('stopped');}
  const end=performance.now()+timeoutMs,aborted=new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(Error('stopped')),{once:true}));aborted.catch(()=>{});
  const abort=why=>{if(!controller.signal.aborted){code=why;controller.abort();}};
  const check=()=>{if(performance.now()>=end)abort('deadline_exceeded');if(controller.signal.aborted)throw Error('stopped');};
  const until=async p=>{check();const result=await Promise.race([p,aborted]);check();return result;};
  code='transport_unknown';const onAbort=()=>abort('cancelled');signal?.addEventListener('abort',onAbort,{once:true});off=()=>signal?.removeEventListener('abort',onAbort);
  if(signal?.aborted)onAbort();timer=setTimeout(()=>abort('deadline_exceeded'),timeoutMs);
  const pending=Promise.resolve().then(()=>{check();sent=true;return fetcher(origin+'/api/v2/'+op.path,{method:op.method,redirect:'error',cache:'no-store',
   headers:{authorization:'Bearer '+token,accept:'application/json',...(op.method==='POST'?{'content-type':'application/json'}:{}),...(op.key?{'idempotency-key':op.key}:{})},
   body:op.method==='POST'?JSON.stringify(op.body):undefined,signal:controller.signal});});
  pending.then(r=>{if(controller.signal.aborted||performance.now()>=end)discard(r?.body);}).catch(()=>{});
  response=await until(pending);if(!(response instanceof Response))throw Error('invalid response');status=response.status;contentType=response.headers.get('content-type');
  if(response.redirected||response.url&&response.url!==origin+'/api/v2/'+op.path){code='unexpected_response';throw Error('redirect');}
  if(!response.body){complete=true;code='invalid_json';}
  else{
   reader=response.body.getReader();for(;;){const part=await until(reader.read());if(part.done){complete=true;break;}
    const b=part.value;if(!(b instanceof Uint8Array))throw Error('invalid bytes');const keep=Math.min(max-size,b.byteLength);if(keep>0){chunks.push(b.subarray(0,keep));size+=keep;}
    if(keep!==b.byteLength){truncated=true;code='response_too_large';throw Error('bounded');}
   }
   code=/^application\/json(?:\s*;|$)/i.test(contentType??'')?'response_received':'invalid_json';
  }
 }catch{controller.abort();if(reader){try{Promise.resolve(reader.cancel()).catch(()=>{});}catch{}}else discard(response?.body);}
 finally{clearTimeout(timer);off?.();try{reader?.releaseLock();}catch{}}
 const bytes=Buffer.concat(chunks,size);let body=null,text;
 try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(complete&&code==='response_received')body=JSON.parse(text);}catch{if(complete)code='invalid_json';}
 const credentialEcho=Boolean(typeof token==='string'&&token.length&&bytes.includes(Buffer.from(token))||text?.includes(token)||body&&JSON.stringify(body).includes(token));
 if(credentialEcho){code='credential_echo_withheld';body=null;}
 return {networkEntered:sent,status,code,bodyComplete:complete,bodyTruncated:truncated,decodedEntityBytes:size,sha256:hash(bytes),
  rawEntityBase64:credentialEcho?null:bytes.toString('base64'),credentialEchoWithheld:credentialEcho,body};
}
