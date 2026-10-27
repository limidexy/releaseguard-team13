// Binary subprocess boundary for the inactive backup operator. Import is inert.
// A closed local process is not proof that a remote database command stopped.
import {spawn} from 'node:child_process';
export function backupProcess(command,args,options){
 const max=options?.maxBuffer,timeout=options?.timeout,input=options?.input;
 const empty=code=>({status:null,signal:null,error:{code},stdout:Buffer.alloc(0),stderr:Buffer.alloc(0),spawnEntered:false,outputTruncated:false});
 if(!Number.isInteger(timeout)||timeout<1||timeout>120000||!Number.isInteger(max)||max<1||max>66*1024*1024||input!==undefined&&(!Buffer.isBuffer(input)||input.length>64*1024*1024))return Promise.resolve(empty('EINVAL'));
 if(options.signal?.aborted)return Promise.resolve(empty('ABORT_ERR'));
 const grouped=process.platform!=='win32';
 return new Promise(resolve=>{
  let child,error,spawnFailed=false,closed=false,settled=false,terminating=false,grace,finalWait,status=null,rawCloseCode=null,signal=null,stored=0,outBytes=0,errBytes=0,truncated=false,entered=false;const out=[],err=[];
  const kill=s=>{if(!child?.pid)return;try{if(grouped)process.kill(-child.pid,s);else child.kill(s);}catch{}};
  function alive(){if(!grouped||!child?.pid)return false;try{process.kill(-child.pid,0);return true;}catch{return false;}}
  function finish(){if(settled)return;settled=true;clearTimeout(timer);clearTimeout(grace);clearTimeout(finalWait);options.signal?.removeEventListener('abort',abort);
   resolve({status,rawCloseCode,signal,...(error?{error}:{}),stdout:Buffer.concat(out),stderr:Buffer.concat(err),stdoutBytes:outBytes,stderrBytes:errBytes,spawnEntered:entered,outputTruncated:truncated,
    localProcessBoundary:grouped?'owned local process group only; remote completion remains separately verified':'Windows unit boundary; no descendant or remote completion claim'});}
  function terminate(code){if(settled)return;error??={code};if(terminating)return;terminating=true;kill('SIGTERM');grace=setTimeout(()=>{kill('SIGKILL');if(closed)finish();else finalWait=setTimeout(()=>{error={code:'CHILD_TERMINATION_UNKNOWN'};finish();},1000);},250);}
  const abort=()=>terminate('ABORT_ERR'),timer=setTimeout(()=>terminate('ETIMEDOUT'),timeout);
  function chunk(value,dest,isOut){const b=Buffer.from(value);if(isOut)outBytes+=b.length;else errBytes+=b.length;const available=Math.max(0,max-stored);if(available){const saved=b.subarray(0,available);dest.push(saved);stored+=saved.length;}if(outBytes+errBytes>max){truncated=true;terminate('ENOBUFS');}}
  try{entered=true;child=spawn(command,args,{cwd:options.cwd,env:options.env,detached:grouped,stdio:[input===undefined?'ignore':'pipe','pipe','pipe']});}
  catch(e){error={code:e.code??'UNKNOWN'};closed=true;finish();return;}
  child.stdout?.on('data',b=>chunk(b,out,true));child.stderr?.on('data',b=>chunk(b,err,false));
  child.once('error',e=>{spawnFailed=!child.pid;error??={code:e.code??'UNKNOWN'};});
  child.once('close',(code,sig)=>{closed=true;rawCloseCode=Number.isInteger(code)?code:null;status=!spawnFailed&&Number.isInteger(code)&&code>=0?code:null;signal=sig??null;if(terminating)return;if(alive()){terminate('CHILDREN_UNKNOWN');return;}finish();});
  if(input!==undefined){child.stdin?.once('error',()=>terminate('STDIN_OUTCOME_UNKNOWN'));child.stdin?.end(input);}
  options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort();
 });
}
