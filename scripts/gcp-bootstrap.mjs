// Explicit new-environment local preparation only. Never invoked by application,
// CI or CD entry points. No cloud/identity/model/network operation exists here.
// Usage (POSIX Node24/OpenSSL3 only, never executed by automated verification):
// node scripts/gcp-bootstrap.mjs --execute-new-material --input <0600 JSON>
//   --run-id <fresh UUIDv4> --ack-new-realm-only
// Exact configuration is validated by gcp-bootstrap-core.mjs. The input directory
// must be owned/private. Output stays in ignored evidence/private/gcp-bootstrap/.
// This cannot verify that a target realm is new: nothing here imports/applies it.
// Never use the new-realm credential bundle to reset any existing user's password.
// A failed/unknown run is retained permanently; its ID cannot resume or retry.
// No root CA trust installation, binary installation or cloud connection occurs.
import { constants, realpathSync } from 'node:fs';
import { lstat,mkdir,open,readdir } from 'node:fs/promises';
import { randomBytes,randomUUID,createHash } from 'node:crypto';
import { dirname,join,parse,relative,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { acceptanceProcess } from './acceptance-process.mjs';
import { validateBootstrapConfiguration,prepareNewMaterial } from './gcp-bootstrap-core.mjs';
const script=fileURLToPath(import.meta.url),root=resolve(dirname(script),'..');
const hash=x=>createHash('sha256').update(x).digest('hex'),refuse=()=>{throw Error('New material preparation refused');};
async function noLinks(path){let p=parse(path).root;for(const part of relative(p,path).split(/[\\/]/).filter(Boolean)){p=join(p,part);if((await lstat(p)).isSymbolicLink())refuse();}}
async function syncDir(path){const f=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));try{if(!(await f.stat()).isDirectory())refuse();await f.sync();}finally{await f.close();}}
async function makeDir(path,privateMode=true){
 let made=false;try{await mkdir(path,{mode:0o700});made=true;}catch(e){if(e.code!=='EEXIST')throw e;}
 const s=await lstat(path);if(!s.isDirectory()||s.isSymbolicLink()||privateMode&&((s.mode&0o077)!==0||s.uid!==process.getuid()))refuse();
 if(made)await syncDir(dirname(path));
}
async function readRegular(path,privateMode=false){
 await noLinks(path);if(privateMode){const s=await lstat(dirname(path));if((s.mode&0o077)!==0||s.uid!==process.getuid())refuse();}
 const f=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
 try{const s=await f.stat();if(!s.isFile()||s.size>262144||privateMode&&((s.mode&0o077)!==0||s.uid!==process.getuid()))refuse();
 const b=await f.readFile(),end=await f.stat();if(b.length>262144||s.size!==end.size||s.mtimeMs!==end.mtimeMs||s.ctimeMs!==end.ctimeMs)refuse();return b;
 }finally{await f.close();}
}
async function exclusive(path,value){await noLinks(dirname(path));const f=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW??0),0o600);try{await f.writeFile(value);await f.sync();}finally{await f.close();}await syncDir(dirname(path));}
export async function runBootstrapCLI(args){
 let phase='arguments',oldMask,controller,timer;
 const stop=()=>controller?.abort();
 try{
  if(process.platform==='win32'||Number(process.versions.node.split('.')[0])<24||process.env.CI||process.env.GITHUB_ACTIONS)refuse();
  if(args.length!==6||args[0]!=='--execute-new-material'||args[1]!=='--input'||args[3]!=='--run-id'||args[5]!=='--ack-new-realm-only'||
   !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(args[4]??''))refuse();
  if((await lstat(process.argv[1]??script)).isSymbolicLink())refuse();
  phase='configuration';
  const inputPath=resolve(args[2]);
  if(/^\.env(?:\.|$)|^id_(?:rsa|ed25519)(?:\.|$)|\.(?:key|pem|crt)$/.test(inputPath.split(/[\\/]/).at(-1)))refuse();
  const bytes=await readRegular(inputPath,true),input=JSON.parse(bytes.toString('utf8')),config=validateBootstrapConfiguration(input);
  const sources={};for(const file of ['scripts/gcp-bootstrap.mjs','scripts/gcp-bootstrap-core.mjs','scripts/gcp-private-core.mjs','scripts/gcp-infra-core.mjs','scripts/acceptance-process.mjs'])sources[file]=hash(await readRegular(join(root,file)));
  oldMask=process.umask(0o077);controller=new AbortController();timer=setTimeout(stop,180000);
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
  let output;const start=performance.now();
  const path=name=>{
   if(!output||!/^[-a-zA-Z0-9._]+(?:\/[-a-zA-Z0-9._]+)?$/.test(name)||name.split('/').some(s=>s==='.'||s==='..'))refuse();
   return join(output,name);
  };
  const save=(name,value)=>exclusive(path(name),value);
  const json=(name,value)=>save(name,JSON.stringify(value,null,2)+'\n');
  const io={
   get reservationOwned(){return output!==undefined;},
   signal:controller.signal,wallTime:()=>Date.now(),
   async reserve(){
    phase='reservation';await noLinks(root);let parent=root;
    for(const[part,privateMode]of [['evidence',false],['private',true],['gcp-bootstrap',true]]){parent=join(parent,part);await makeDir(parent,privateMode);}
    const proposed=join(parent,args[4]);await mkdir(proposed,{mode:0o700});output=proposed;await syncDir(parent);
    await json('started.json',{formatVersion:1,runId:args[4],state:'started',planOnly:true,inputSHA256:hash(bytes),sourceSHA256:sources,
     newRealmIsOperatorAssertionNotVerified:true,noExistingUserPasswordReset:true});
    await makeDir(path('operations'));
   },
   intent:(n,v)=>json('operations/'+String(n).padStart(3,'0')+'-intent.json',v),
   observed:(n,v)=>json('operations/'+String(n).padStart(3,'0')+'-observed.json',v),
   result:(n,v)=>json('operations/'+String(n).padStart(3,'0')+'-result.json',v),
   secret:()=>randomBytes(36).toString('hex'),id:()=>randomUUID(),
   serial:()=>{const b=randomBytes(16);b[0]=(b[0]&0x7f)|0x10;return b.toString('hex');},
   write:save,read:async name=>(await readRegular(path(name),true)).toString('utf8'),
   mkdir:async name=>{await mkdir(path(name),{mode:0o700});await syncDir(output);},
   async command(command,argv){
    const remaining=Math.floor(180000-(performance.now()-start));
    if(command!==config.opensslExecutable||remaining<=0||controller.signal.aborted)refuse();
    return acceptanceProcess(command,argv,{cwd:output,env:{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',OPENSSL_CONF:path('openssl-empty.cnf'),RANDFILE:path('random-state')},
     timeout:Math.min(60000,remaining),maxBuffer:65536,signal:controller.signal,windowsHide:true});
   },
   async inventory(){
    const rows=[];
    async function walk(base,prefix=''){
     const s=await lstat(base);if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o077)!==0||s.uid!==process.getuid())refuse();
     for(const name of(await readdir(base)).sort()){
      const full=join(base,name),info=await lstat(full),relativeName=prefix+name;
      if(info.isSymbolicLink()||(info.mode&0o077)!==0||info.uid!==process.getuid())refuse();
      if(info.isDirectory())await walk(full,relativeName+'/');
      else{if(!info.isFile())refuse();const b=await readRegular(full,true);rows.push({path:relativeName,size:b.length,sha256:hash(b)});}
     }
    }await walk(output);return rows;
   },
   async terminal(value){
    await json('terminal.json',{...value,runId:args[4],inputSHA256:hash(bytes),sourceSHA256:sources,
     fileAloneIsNotProofOfSuccessfulExitOrDurability:true});
   },
  };
  phase='protocol';const result=await prepareNewMaterial(input,io);
  if(result.state!=='new_material_prepared_not_applied'||result.evidenceState)refuse();
  console.log('New local material prepared only. New-realm status is unverified; no account, password reset, model or deployment applied.');
  return 0;
 }catch{
  console.error('New material preparation refused or unconfirmed ('+phase+'). Retain this private run; do not retry its ID. No private error or value is printed.');
  return 1;
 }finally{
  clearTimeout(timer);process.off('SIGINT',stop);process.off('SIGTERM',stop);if(oldMask!==undefined)process.umask(oldMask);
 }
}
function isMain(){try{return Boolean(process.argv[1])&&realpathSync(process.argv[1])===realpathSync(script);}catch{return false;}}
if(isMain())process.exitCode=await runBootstrapCLI(process.argv.slice(2));

