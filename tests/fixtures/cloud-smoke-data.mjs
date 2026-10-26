// Synthetic in-memory boundary; actual protocol/HTTP serialization stays real.
import { readFileSync } from 'node:fs';
import { smokeRequest } from '../../scripts/cloud-smoke-http.mjs';
export const fixture=JSON.parse(readFileSync(new URL('../../public/demo-fixtures.json',import.meta.url),'utf8'));
export const runId='00000000-0000-4000-8000-000000000001',token='INSECURE_TEST_ONLY_SMOKE_TOKEN';
export const ids={app:'00000000-0000-4000-8000-000000000002',suite:'00000000-0000-4000-8000-000000000003',job:'00000000-0000-4000-8000-000000000004'};
export const config=()=>({allowReplaySmoke:true,origin:'https://releaseguard.example.test',allowedOrigins:['https://releaseguard.example.test'],runId,commit:'a'.repeat(40),image:'example.test/rg@sha256:'+'b'.repeat(64),authMode:'token'});
export function completedJob(input,application,suite){return {id:ids.job,workspace:'synthetic-workspace',created_by:'synthetic-actor',input:structuredClone(input),
 snapshot:{application:{id:ids.app,data:structuredClone(application)},suite:{id:ids.suite,version:1,data:structuredClone(suite)}},status:'succeeded',attempts:1,
 result:{total:10,passed:10,errors:0,criticalFailures:0,score:100,gate:'passed',results:fixture.suite.cases.map(c=>({caseId:c.id,status:'passed',output:'SYNTHETIC TEST ONLY',latencyMs:0,reason:'synthetic'}))}};}
export function boundary(options={}){
 const events=[],observed=[],commands=[],terminals=[];let clock=0,used=false,owned=false,application,suite,input,polls=0,retained;
 const controller=new AbortController(),c=config();
 const fail=(kind,key)=>{if(options.fail?.[0]===kind&&options.fail?.[1]===key)throw Error('PRIVATE_TEST_FAILURE_'+token);};
 const io={signal:controller.signal,now:()=>clock,get reservationOwned(){return owned;},
  // Ownership is for THIS invocation, not a historical reservation by the same
  // synthetic filesystem. A fresh real CLI invocation starts with no ownership.
  async reserve(){events.push(['reserve']);owned=false;if(used)throw Error('Already used');used=true;owned=true;fail('reserve',0);},
  async intent(n,v){events.push(['intent',n,v]);fail('intent',n);if(options.abortAtIntent===n)controller.abort();if(options.lateIntent===v.name)clock+=120001;},
  async result(n,v){events.push(['result',n,v]);fail('result',n);},
  async observed(n,v){events.push(['observed',n]);observed.push(structuredClone(v));fail('observed',n);},
  async fixture(){events.push(['fixture']);return options.badFixture?{application:{},suite:{}}:structuredClone(fixture);},
  async authorize(){events.push(['authorize']);fail('authorize',0);return token;},
  async request(origin,op,auth,remaining,signal){events.push(['request',op.path]);commands.push(structuredClone(op));
   return smokeRequest(origin,op,auth,remaining,signal,async(url,init)=>{
    if(init.redirect!=='error'||init.headers.authorization!=='Bearer '+token)throw Error('Unsafe boundary');
    let value,status=200;
    if(options.failureAt===op.path){status=options.status??503;value={error:'SYNTHETIC unknown; retain original'};}
    else if(op.path==='applications'){application=JSON.parse(init.body);value={id:ids.app,...application};status=201;}
    else if(op.path==='suites'){suite=JSON.parse(init.body);value={id:ids.suite,version:1,...suite};status=201;}
    else if(op.path==='jobs'){input=JSON.parse(init.body);value={id:ids.job,status:'queued',replayed:false};status=202;}
    else{polls++;value=completedJob(input,application,suite);
     if(options.queued&&polls<=options.queued){value.status='running';value.result=null;}
     if(options.observationPadding)value.diagnostic='X'.repeat(options.observationPadding);
     if(options.lateObservation)clock+=120001;
     options.mutateJob?.(value);
    }
    return new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
   });
  },
  async sleep(ms){events.push(['sleep',ms]);clock+=ms;},
  async retainJob(job){events.push(['retainJob']);fail('retainJob',0);retained=structuredClone(job);if(options.abortAtRetain)controller.abort();},
  async terminal(r){events.push(['terminal',r.state]);terminals.push(structuredClone(r));fail('terminal',0);if(options.lateTerminal)clock+=180001;if(options.abortAtTerminal)controller.abort();},
 };
 return {io,events,observed,commands,terminals,controller,c,get retained(){return retained;}};
}
