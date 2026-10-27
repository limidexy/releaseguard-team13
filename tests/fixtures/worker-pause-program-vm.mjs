// Exact launcher and remote program under fake Linux/process/fs/clock only.
// No OS process, signal, socket, mount or cloud is used or forwarded. This
// checks control flow and Linux-shaped identities, not kernel integration.
import {Script,createContext} from 'node:vm';
import {EventEmitter} from 'node:events';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {workerPauseProgram} from '../../scripts/worker-pause-program.mjs';
import {workerPauseInitProgram,workerPauseInitSHA256} from '../../scripts/worker-pause-init.mjs';
const clone=x=>structuredClone(x),err=code=>Object.assign(Error('SYNTHETIC '+code),{code});
const epoch=Date.parse('2000-01-01T00:00:00Z');
export function pauseProgramVM(options={}){
 const main=Buffer.from('SYNTHETIC_COMPILED_WORKER_ONLY'),mainSHA256=createHash('sha256').update(main).digest('hex'),files=new Map(),handles=new Map(),timers=new Map(),signals=[],spawns=[],fsCalls=[],contexts=[];
 let clock=0,nextFD=10,nextTimer=0,serial=100,nextPID=50,contUnknown=false,workerChild,init;
 const state={podUID:'synthetic-pod-uid-1',pidNamespace:'pid:[50001]',pidStartTicks:'123456',workerPID:7,workerState:'S',role:'worker',platform:'linux',main,uid:1000};
 const inode=(data,dir=false,uid=1000,mode=dir?0o40700:0o100600)=>({data:Buffer.from(data??''),dir,uid,mode,ino:++serial});
 files.set('/run/releaseguard-fault',inode('',true,0,0o42770));files.set('/app/dist/src/main.js',inode(main));
 const stat=x=>({uid:x.uid,mode:x.mode,ino:x.ino,size:x.data.length,nlink:1,isFile:()=>!x.dir,isDirectory:()=>x.dir,isSymbolicLink:()=>x.link===true});
 const get=p=>{if(options.failRead?.(p))throw err('EIO');const x=files.get(p);if(!x)throw err('ENOENT');return x;};
 const text=p=>{
  if(p==='/proc/1/cmdline')return options.directPID1?'node\0dist/src/main.js\0':'node\0-e\0'+workerPauseInitProgram+'\0';
  if(p==='/proc/1/task/1/children')return [state.workerPID,...contexts.filter(x=>x.c.mode==='agent'&&!x.exited).map(x=>x.process.pid),...(options.duplicateWorker?[8]:[])].join(' ');
  if(p==='/proc/'+state.workerPID+'/cmdline'||options.duplicateWorker&&p==='/proc/8/cmdline')return 'node\0dist/src/main.js\0';
  if(p==='/proc/'+state.workerPID+'/status')return 'Name:\tnode\nState:\t'+state.workerState+' (synthetic)\nPPid:\t1\nUid:\t1000\t1000\t1000\t1000\n';
  if(p==='/proc/'+state.workerPID+'/stat')return state.workerPID+' (node) '+[state.workerState,...Array(18).fill('0'),state.pidStartTicks,'0','0'].join(' ');
  const agent=contexts.find(x=>p==='/proc/'+x.process.pid+'/cmdline'&&x.c.mode==='agent'&&!x.exited);if(agent)return 'node\0-e\0'+workerPauseProgram+'\0';
  return get(p).data.toString();
 };
 const fs={constants,
  mkdirSync(p,{mode}){fsCalls.push({op:'mkdir',path:p});if(files.has(p))throw err('EEXIST');get(p.slice(0,p.lastIndexOf('/')));files.set(p,inode('',true,state.uid,0o40000|mode));},
  lstatSync:p=>stat(get(p)),
  readdirSync:p=>{get(p);return [...files.keys()].filter(x=>x.startsWith(p+'/')&&!x.slice(p.length+1).includes('/')).map(x=>x.slice(p.length+1));},
  readlinkSync:p=>{if(!['/proc/self/ns/pid','/proc/'+state.workerPID+'/ns/pid'].includes(p))throw err('ENOENT');return state.pidNamespace;},
  readFileSync:(p,encoding)=>{const s=typeof p==='number'?get(handles.get(p).path).data:text(p);return encoding?String(s):Buffer.from(s);},
  openSync(p,flags,mode){fsCalls.push({op:'open',path:p,flags});if(flags&constants.O_CREAT){if(!p.startsWith('/run/releaseguard-fault/owned/'))throw err('EROFS');if(files.has(p)&&flags&constants.O_EXCL)throw err('EEXIST');get(p.slice(0,p.lastIndexOf('/')));if(!files.has(p))files.set(p,inode('',false,state.uid,0o100000|mode));}
   const x=get(p);if(x.link&&flags&constants.O_NOFOLLOW)throw err('ELOOP');const fd=++nextFD;handles.set(fd,{path:p,pos:0});return fd;
  },
  fstatSync:fd=>stat(get(handles.get(fd).path)),
  readSync(fd,buffer,offset,length,position){const h=handles.get(fd),b=get(h.path).data,pos=position??h.pos,n=Math.max(0,Math.min(length,b.length-pos));b.copy(buffer,offset,pos,pos+n);h.pos=pos+n;return n;},
  writeFileSync(fd,b){const p=handles.get(fd).path;fsCalls.push({op:'write',path:p});get(p).data=Buffer.from(b);},
  fsyncSync(fd){const path=handles.get(fd).path;if(options.failSync?.(path))throw err('EIO');},
  closeSync:fd=>handles.delete(fd),
 };
 const timer=(fn,ms,repeat,ctx)=>{const id=++nextTimer;timers.set(id,{fn,due:clock+ms,ms,repeat,ctx});return id;},clear=id=>timers.delete(id);
 function end(ctx,code){if(ctx.exited)return;ctx.exited=true;ctx.process.exitCode=code;for(const [id,t]of timers)if(t.ctx===ctx)timers.delete(id);ctx.child?.emit('exit',code,null);}
 function reap(){for(const ctx of contexts)if(ctx.child&&ctx.settled&&!ctx.exited&&![...timers.values()].some(t=>t.ctx===ctx))end(ctx,ctx.process.exitCode);}
 function launch(c,extra={},source=workerPauseProgram,childRef){
  const out=[],errors=[],p=new EventEmitter(),ctx={c,out,errors,process:p,child:childRef,exited:false,settled:false};contexts.push(ctx);
  Object.assign(p,{platform:state.platform,versions:{node:'24.10.0'},pid:c.mode==='init'?1:++nextPID,execPath:'/usr/local/bin/node',argv:['/usr/local/bin/node',JSON.stringify(c)],
   env:{SERVICE_ROLE:state.role,RG_TRIAL_POD_UID:state.podUID,...extra},getuid:()=>state.uid,hrtime:{bigint:()=>BigInt(clock)*1000000n},exitCode:0,
   exit:code=>end(ctx,code),
   kill:(pid,signal)=>{signals.push({pid,signal,at:clock,podUID:state.podUID,pidNamespace:state.pidNamespace,callerPID:p.pid});
    if(pid===1)throw Error('Namespace init must never receive an in-namespace fault signal');
    if(pid!==state.workerPID||!['SIGSTOP','SIGCONT','SIGTERM','SIGINT','SIGHUP','SIGKILL'].includes(signal))throw Error('Unexpected synthetic signal');
    if(signal==='SIGSTOP')state.workerState='T';if(signal==='SIGCONT')state.workerState='S';
    if(signal==='SIGCONT'&&options.unknownCONT&&!contUnknown){contUnknown=true;throw err('SYNTHETIC_SIGNAL_UNKNOWN');}
   },
  });
  const child={spawn(command,args,opts){
   if(c.mode!=='init'||command!=='/usr/local/bin/node')throw Error('Only the exact PID1 launcher may own synthetic children');
   const e=new EventEmitter();
   if(args.length===1&&args[0]==='dist/src/main.js'&&opts.stdio==='inherit'){
    e.pid=state.workerPID;workerChild=e;spawns.push({kind:'worker',command,args:clone(args),options:clone(opts),pid:e.pid,parentPID:1});return e;
   }
   if(args.length!==3||args[0]!=='-e'||args[1]!==workerPauseProgram||opts.detached!==true||opts.stdio!=='ignore')throw Error('Unexpected synthetic agent spawn');
   spawns.push({kind:'agent',command,args:clone(args),options:clone(opts),parentPID:1});
   queueMicrotask(()=>{options.beforeAgent?.(state);e.agent=launch(JSON.parse(args[2]),opts.env,workerPauseProgram,e);e.pid=e.agent.process.pid;});return e;
  }};
  class FakeDate extends Date{constructor(...a){super(...(a.length?a:[epoch+clock]));}static now(){return epoch+clock;}}
  const context=createContext({Buffer,process:p,Date:FakeDate,console:{log:s=>out.push(String(s)),error:s=>errors.push(String(s))},
   require:name=>{if(name==='node:fs')return fs;if(name==='node:crypto')return {createHash};if(name==='node:child_process')return child;throw Error('Unselected synthetic module');},
   setTimeout:(fn,ms)=>timer(fn,ms,false,ctx),clearTimeout:clear,setInterval:(fn,ms)=>timer(fn,ms,true,ctx),clearInterval:clear,
  });
  ctx.promise=Promise.resolve(new Script(source).runInContext(context,{timeout:1000})).then(v=>{ctx.settled=true;return v;});return ctx;
 }
 const config={mode:'inspect',runId:'51111111-1111-4111-8111-111111111111',podUID:state.podUID,mainSHA256,pidNamespace:null,pidStartTicks:null,workerPID:null,launcherSHA256:workerPauseInitSHA256,notAfterEpochMs:null,pauseMs:17000};
 const ready=()=>({...config,mode:'start',pidNamespace:state.pidNamespace,pidStartTicks:state.pidStartTicks,workerPID:state.workerPID,notAfterEpochMs:epoch+clock+10000});
 async function flush(){await new Promise(r=>setImmediate(r));reap();await new Promise(r=>setImmediate(r));}
 async function advance(ms){const endTime=clock+ms;let count=0;
  for(;;){const next=[...timers.entries()].filter(([,t])=>t.due<=endTime).sort((a,b)=>a[1].due-b[1].due)[0];if(!next)break;if(++count>10000)throw Error('Synthetic timer bound');const [id,t]=next;clock=t.due;if(t.repeat)t.due+=t.ms;else timers.delete(id);t.fn();await flush();}
  clock=endTime;await flush();
 }
 if(!options.directPID1)init=launch({mode:'init'}, {},workerPauseInitProgram);
 const run=async(c,extra)=>{const x=launch(c,extra);await flush();const deadline=clock+6000;
  while(!x.settled){const next=Math.min(...[...timers.values()].map(t=>t.due));if(!Number.isFinite(next)||next>deadline)throw Error('Synthetic helper did not settle');await advance(Math.max(0,next-clock));}
  await x.promise;return {exitCode:x.process.exitCode,output:x.out.map(JSON.parse),context:x};};
 return {state,files,fsCalls,signals,spawns,contexts,config,ready,run,advance,now:()=>clock,
  records:()=>Object.fromEntries([...files].filter(([p,x])=>!x.dir&&p.startsWith('/run/')).map(([p,x])=>[p,JSON.parse(x.data)])),
  killAgent:()=>{for(const ctx of contexts)if(ctx.c.mode==='agent'&&!ctx.exited)end(ctx,null);},
  launcherSignal:signal=>init?.process.emit(signal),workerExit:(code=0)=>workerChild?.emit('exit',code,null),
  get init(){return init;},
 };
}
