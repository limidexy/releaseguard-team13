// Future opt-in isolated fixture only. Default image/manifest never invokes it.
// The unchanged Worker is a direct child, not PID1 (namespace init cannot be
// stopped by an in-namespace SIGSTOP). This launcher also owns/reaps each agent.
import {createHash} from 'node:crypto';
import {workerPauseProgram} from './worker-pause-program.mjs';
function workerFaultInit(remoteSource){
 const fs=require('node:fs'),{spawn}=require('node:child_process'),{createHash}=require('node:crypto'),C=fs.constants;
 const root='/run/releaseguard-fault/owned',deny=()=>{throw Error('refused');},hash=b=>createHash('sha256').update(b).digest('hex');
 const source='('+workerFaultInit.toString()+')('+JSON.stringify(remoteSource)+');',selfSHA256=hash(source);let worker,poll,killTimer,stopping=false;
 function dir(p,create=false){if(create)try{fs.mkdirSync(p,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}const s=fs.lstatSync(p);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==1000||(s.mode&0o077)!==0)deny();}
 function read(p){const h=fs.openSync(p,C.O_RDONLY|C.O_NOFOLLOW);try{const s=fs.fstatSync(h);if(!s.isFile()||s.uid!==1000||(s.mode&0o077)!==0||s.size>8192)deny();return JSON.parse(fs.readFileSync(h));}finally{fs.closeSync(h);}}
 function put(p,v){const h=fs.openSync(p,C.O_WRONLY|C.O_CREAT|C.O_EXCL|C.O_NOFOLLOW,0o600);try{fs.writeFileSync(h,JSON.stringify(v)+'\n');fs.fsyncSync(h);}finally{fs.closeSync(h);}}
 function shutdown(signal){if(stopping)return;stopping=true;clearInterval(poll);if(worker?.pid){try{process.kill(worker.pid,'SIGCONT');}catch{}try{process.kill(worker.pid,signal);}catch{}
  killTimer=setTimeout(()=>{try{process.kill(worker.pid,'SIGKILL');}catch{}},25000);}}
 try{
  if(process.platform!=='linux'||process.pid!==1||process.getuid()!==1000||process.env.SERVICE_ROLE!=='worker'||!/^[-A-Za-z0-9]{1,100}$/.test(process.env.RG_TRIAL_POD_UID??''))deny();
  dir(root,true);worker=spawn(process.execPath,['dist/src/main.js'],{stdio:'inherit',env:process.env});
  worker.once('error',()=>{clearInterval(poll);process.exit(1);});worker.once('exit',(code)=>{clearInterval(poll);clearTimeout(killTimer);process.exit(Number.isInteger(code)&&code>=0?code:1);});
  for(const signal of ['SIGTERM','SIGINT','SIGHUP'])process.on(signal,()=>shutdown(signal));
  poll=setInterval(()=>{
   if(stopping)return;
   try{
    const names=fs.readdirSync(root);if(names.length>128)deny();
    for(const run of names){if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(run))continue;
     const folder=root+'/'+run;dir(folder);const exists=name=>{try{return Boolean(fs.lstatSync(folder+'/'+name));}catch(e){if(e.code==='ENOENT')return false;throw e;}};
     if(!exists('start-request.json')||exists('agent-intent.json')||exists('cancelled-before-start.json')||exists('finished.json'))continue;
     const p=read(folder+'/plan.json');if(p.runId!==run||p.podUID!==process.env.RG_TRIAL_POD_UID||p.workerPID!==worker.pid||p.launcherSHA256!==selfSHA256||p.pauseMs!==17000||Date.now()>p.notAfterEpochMs)continue;
     put(folder+'/agent-intent.json',{runId:run,podUID:p.podUID,workerPID:p.workerPID,at:new Date().toISOString(),noRetry:true});
     // Direct child of init: it survives the remote exec's exit and is reaped.
     const {createdAt,...packet}=p; // Journal metadata is not an executable packet field.
     const agent=spawn(process.execPath,['-e',remoteSource,JSON.stringify({...packet,mode:'agent'})],{detached:true,stdio:'ignore',env:{NODE_ENV:'production',SERVICE_ROLE:'worker',RG_TRIAL_POD_UID:p.podUID}});
     agent.once('error',()=>{try{put(folder+'/agent-failed.json',{state:'spawn_failed_or_unknown',noRetry:true});}catch{}});
     agent.once('exit',(code)=>{try{put(folder+'/agent-exit.json',{code:Number.isInteger(code)?code:null,at:new Date().toISOString(),noRetry:true});}catch{}});
    }
   }catch{clearInterval(poll);console.error('Worker fault fixture journal unconfirmed; no new agent will start.');}
  },100);
 }catch{console.error('Isolated Worker fault fixture refused.');process.exitCode=1;}
}
export const workerPauseInitProgram='('+workerFaultInit.toString()+')('+JSON.stringify(workerPauseProgram)+');';
export const workerPauseInitSHA256=createHash('sha256').update(workerPauseInitProgram).digest('hex');
