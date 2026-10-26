// Pure workload/measurement coordinator. All I/O is supplied by an explicit caller.
// The operator CLI proves a disposable, model-disabled target before constructing it.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function fault(code){const e=Error('Mixed workload failed');e.code=code;throw e;}
const codes=new Set(['deadline','request_budget','new_sends_stopped','asset_response','seed_response','seed_completion','measured_response','read_write_correctness','record_failed','operation_failed']);
function safe(error){return codes.has(error?.code)?error.code:'operation_failed';}
const percentile=(a,q)=>a.length?[...a].sort((x,y)=>x-y)[Math.ceil(q*a.length)-1]:null;
// Pending reservations never age out before dispatch. Count the actual dispatch
// timestamp, not the time an async caller started waiting for a permit.
export function seedQuota({limit,clock,check}){
 if(!Number.isInteger(limit)||limit<1)throw Error('Invalid configured quota');
 const windows=new Map();
 return async({workspace,shouldStop})=>{
  for(;;){
   check();if(shouldStop())fault('new_sends_stopped');
   const now=clock.now(),slots=(windows.get(workspace)??[]).filter(slot=>slot.at===null||now-slot.at<61000);
   windows.set(workspace,slots);
   if(slots.length<limit){
    const slot={at:null};slots.push(slot);let committed=false;
    return()=>{if(committed)throw Error('Permit already dispatched');committed=true;slot.at=clock.now();};
   }
   await clock.sleep(250);
  }
 };
}
export function summarizeStage(raw,elapsedMs){
 return ['read','write'].map(kind=>{
  const rows=raw.filter(r=>r.kind===kind);
  const timingValid=Number.isFinite(elapsedMs)&&elapsedMs>0&&rows.length>0&&rows.every(r=>Number.isFinite(r.durationMs)&&r.durationMs>=0);
  const values=rows.map(r=>r.durationMs);
  return {kind,requests:rows.length,errors:rows.filter(r=>!r.passed).length,requestsPerSecond:timingValid?rows.length*1000/elapsedMs:null,
   p50Ms:timingValid?percentile(values,.5):null,p95Ms:timingValid?percentile(values,.95):null,p99Ms:timingValid?percentile(values,.99):null,timingValid};
 });
}
export async function runMixedLoad(d){
 if(!Number.isInteger(d.seconds)||d.seconds<5||d.seconds>30||!uuid.test(d.runId)||d.assets?.suite?.cases?.length!==10)throw Error('Invalid workload definition');
 let stopped=false,requests=0,sends=0;
 const report={cloud:false,realProviderCalls:0,protocol:{secondsPerStage:d.seconds,clients:4,thinkTimeMs:100,schedule:'3 reads then 1 job write, shared round-robin counter',initialRows:[100,1000],workerReplicas:1,seedClients:6,observerClients:12,
  identities:'Fixed local seed/load contributor identities; no rotation after failure',timing:'API interval excludes evidence persistence; closed-loop wall interval includes preparation and drain overhead'},
 interpretation:'Replay-only local HTTP/queue/database workload. API response latency is not SQL or task latency. Docker CPU is instantaneous, database counters cumulative. Not maximum capacity, cloud acceptance or scaling benefit.',
 stages:[100,1000].map(initialRows=>({initialRows,workspace:'mixed-'+initialRows+'-'+d.runId,state:'not_started',seed:Array.from({length:initialRows},(_,i)=>({i,state:'not_attempted'})),raw:[],writtenJobs:[]})),passed:false};
 const check=()=>{if(!Number.isFinite(d.clock.now())||d.clock.now()>=d.deadlineMs)fault('deadline');};
 async function event(value){try{await d.record(value);}catch{stopped=true;fault('record_failed');}}
 async function call(path,token,body,key,meta={},onSend=()=>{},onResponse=()=>{}){
  check();if(stopped&&!meta.observation)fault('new_sends_stopped');if(++requests>20000)fault('request_budget');
  const requestId=requests;
  await event({kind:'request_intent',requestId,path,...(body===undefined?{}:{body}),...(key?{key}:{}),phase:meta.phase});
  const permit=meta.phase==='seed'?await d.seedPace({workspace:meta.workspace,shouldStop:()=>stopped,deadlineMs:d.deadlineMs}):undefined;
  check();if(stopped&&!meta.observation)fault('new_sends_stopped');
  const began=d.clock.now();onSend();if(permit)permit();sends++;let response;
  try{response=await d.transport(path,token,body,key,{...meta,requestId});}
  catch{response={status:null,outcome:'response_unknown'};}
  const ended=d.clock.now(),result={...response,status:Number.isInteger(response?.status)?response.status:null,outcome:response?.outcome??'response_received',began,ended,durationMs:ended-began,requestId};
  onResponse(result); // Keep observed metadata even if the response journal cannot sync.
  await event({kind:'response',requestId,status:result.status,outcome:result.outcome,began,ended,durationMs:result.durationMs,...(uuid.test(response?.data?.id??'')?{observedId:response.data.id}:{})});
  return result;
 }
 async function parallel(items,fn,limit){
  let next=0,failed;
  await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{
   while(!stopped&&next<items.length){
    const i=next++;try{await fn(items[i],i);}catch(error){stopped=true;failed??=error;}
   }
  }));
  if(failed)throw failed;
 }
 async function complete(id,token,expectedInput,workspace){
  const deadline=Math.min(d.deadlineMs,d.clock.now()+120000);
  while(d.clock.now()<deadline){
   const r=await call('jobs/'+id,token,undefined,undefined,{phase:'completion',observation:true});
   if(r.status!==200||r.outcome!=='response_received'||r.data?.id!==id)return{id,error:'observation_failed'};
   if(r.data.workspace!==workspace||!r.data.input||Object.keys(expectedInput).some(key=>r.data.input[key]!==expectedInput[key]))return{id,error:'wrong_job_evidence'};
   if(['succeeded','failed'].includes(r.data.status))return r.data;
   if(!['queued','running'].includes(r.data.status))return{id,error:'invalid_job_state'};
   await d.clock.sleep(150);
  }
  return{id,error:'result_unknown'};
 }
 async function asset(path,token,body){
  const r=await call(path,token,body,d.key(),{phase:'assets'});
  if(r.status!==201||r.outcome!=='response_received'||!uuid.test(r.data?.id??''))fault('asset_response');return r.data;
 }
 try{
  check();
  for(const s of report.stages){
   check();s.state='seeding';
   const seedToken=await d.token('seed-author','contributor',s.workspace),loadToken=await d.token('load-author','contributor',s.workspace);
   const app=await asset('applications',seedToken,d.assets.application),suite=await asset('suites',seedToken,d.assets.suite);
   const input=i=>({appId:app.id,suiteId:suite.id,candidate:'load-'+i,commitRef:'course-local',source:'replay',scenario:'passing'});
   await parallel(s.seed,async row=>{
    row.state='not_sent';row.key=d.key();
    let r;
    try{r=await call('jobs',seedToken,input('seed-'+row.i),row.key,{phase:'seed',workspace:s.workspace},()=>{row.state='sent';},value=>{
     row.responseStatus=value.status;row.outcome=value.outcome;row.responseObserved=value.status!==null;
     if(uuid.test(value.data?.id??''))row.observedId=value.data.id;
    });}catch(error){row.state=row.responseObserved?'response_evidence_incomplete':row.state==='sent'?'response_unknown':'not_sent';throw error;}
    if(r.status!==202||r.outcome!=='response_received'||!uuid.test(r.data?.id??'')){row.state=r.status===null||r.status>=500||r.status===202?'response_unknown':'rejected';fault('seed_response');}
    row.id=r.data.id;row.state='admitted';
   },6);
   await parallel(s.seed,async row=>{
    const j=await complete(row.id,seedToken,input('seed-'+row.i),s.workspace);row.observedStatus=j.status??null;row.observedGate=j.result?.gate??null;
    if(j.status!=='succeeded'||j.result?.gate!=='passed'){row.state=j.error?'result_unknown':'execution_failed';fault('seed_completion');}
    row.state='completed';
   },12);
   check();s.before=await d.telemetry();s.state='measuring';let sequence=0;
   const start=d.clock.now(),deadline=start+d.seconds*1000;
   await Promise.all(Array.from({length:4},async(_,client)=>{
    while(!stopped&&d.clock.now()<deadline){
     const i=sequence++,write=i%4===3,row={i,client,kind:write?'write':'read',status:null,passed:false,networkEntered:false,atMs:null,durationMs:null,...(write?{key:d.key()}: {})};
     const path=write?'jobs':i%2?'jobs/'+s.seed[i%s.seed.length].id:'jobs?limit=25&offset='+((i*7)%Math.max(1,s.initialRows-25));
     try{
      const r=await call(path,loadToken,write?input(i):undefined,row.key,{phase:'measured'},()=>{row.networkEntered=true;},value=>{
       row.atMs=value.began-start;row.durationMs=value.durationMs;row.status=value.status;row.outcome=value.outcome;row.responseObserved=value.status!==null;
       if(write&&uuid.test(value.data?.id??''))row.observedId=value.data.id;
      });
      const bodyValid=write?uuid.test(r.data?.id??''):path.startsWith('jobs/')?r.data?.id===path.slice(5):Array.isArray(r.data);
      row.passed=r.status===(write?202:200)&&r.outcome==='response_received'&&bodyValid;
      if(write&&row.passed)row.id=r.data.id;
      if(!row.passed)stopped=true;
     }catch(error){row.error=safe(error);row.outcome=row.responseObserved?'response_evidence_incomplete':row.networkEntered?'response_unknown':'not_sent';stopped=true;}
     s.raw.push(row);
     await d.clock.sleep(100);
    }
   }));
   s.elapsedMs=d.clock.now()-start;s.after=await d.telemetry();
   const authFailure=s.raw.some(r=>[401,403].includes(r.status));
   for(const row of s.raw.filter(r=>r.kind==='write')){
    const written={i:row.i,key:row.key,id:row.id??row.observedId??null,admissionResponseStatus:row.status,submissionOutcome:row.passed?'accepted':row.outcome??'response_unknown',status:null,gate:null};
    s.writtenJobs.push(written);
    if(!written.id&&!authFailure&&row.networkEntered&&(row.status===null||row.status>=500||row.status===202)){
     const q=await call('jobs/submissions/'+row.key,loadToken,undefined,undefined,{phase:'reconciliation',observation:true});
     written.reconciliationStatus=q.status;
     if(q.status===200&&q.data?.submissionState==='accepted'&&uuid.test(q.data?.id??''))written.id=q.data.id;
     written.reconciliationLimit='Read-only observation;404 is not definitive and never authorizes resubmission.';
    }
   }
   // Observe all known attempted writes, including uncertain responses found by key.
   // They remain errors in admission statistics even when a job later completes.
   const observed=s.writtenJobs.filter(w=>w.id&&!authFailure);
   let at=0;
   await Promise.all(Array.from({length:Math.min(12,observed.length)},async()=>{
    while(at<observed.length){const w=observed[at++],j=await complete(w.id,loadToken,input(w.i),s.workspace);w.status=j.status??null;w.gate=j.result?.gate??null;w.observationError=j.error??null;}
   }));
   s.databaseRowsAfter=await d.rowCount(s.workspace);
   s.requests=s.raw.length;s.errors=s.raw.filter(r=>!r.passed).length;
   s.attemptedWrites=s.raw.filter(r=>r.kind==='write'&&r.networkEntered).length;
   s.admittedWrites=s.raw.filter(r=>r.kind==='write'&&r.passed).length;
   s.completedWrites=s.writtenJobs.filter(w=>w.submissionOutcome==='accepted'&&w.status==='succeeded'&&w.gate==='passed').length;
   s.observedCompletedWritesAllAttempts=s.writtenJobs.filter(w=>w.status==='succeeded'&&w.gate==='passed').length;
   s.rowCountMatches=s.databaseRowsAfter===s.initialRows+s.admittedWrites;
   s.measurements=summarizeStage(s.raw,s.elapsedMs);
   if(s.errors||s.completedWrites!==s.admittedWrites||!s.rowCountMatches||s.measurements.some(m=>m.timingValid===false))fault('read_write_correctness');
   s.state='completed';await event({kind:'stage_completed',initialRows:s.initialRows,requests:s.requests});
  }
  report.passed=report.stages.every(s=>s.state==='completed');
 }catch(error){report.error=safe(error);const current=report.stages.find(s=>!['completed','not_started'].includes(s.state));if(current)current.state='failed';}
 report.requestIntents=requests;report.transportInvocations=sends;
 return report;
}
