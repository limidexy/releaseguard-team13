// Inactive program text for a separately approved isolated Linux/Node24 Worker.
// Import never executes it. The operator sends this exact program through its
// closed kubectl adapter. Tests execute it only in a VM with fake fs/processes.
// An in-container launcher-owned agent, not the operator's finally/timer, owns both
// signals. Even an unknown CONT is never resent. Agent death, node failure,
// malicious same-UID code and hard storage failures remain recovery risks.
function remoteWorkerPause(){
 const fs=require('node:fs'),{createHash}=require('node:crypto');
 const C=fs.constants,root='/run/releaseguard-fault/owned',deny=()=>{throw Error('refused');};
 let c,folder,agent=false,stopEntered=false,continueEntered=false,stopWasObserved=false,stimulusIntact=true,resumeTimer,pollTimer,stopNs=null;
 const keys=['mode','runId','podUID','mainSHA256','pidNamespace','pidStartTicks','workerPID','launcherSHA256','notAfterEpochMs','pauseMs'];
 const hash=b=>createHash('sha256').update(b).digest('hex');
 function bytes(path,limit){const h=fs.openSync(path,C.O_RDONLY|C.O_NOFOLLOW);try{const s=fs.fstatSync(h);if(!s.isFile()||s.size>limit)deny();const b=Buffer.alloc(limit+1);let n=0;
  for(;;){const k=fs.readSync(h,b,n,b.length-n,null);if(!k)break;n+=k;if(n>limit)deny();}if(n!==s.size)deny();return b.subarray(0,n);
 }finally{fs.closeSync(h);}}
 function pidState(pid=c.workerPID){const m=fs.readFileSync('/proc/'+pid+'/status','utf8').match(/^State:\s+([A-Za-z])/m);if(!m)deny();return m[1];}
 function identity(compare=true){
  if(process.platform!=='linux'||Number(process.versions.node.split('.')[0])!==24||process.pid===1||process.getuid()!==1000||process.env.SERVICE_ROLE!=='worker'||process.env.RG_TRIAL_POD_UID!==c.podUID)deny();
  const init=fs.readFileSync('/proc/1/cmdline','utf8').split('\0').filter(Boolean);
  if(init.length!==3||!['node','/usr/local/bin/node'].includes(init[0])||init[1]!=='-e'||hash(init[2])!==c.launcherSHA256)deny();
  const children=fs.readFileSync('/proc/1/task/1/children','utf8').trim().split(/\s+/).filter(Boolean);if(children.length>128)deny();
  const candidates=children.filter(text=>/^\d+$/.test(text)&&Number(text)>1&&Number(text)!==process.pid).filter(pid=>{try{const cmd=fs.readFileSync('/proc/'+pid+'/cmdline','utf8').split('\0').filter(Boolean);return cmd.length===2&&['node','/usr/local/bin/node'].includes(cmd[0])&&cmd[1]==='dist/src/main.js';}catch(e){if(e.code==='ENOENT')return false;throw e;}});
  if(candidates.length!==1)deny();const pid=Number(candidates[0]),status=fs.readFileSync('/proc/'+pid+'/status','utf8');
  if(Number(status.match(/^Uid:\s+(\d+)/m)?.[1])!==process.getuid()||Number(status.match(/^PPid:\s+(\d+)/m)?.[1])!==1)deny();
  const ns=fs.readlinkSync('/proc/self/ns/pid'),other=fs.readlinkSync('/proc/'+pid+'/ns/pid'),stat=fs.readFileSync('/proc/'+pid+'/stat','utf8'),ticks=stat.slice(stat.lastIndexOf(') ')+2).trim().split(/\s+/)[19];
  const digest=hash(bytes('/app/dist/src/main.js',2*1024*1024));
  if(!/^pid:\[\d+\]$/.test(ns)||ns!==other||!/^\d{1,24}$/.test(ticks??'')||digest!==c.mainSHA256||compare&&(pid!==c.workerPID||ns!==c.pidNamespace||ticks!==c.pidStartTicks))deny();
  return {podUID:c.podUID,mainSHA256:digest,pidNamespace:ns,pidStartTicks:ticks,workerPID:pid,workerState:pidState(pid),launcherSHA256:c.launcherSHA256};
 }
 function dir(path,create=false){
  if(create)try{fs.mkdirSync(path,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
  const s=fs.lstatSync(path);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o077)!==0)deny();
 }
 function syncDir(){const h=fs.openSync(folder,C.O_RDONLY|C.O_DIRECTORY|C.O_NOFOLLOW);try{fs.fsyncSync(h);}finally{fs.closeSync(h);}}
 function put(name,value){dir(folder);const h=fs.openSync(folder+'/'+name,C.O_WRONLY|C.O_CREAT|C.O_EXCL|C.O_NOFOLLOW,0o600);try{fs.writeFileSync(h,JSON.stringify(value)+'\n');fs.fsyncSync(h);}finally{fs.closeSync(h);}syncDir();}
 function get(name){dir(folder);const path=folder+'/'+name;try{const s=fs.lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o077)!==0)deny();return JSON.parse(bytes(path,65536));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
 const samePlan=p=>p&&['runId','podUID','mainSHA256','pidNamespace','pidStartTicks','workerPID','launcherSHA256','pauseMs'].every(k=>p[k]===c[k]);
 function plan(){const p=get('plan.json');if(!samePlan(p))deny();return p;}
 function result(){const p=plan(),finished=get('finished.json'),cancelled=get('cancelled-before-start.json');
  return {state:finished?'finished':cancelled?'cancelled_before_start':'pending_or_unknown',runId:c.runId,podUID:c.podUID,identity:identity(),plan:p,finished,cancelled,helperStateIsSelfReported:true};
 }
 function notify(value){try{if(process.send&&process.connected)process.send(value,()=>{});}catch{}}
 async function resumeOnce(reason){
  if(continueEntered||!stopEntered)return;continueEntered=true;clearTimeout(resumeTimer);clearInterval(pollTimer);
  let observed=false,code='unconfirmed';try{
   // Both intents were persisted before this agent entered STOP. Recovery
   // keeps that in-memory authority and rechecks the child identity; a later
   // journal outage must not prevent its single CONT attempt.
   identity();
   if(!['T','t'].includes(pidState()))stimulusIntact=false;
   if(reason==='external_state_change')stimulusIntact=false;
   process.kill(c.workerPID,'SIGCONT'); // Sole CONT boundary, never PID1; no retry.
   for(let i=0;i<25;i++){if(!['T','t','Z','X'].includes(pidState())){observed=true;break;}await new Promise(r=>setTimeout(r,20));}
   code=observed?'resumed_observed':'resume_unconfirmed';
  }catch{code='resume_failed_or_unknown_no_retry';}
  const ended={runId:c.runId,podUID:c.podUID,workerPID:c.workerPID,reason,code,resumeObserved:observed,stopSignalAttempted:true,continueSignalAttempts:1,
   at:new Date().toISOString(),pauseMs:stopNs===null?null:Number(process.hrtime.bigint()-stopNs)/1e6,stimulusIntegrity:stimulusIntact&&stopWasObserved,
   pauseMeasure:'Elapsed STOP attempt to active-state observation; not continuous-state or SLA proof',notRecoverySLA:true};
  try{put('finished.json',ended);}catch{}notify({state:'finished',...ended});
  try{if(process.connected)process.disconnect();}catch{}
 }
 async function main(){
  if(process.argv.length!==2||typeof process.argv[1]!=='string'||Buffer.byteLength(process.argv[1])>8192)deny();c=JSON.parse(process.argv[1]);
  if(!c||Object.keys(c).length!==keys.length||keys.some(k=>!Object.hasOwn(c,k))||!['inspect','start','agent','status','request-resume'].includes(c.mode)||
   !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(c.runId??'')||
   typeof c.podUID!=='string'||!/^[-A-Za-z0-9]{1,100}$/.test(c.podUID)||!/^[a-f0-9]{64}$/.test(c.mainSHA256??'')||!/^[a-f0-9]{64}$/.test(c.launcherSHA256??'')||c.pauseMs!==17000)deny();
  if(c.mode==='inspect'){
   if(c.pidNamespace!==null||c.pidStartTicks!==null||c.workerPID!==null||c.notAfterEpochMs!==null)deny();const own=identity(false);if(['T','t','Z','X'].includes(own.workerState))deny();console.log(JSON.stringify({state:'inspected',identity:own}));return;
  }
  if(!/^pid:\[\d+\]$/.test(c.pidNamespace??'')||!/^\d{1,24}$/.test(c.pidStartTicks??'')||!Number.isInteger(c.workerPID)||c.workerPID<=1||c.workerPID>4194304||!Number.isSafeInteger(c.notAfterEpochMs))deny();
  const own=identity();folder=root+'/'+c.runId;
  if(c.mode==='start'||c.mode==='agent')if(Date.now()>c.notAfterEpochMs||c.notAfterEpochMs-Date.now()>15000)deny();
  if(c.mode==='start'){
   if(['T','t','Z','X'].includes(own.workerState))deny();dir(root,true);fs.mkdirSync(folder,{mode:0o700});dir(folder);put('plan.json',{...c,mode:'plan',createdAt:new Date().toISOString()});
   put('start-request.json',{runId:c.runId,podUID:c.podUID,at:new Date().toISOString()});
   for(let i=0;i<25;i++){
    const stopped=get('stop-observed.json');if(stopped?.stopObserved===true&&get('continue-intent.json')&&samePlan(plan())){console.log(JSON.stringify({state:'stopped',runId:c.runId,podUID:c.podUID,watchdogArmed:true,identity:identity(),stopObserved:true}));return;}
    if(get('finished.json')||get('agent-failed.json'))deny();await new Promise(r=>setTimeout(r,200));
   }deny();
  }
  if(c.mode==='status'){
   try{dir(root);dir(folder);}catch(e){if(e.code==='ENOENT'){console.log(JSON.stringify({state:'no_run_observed',runId:c.runId,podUID:c.podUID,notProofOfNoDelayedStart:true}));return;}throw e;}
   console.log(JSON.stringify(result()));return;
  }
  if(c.mode==='request-resume'){
   dir(root,true);let fresh=false;try{fs.mkdirSync(folder,{mode:0o700});fresh=true;}catch(e){if(e.code!=='EEXIST')throw e;}dir(folder);
   if(fresh){put('plan.json',{...c,mode:'plan',createdAt:new Date().toISOString()});put('cancelled-before-start.json',{runId:c.runId,podUID:c.podUID,at:new Date().toISOString()});}
   else{plan();if(!get('finished.json')&&!get('cancelled-before-start.json'))put('resume-request.json',{runId:c.runId,podUID:c.podUID,at:new Date().toISOString()});}
   console.log(JSON.stringify(result()));return;
  }
  agent=true;if(['T','t','Z','X'].includes(own.workerState))deny();dir(root);dir(folder);plan();if(!get('agent-intent.json')||get('cancelled-before-start.json')||get('stop-intent.json')||get('finished.json'))deny();
  // Reserve both original signal intents BEFORE STOP. CONT can still be tried
  // once after a later journal failure; no guarantee if this agent is killed.
  put('continue-intent.json',{...c,mode:'scheduled_or_requested_once'});put('stop-intent.json',{runId:c.runId,podUID:c.podUID,at:new Date().toISOString()});
  if(get('resume-request.json')){put('finished.json',{runId:c.runId,podUID:c.podUID,reason:'cancelled_before_stop',resumeObserved:true,stopSignalAttempted:false,continueSignalAttempts:0,pauseMs:0,at:new Date().toISOString()});notify({state:'cancelled_before_stop'});return;}
  resumeTimer=setTimeout(()=>{void resumeOnce('watchdog');},17000);
  pollTimer=setInterval(()=>{try{if(get('resume-request.json'))void resumeOnce('operator_request');else if(stopEntered&&!continueEntered&&!['T','t'].includes(pidState()))void resumeOnce('external_state_change');}catch{void resumeOnce('journal_read_failure');}},100);
  const latest=identity();if(['T','t','Z','X'].includes(latest.workerState)||Date.now()>c.notAfterEpochMs)deny();stopNs=process.hrtime.bigint();stopEntered=true;
  process.kill(c.workerPID,'SIGSTOP'); // Verified Worker child, never namespace init.
  let stopped=false;for(let i=0;i<25;i++){if(['T','t'].includes(pidState())){stopped=true;break;}await new Promise(r=>setTimeout(r,20));}
  if(!stopped)deny();stopWasObserved=true;put('stop-observed.json',{runId:c.runId,podUID:c.podUID,at:new Date().toISOString(),stopObserved:true});
  notify({state:'stopped',runId:c.runId,podUID:c.podUID,watchdogArmed:true,identity:own,stopObserved:true});
 }
 return main().catch(async()=>{
  if(agent&&stopEntered)await resumeOnce('agent_failure');else{clearTimeout(resumeTimer);clearInterval(pollTimer);}
  console.log(JSON.stringify({state:'refused_or_unknown',noRetry:true}));process.exitCode=1;
 });
}
export const workerPauseProgram='('+remoteWorkerPause.toString()+')();';
