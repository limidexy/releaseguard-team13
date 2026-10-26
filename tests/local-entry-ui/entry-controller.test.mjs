import test from 'node:test';
import assert from 'node:assert/strict';

// Real transport is forbidden even during module import. Every behavioral test
// injects its own fetch, clipboard and monotonic timer. No browser or service.
globalThis.fetch = () => { throw Error('TEST_REAL_FETCH_FORBIDDEN'); };
const {createEntryController} = await import('../../src/local-entry-ui/entry-controller.mjs');

const TOKEN = 'SYNTHETIC_NOT_A_CREDENTIAL_ABC123';
const SECRET = 'SYNTHETIC_ERROR_MUST_NOT_APPEAR';
const BASE = Object.freeze({role:'viewer',workspace:'synthetic-workspace',helperOrigin:'http://127.0.0.1:8776',appOrigin:'http://localhost:5193',timeoutMs:10000,maxLifetimeSeconds:900});
const spec = (name,fn) => test(name,{timeout:2000},fn);
const deferred = () => {let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const flush = async () => {for(let n=0;n<40;n++)await Promise.resolve();};
function fakeClock(initial=123456){
 let value=initial,next=0;const tasks=new Map();
 return {now:()=>value,setTimer(fn,delay){const id=++next;tasks.set(id,{fn,at:value+delay});return id;},clearTimer(id){tasks.delete(id);},
  advance(ms){assert(ms>=0);value+=ms;for(;;){const due=[...tasks].filter(([,v])=>v.at<=value).sort((a,b)=>a[1].at-b[1].at);if(!due.length)break;const [id,t]=due[0];tasks.delete(id);t.fn();}},get pending(){return tasks.size;}};
}
function view(){
 const listeners=new Map(),history=[];let text='';
 const status={get textContent(){return text;},set textContent(value){text=String(value);history.push(text);}};
 const button={disabled:false,addEventListener(type,fn){assert.equal(type,'click');listeners.set(type,fn);},removeEventListener(type,fn){if(listeners.get(type)===fn)listeners.delete(type);},
  fire(){let prevented=false;listeners.get('click')?.({preventDefault(){prevented=true;}});return prevented;},get count(){return listeners.size;}};
 return {button,status,history};
}
const payload = (overrides={}) => ({token:TOKEN,role:'viewer',workspace:BASE.workspace,expiresInSeconds:900,...overrides});
const response = (json=payload(),status=200) => ({status,ok:status>=200&&status<300,async json(){return json;}});
function fixture({config={},fetcher,clipboard,clipboardMissing=false,initial=123456,now}={}){
 const clock=fakeClock(initial),v=view(),requests=[],writes=[],controllers=[];
 const ports={button:v.button,status:v.status,fetcher:async(...args)=>{requests.push(args);return fetcher?fetcher(...args):response(payload({role:config.role??'viewer'}));},
  clipboard:clipboardMissing?undefined:{async writeText(value){writes.push(value);if(clipboard)return clipboard(value);}},now:now??clock.now,setTimer:clock.setTimer,clearTimer:clock.clearTimer,
  createAbortController(){const c=new AbortController();controllers.push(c);return c;}};
 const controller=createEntryController({...BASE,...config},ports);
 return {...v,clock,requests,writes,controllers,controller,ports};
}
function noLeak(f,result){const text=[...f.history,JSON.stringify(result??{})].join('\n');assert(!text.includes(TOKEN));assert(!text.includes(SECRET));}
function clean(f,result){noLeak(f,result);assert.equal(f.button.disabled,false);assert.equal(f.clock.pending,0);}
async function expectCode(f,code){const result=await f.controller.copy();assert.equal(result.code,code);clean(f,result);return result;}

spec('import and construction do not generate credentials; click prevents default',async()=>{
 const f=fixture();assert.equal(f.requests.length,0);assert.equal(f.writes.length,0);assert.equal(f.button.count,1);
 assert.equal(f.button.fire(),true);await flush();assert.equal(f.requests.length,1);assert.deepEqual(f.writes,[TOKEN]);clean(f);f.controller.dispose();
});

spec('viewer copies only after an explicit copy and uses the exact safe request contract',async()=>{
 const f=fixture();await expectCode(f,'copied');assert.equal(f.requests.length,1);assert.deepEqual(f.writes,[TOKEN]);
 const [url,o]=f.requests[0];assert.equal(url,BASE.helperOrigin+'/token/viewer');assert.equal(o.method,'POST');assert.equal(o.body,'{}');
 assert.equal(o.cache,'no-store');assert.equal(o.credentials,'omit');assert.equal(o.redirect,'error');assert.equal(new Headers(o.headers).get('content-type'),'application/json');
 assert(o.signal instanceof AbortSignal);assert.match(f.status.textContent,/cop|复制/i);assert.match(f.status.textContent,/paste|Access token|手动|粘贴/i);assert.doesNotMatch(f.status.textContent,/已连接|successfully connected|workspace connected/i);f.controller.dispose();
});

spec('contributor role is carried through request and verified response',async()=>{
 const f=fixture({config:{role:'contributor'}});await expectCode(f,'copied');assert.equal(f.requests[0][0],BASE.helperOrigin+'/token/contributor');f.controller.dispose();
});

spec('non-loopback, non-HTTP and hostname lookalike origins are rejected before fetch',()=>{
 for(const field of ['helperOrigin','appOrigin'])for(const value of ['https://localhost:8776','http://example.test:8776','http://localhost.example.test:8776','http://127.0.0.1.example.test:8776']){
  let fetched=0;const v=view(),clock=fakeClock();assert.throws(()=>createEntryController({...BASE,[field]:value},{...v,fetcher(){fetched++;},clipboard:undefined,now:clock.now,setTimer:clock.setTimer,clearTimer:clock.clearTimer,createAbortController:()=>new AbortController()}));assert.equal(fetched,0);
 }
});

spec('URL credentials, path, query and fragment are rejected rather than normalized away',()=>{
 for(const field of ['helperOrigin','appOrigin'])for(const value of ['http://user:pass@localhost:8776','http://localhost:8776/token','http://localhost:8776/?x=1','http://localhost:8776/#secret'])assert.throws(()=>fixture({config:{[field]:value}}));
});

spec('invalid role, workspace and numeric bounds fail before any generation',()=>{
 for(const config of [{role:'owner'},{role:'reviewer'},{workspace:''},{workspace:'   '},{timeoutMs:0},{timeoutMs:NaN},{timeoutMs:Infinity},{maxLifetimeSeconds:0},{maxLifetimeSeconds:901},{maxLifetimeSeconds:1.5}])assert.throws(()=>fixture({config}));
});

spec('null, wrong role and wrong workspace responses never reach clipboard',async()=>{
 for(const body of [null,{},payload({role:'owner'}),payload({role:'contributor'}),payload({workspace:'another-workspace'})]){
  const f=fixture({fetcher:async()=>response(body)});await expectCode(f,'invalid_response');assert.equal(f.writes.length,0);f.controller.dispose();
 }
});

spec('token must be a nonempty string with no whitespace',async()=>{
 for(const token of ['',null,42,[],{},' '+TOKEN,TOKEN+' ',TOKEN+'\n',TOKEN+'\tX',TOKEN+' X']){
  const f=fixture({fetcher:async()=>response(payload({token}))});await expectCode(f,'invalid_response');assert.equal(f.writes.length,0);f.controller.dispose();
 }
});

spec('token length accepts 16384 but rejects 16385 without storing the response',async()=>{
 const good=fixture({fetcher:async()=>response(payload({token:'x'.repeat(16384)}))});await expectCode(good,'copied');assert.equal(good.writes[0].length,16384);good.controller.dispose();
 const bad=fixture({fetcher:async()=>response(payload({token:'x'.repeat(16385)}))});await expectCode(bad,'invalid_response');assert.equal(bad.writes.length,0);bad.controller.dispose();
});

spec('expiry seconds must be an integer within the configured upper bound',async()=>{
 for(const expiresInSeconds of [undefined,null,0,-1,1.1,'900',901,Infinity,NaN]){
  const f=fixture({fetcher:async()=>response(payload({expiresInSeconds}))});await expectCode(f,'invalid_response');assert.equal(f.writes.length,0);f.controller.dispose();
 }
 for(const expiresInSeconds of [1,900]){const f=fixture({fetcher:async()=>response(payload({expiresInSeconds}))});await expectCode(f,'copied');f.controller.dispose();}
});

spec('a lower configured lifetime bound cannot be bypassed by a nominal 900-second response',async()=>{
 const f=fixture({config:{maxLifetimeSeconds:60},fetcher:async()=>response(payload({expiresInSeconds:61}))});await expectCode(f,'invalid_response');assert.equal(f.writes.length,0);f.controller.dispose();
});

spec('network rejection reports safe generation failure and does not retry',async()=>{
 const f=fixture({fetcher:async()=>{throw Error(SECRET+' '+TOKEN);}});await expectCode(f,'generation_failed');assert.equal(f.requests.length,1);assert.equal(f.writes.length,0);f.controller.dispose();
});

spec('JSON parsing rejection reports a safe generation failure without raw body text',async()=>{
 const f=fixture({fetcher:async()=>({ok:true,status:200,json:async()=>{throw Error(SECRET+' '+TOKEN);}})});await expectCode(f,'generation_failed');assert.equal(f.writes.length,0);f.controller.dispose();
});

for(const [status,code] of [[401,'unauthorized'],[403,'forbidden'],[429,'rate_limited'],[500,'generation_failed']])spec('HTTP '+status+' has a distinct safe code without reading its body',async()=>{
 let reads=0;const f=fixture({fetcher:async()=>({ok:false,status,json(){reads++;throw Error(SECRET);},text(){reads++;throw Error(TOKEN);}})});
 await expectCode(f,code);assert.equal(reads,0);assert.equal(f.requests.length,1);assert.equal(f.writes.length,0);f.controller.dispose();
});

spec('missing clipboard is distinct from generation failure',async()=>{
 const f=fixture({clipboardMissing:true});await expectCode(f,'clipboard_unavailable');assert.equal(f.requests.length,1);assert.equal(f.writes.length,0);f.controller.dispose();
});

spec('clipboard denial never regenerates or exposes the token',async()=>{
 const f=fixture({clipboard:async()=>{throw Error(SECRET+' '+TOKEN);}});await expectCode(f,'copy_failed');assert.equal(f.requests.length,1);assert.deepEqual(f.writes,[TOKEN]);f.controller.dispose();
});

spec('overlapping copy and click share one busy lock',async()=>{
 const wait=deferred(),f=fixture({fetcher:()=>wait.promise});const first=f.controller.copy();await flush();assert.equal(f.button.disabled,true);
 assert.equal((await f.controller.copy()).code,'ignored');assert.equal(f.button.fire(),true);await flush();assert.equal(f.requests.length,1);
 wait.resolve(response());assert.equal((await first).code,'copied');clean(f);assert.deepEqual(f.writes,[TOKEN]);f.controller.dispose();
});

spec('a later explicit user retry after a failure works, without automatic retry',async()=>{
 let calls=0;const f=fixture({fetcher:async()=>{calls++;if(calls===1)throw Error(SECRET);return response();}});
 await expectCode(f,'generation_failed');assert.equal(calls,1);await flush();assert.equal(calls,1);await expectCode(f,'copied');assert.equal(calls,2);f.controller.dispose();
});

spec('fetch timeout settles even when the fetcher ignores AbortSignal',async()=>{
 const wait=deferred(),f=fixture({fetcher:()=>wait.promise});const pending=f.controller.copy();await flush();f.clock.advance(10000);await flush();
 assert.equal((await pending).code,'generation_timeout');clean(f);assert.equal(f.requests[0][1].signal.aborted,true);assert.equal(f.writes.length,0);f.controller.dispose();
});

spec('response body timeout uses the original generation deadline',async()=>{
 const body=deferred(),f=fixture({fetcher:async()=>({ok:true,status:200,json:()=>body.promise})});const pending=f.controller.copy();await flush();f.clock.advance(10000);await flush();
 assert.equal((await pending).code,'generation_timeout');clean(f);assert.equal(f.writes.length,0);f.controller.dispose();
});

spec('late fetch completion after timeout cannot copy or update status',async()=>{
 const wait=deferred(),f=fixture({fetcher:()=>wait.promise});const pending=f.controller.copy();await flush();f.clock.advance(10000);await flush();await pending;
 const history=[...f.history];wait.resolve(response());await flush();assert.equal(f.writes.length,0);assert.deepEqual(f.history,history);clean(f);f.controller.dispose();
});

spec('late JSON completion after timeout cannot copy or update status',async()=>{
 const body=deferred(),f=fixture({fetcher:async()=>({ok:true,status:200,json:()=>body.promise})});const pending=f.controller.copy();await flush();f.clock.advance(10000);await flush();await pending;
 const history=[...f.history];body.resolve(payload());await flush();assert.equal(f.writes.length,0);assert.deepEqual(f.history,history);clean(f);f.controller.dispose();
});

spec('generation elapsed time consumes token lifetime before clipboard begins',async()=>{
 const wait=deferred(),f=fixture({fetcher:()=>wait.promise});const pending=f.controller.copy();await flush();f.clock.advance(2000);wait.resolve(response(payload({expiresInSeconds:1})));
 assert.equal((await pending).code,'expired');clean(f);assert.equal(f.writes.length,0);f.controller.dispose();
});

spec('body parsing elapsed time also consumes token lifetime',async()=>{
 const body=deferred(),f=fixture({fetcher:async()=>({ok:true,status:200,json:()=>body.promise})});const pending=f.controller.copy();await flush();f.clock.advance(1000);body.resolve(payload({expiresInSeconds:1}));
 assert.equal((await pending).code,'expired');clean(f);assert.equal(f.writes.length,0);f.controller.dispose();
});

spec('expiry while an already-started clipboard operation waits is reported honestly',async()=>{
 const copy=deferred(),f=fixture({clipboard:()=>copy.promise});const pending=f.controller.copy();await flush();assert.equal(f.writes.length,1);f.clock.advance(900000);copy.resolve();
 assert.equal((await pending).code,'expired_after_copy');clean(f);assert.match(f.status.textContent,/expir|过期|失效/i);f.controller.dispose();
});

spec('dispose aborts pending generation, detaches click and prevents late effects',async()=>{
 const wait=deferred(),f=fixture({fetcher:()=>wait.promise});const pending=f.controller.copy();await flush();f.controller.dispose();await flush();
 assert.equal((await pending).code,'disposed');assert.equal(f.button.count,0);assert.equal(f.requests[0][1].signal.aborted,true);const history=[...f.history];
 wait.resolve(response());await flush();assert.deepEqual(f.history,history);assert.equal(f.writes.length,0);assert.equal((await f.controller.copy()).code,'disposed');clean(f);
});

spec('dispose while JSON body waits prevents copy despite late valid payload',async()=>{
 const body=deferred(),f=fixture({fetcher:async()=>({ok:true,status:200,json:()=>body.promise})});const pending=f.controller.copy();await flush();f.controller.dispose();await flush();
 assert.equal((await pending).code,'disposed');const history=[...f.history];body.resolve(payload());await flush();assert.equal(f.writes.length,0);assert.deepEqual(f.history,history);clean(f);
});

spec('idle dispose is idempotent and a detached click cannot start a request',async()=>{
 const f=fixture();f.controller.dispose();f.controller.dispose();assert.equal(f.button.count,0);assert.equal(f.button.fire(),false);await flush();assert.equal(f.requests.length,0);assert.equal((await f.controller.copy()).code,'disposed');clean(f);
});

spec('dispose cannot retract started clipboard but prevents later success status',async()=>{
 const copy=deferred(),f=fixture({clipboard:()=>copy.promise});const pending=f.controller.copy();await flush();assert.equal(f.writes.length,1);f.controller.dispose();const history=[...f.history];copy.resolve();
 assert.equal((await pending).code,'disposed');await flush();assert.deepEqual(f.history,history);assert.equal(f.writes.length,1);clean(f);
});

spec('lifetime uses relative monotonic elapsed time rather than the clock origin',async()=>{
 const f=fixture({initial:1234567890,fetcher:async()=>response(payload({expiresInSeconds:1}))});await expectCode(f,'copied');assert.deepEqual(f.writes,[TOKEN]);f.controller.dispose();
});

spec('a two-second response advertises two seconds rather than a fixed fifteen minutes',async()=>{
 const f=fixture({fetcher:async()=>response(payload({expiresInSeconds:2}))});
 try {await expectCode(f,'copied');assert.match(f.status.textContent,/\b2 seconds\b/);assert.doesNotMatch(f.status.textContent,/15\s*(?:minutes?|分钟)|900\s*seconds/i);}
 finally {f.controller.dispose();}
});

spec('backward and nonfinite monotonic readings fail without copying',async()=>{
 for(const invalid of [999,NaN,Infinity,-Infinity]){
  let current=1000;const wait=deferred(),f=fixture({now:()=>current,fetcher:()=>wait.promise});const pending=f.controller.copy();
  try {await flush();current=invalid;wait.resolve(response());assert.equal((await pending).code,'generation_failed');assert.equal(f.writes.length,0);clean(f);}
  finally {wait.resolve(response());f.controller.dispose();}
 }
});

spec('one live controller owns its button and a second mount is rejected',()=>{
 const f=fixture();let duplicate;
 try {assert.throws(()=>{duplicate=createEntryController({...BASE},f.ports);});assert.equal(f.requests.length,0);assert.equal(f.button.count,1);}
 finally {duplicate?.dispose();f.controller.dispose();}
});

spec('a disposed in-flight clipboard write retains button ownership until it settles',async()=>{
 const writing=deferred(),f=fixture({clipboard:()=>writing.promise});const pending=f.controller.copy();let replacement;
 try {
  await flush();assert.equal(f.writes.length,1);f.controller.dispose();const disposedHistory=[...f.history];
  assert.throws(()=>{replacement=createEntryController({...BASE},f.ports);});assert.equal(f.writes.length,1);
  writing.resolve();assert.equal((await pending).code,'disposed');await flush();assert.deepEqual(f.history,disposedHistory);
  replacement=createEntryController({...BASE},f.ports);assert.equal(f.button.count,1);
  assert.equal((await replacement.copy()).code,'copied');assert.equal(f.writes.length,2);clean(f);
 } finally {writing.resolve();await pending;replacement?.dispose();f.controller.dispose();}
});

spec('late old generation cannot overwrite a replacement controller on the same view',async()=>{
 const oldFetch=deferred(),f=fixture({fetcher:()=>oldFetch.promise});const oldPending=f.controller.copy();let replacement;
 const freshToken='SYNTHETIC_FRESH_NOT_A_CREDENTIAL';
 try {
  await flush();f.controller.dispose();assert.equal((await oldPending).code,'disposed');
  replacement=createEntryController({...BASE},{...f.ports,fetcher:async()=>response(payload({token:freshToken}))});
  assert.equal((await replacement.copy()).code,'copied');const freshHistory=[...f.history];
  oldFetch.resolve(response(payload({token:'SYNTHETIC_STALE_NOT_A_CREDENTIAL'})));await flush();
  assert.deepEqual(f.writes,[freshToken]);assert.deepEqual(f.history,freshHistory);clean(f);
 } finally {oldFetch.resolve(response());await oldPending;replacement?.dispose();f.controller.dispose();}
});
