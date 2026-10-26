// Opt-in complete replay smoke. Import/bare invocation performs no authentication
// or API mutation. Node24/POSIX; old/partial IDs and original records stay intact.
// Entry: node scripts/cloud-smoke.mjs --execute-replay-smoke
// Explicit env: RG_ALLOW_CLOUD_SMOKE=true, RELEASEGUARD_URL, allowlist,
// RG_CLOUD_SMOKE_RUN_ID, RG_COMMIT/RG_IMAGE, RG_CLOUD_SMOKE_AUTH_MODE.
// token mode uses supplied RELEASEGUARD_TOKEN; client-credentials uses only the
// selected RG_CLOUD_SMOKE_AUTH_FILE (owned0600 JSON, owned0700 parent). No .env.
import { constants,realpathSync } from 'node:fs';
import { lstat,mkdir,open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname,join,parse,relative,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { validateCloudSmoke,runCloudReplaySmoke } from './cloud-smoke-core.mjs';
import { smokeRequest } from './cloud-smoke-http.mjs';
import { cloudToken } from './cloud-token.mjs';
const script=fileURLToPath(import.meta.url),root=resolve(dirname(script),'..'),hash=x=>createHash('sha256').update(x).digest('hex');
const deny=()=>{throw Error('Cloud smoke refused');};
async function noLinks(path){let p=parse(path).root;for(const part of relative(p,path).split(/[\\/]/).filter(Boolean)){p=join(p,part);if((await lstat(p)).isSymbolicLink())deny();}}
async function syncDir(path){const f=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));try{if(!(await f.stat()).isDirectory())deny();await f.sync();}finally{await f.close();}}
async function directory(path,privateMode=true){let made=false;try{await mkdir(path,{mode:0o700});made=true;}catch(e){if(e.code!=='EEXIST')throw e;}
 const s=await lstat(path);if(!s.isDirectory()||s.isSymbolicLink()||privateMode&&((s.mode&0o077)!==0||s.uid!==process.getuid()))deny();if(made)await syncDir(dirname(path));}
async function read(path,privateMode=false){
 await noLinks(path);if(privateMode){const s=await lstat(dirname(path));if((s.mode&0o077)!==0||s.uid!==process.getuid())deny();}
 const f=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));try{const s=await f.stat();if(!s.isFile()||s.size>262144||privateMode&&((s.mode&0o077)!==0||s.uid!==process.getuid()))deny();
 const b=await f.readFile(),end=await f.stat();if(b.length>262144||s.size!==end.size||s.mtimeMs!==end.mtimeMs||s.ctimeMs!==end.ctimeMs)deny();return b;
 }finally{await f.close();}}
async function exclusive(path,value){await noLinks(dirname(path));const f=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW??0),0o600);try{await f.writeFile(value);await f.sync();}finally{await f.close();}await syncDir(dirname(path));}
export async function runCloudSmokeCLI(args){
 let mask,controller,timer,deadline,phase='arguments';const stop=()=>controller?.abort();
 try{
  if(args.length!==1||args[0]!=='--execute-replay-smoke'||process.platform==='win32'||Number(process.versions.node.split('.')[0])<24)deny();
  if((await lstat(process.argv[1]??script)).isSymbolicLink())deny();
  phase='guard';
  const c=validateCloudSmoke({allowReplaySmoke:process.env.RG_ALLOW_CLOUD_SMOKE==='true',origin:process.env.RELEASEGUARD_URL,
   allowedOrigins:(process.env.RG_CLOUD_ALLOWED_ORIGINS??'').split(','),runId:process.env.RG_CLOUD_SMOKE_RUN_ID,commit:process.env.RG_COMMIT,image:process.env.RG_IMAGE,authMode:process.env.RG_CLOUD_SMOKE_AUTH_MODE});
  if(process.env.CI||process.env.GITHUB_ACTIONS){
   if(process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_EVENT_NAME!=='workflow_dispatch'||process.env.GITHUB_WORKFLOW!=='Approved cloud deployment'||
    c.runId!=='cd-'+process.env.GITHUB_RUN_ID+'-'+process.env.GITHUB_RUN_ATTEMPT||c.commit!==process.env.GITHUB_SHA||c.authMode!=='token')deny();
  }
  const sourceNames=['scripts/cloud-smoke.mjs','scripts/cloud-smoke-core.mjs','scripts/cloud-smoke-http.mjs','scripts/cloud-token.mjs','scripts/cloud-token-core.mjs','public/demo-fixtures.json'],sources={};
  for(const name of sourceNames)sources[name]=hash(await read(join(root,name)));
  mask=process.umask(0o077);controller=new AbortController();deadline=performance.now()+180000;timer=setTimeout(stop,180000);process.on('SIGINT',stop);process.on('SIGTERM',stop);
  let output;const json=(name,value)=>exclusive(join(output,name),JSON.stringify(value,null,2)+'\n'),summary=join(root,'evidence/cloud-smoke-'+c.runId+'.json');
  const io={
   signal:controller.signal,now:()=>performance.now(),get reservationOwned(){return Boolean(output);},
   async reserve(){
    phase='reservation';await noLinks(root);let parent=root;for(const[name,priv]of [['evidence',false],['private',true],['cloud-smoke',true]]){parent=join(parent,name);await directory(parent,priv);}
    try{await lstat(summary);deny();}catch(e){if(e.code!=='ENOENT')throw e;}
    const proposed=join(parent,c.runId);await mkdir(proposed,{mode:0o700});output=proposed;await syncDir(parent);
    await json('started.json',{formatVersion:1,runId:c.runId,state:'started',origin:c.origin,commit:c.commit,image:c.image,authMode:c.authMode,sourceSHA256:sources,identityDeclaredNotLiveAttestation:true});
    await directory(join(output,'operations'));
   },
   intent:(n,v)=>json('operations/'+String(n).padStart(3,'0')+'-intent.json',v),
   observed(n,v){const {body,...original}=v;return json('operations/'+String(n).padStart(3,'0')+'-observed.json',original);},
   result:(n,v)=>json('operations/'+String(n).padStart(3,'0')+'-result.json',v),
   async fixture(){return JSON.parse((await read(join(root,'public/demo-fixtures.json'))).toString('utf8'));},
   async authorize(){
    if(controller.signal.aborted)deny();
    if(c.authMode==='token'){if(process.env.RG_CLOUD_SMOKE_AUTH_FILE)deny();return process.env.RELEASEGUARD_TOKEN;}
    if(Object.hasOwn(process.env,'RELEASEGUARD_TOKEN')||!process.env.RG_CLOUD_SMOKE_AUTH_FILE)deny();
    const file=resolve(process.env.RG_CLOUD_SMOKE_AUTH_FILE);if(/^\.env(?:\.|$)|\.(?:key|pem|crt)$/.test(file.split(/[\\/]/).at(-1)))deny();
    const auth=JSON.parse((await read(file,true)).toString('utf8'));
    if(auth.targetOrigin!==c.origin||!Array.isArray(auth.allowedOrigins)||auth.allowedOrigins.some(v=>!c.allowedOrigins.includes(v)))deny();
    return cloudToken(auth,{fetch:globalThis.fetch,signal:controller.signal});
   },
   request:(origin,op,token,remaining,signal)=>smokeRequest(origin,op,token,remaining,signal,globalThis.fetch),
   async sleep(ms,signal){if(signal.aborted)deny();await new Promise((resolve,reject)=>{const cancel=()=>{clearTimeout(t);reject(Error('stopped'));},t=setTimeout(()=>{signal.removeEventListener('abort',cancel);resolve();},ms);signal.addEventListener('abort',cancel,{once:true});});},
   retainJob:job=>json('job.json',job),
   async terminal(value){
    if(value.passed)for(const name of sourceNames)if(hash(await read(join(root,name)))!==sources[name])deny();
    if(value.passed&&(controller.signal.aborted||performance.now()>=deadline))deny();
    await json('terminal.json',{...value,sourceSHA256:sources,fileAloneIsNotProofOfSuccessfulExitOrDurability:true});
    // Whitelisted metadata only; raw observations/job remain private and must not
    // be included in manual-CD artifact upload.
    if(value.passed&&(controller.signal.aborted||performance.now()>=deadline))deny();
    await exclusive(summary,JSON.stringify({formatVersion:1,runId:c.runId,state:value.state,passed:value.passed,origin:c.origin,commit:c.commit,image:c.image,
     requestedSource:'replay',modelCallsRequested:0,identityDeclaredNotLiveAttestation:true,requests:value.requests,privateEvidencePublished:false,fileAloneIsNotProofOfSuccessfulExitOrDurability:true},null,2)+'\n');
   },
  };
  phase='protocol';const r=await runCloudReplaySmoke(c,io);if(!r.passed||r.evidenceState)deny();
  console.log('Cloud replay smoke completed for this explicit run. Metadata only; no human approval, model-quality, scaling or deployment proof.');return 0;
 }catch{console.error('Cloud replay smoke refused or unconfirmed ('+phase+'). Retain original evidence; do not repeat this run ID. No private detail is printed.');return 1;}
 finally{clearTimeout(timer);process.off('SIGINT',stop);process.off('SIGTERM',stop);if(mask!==undefined)process.umask(mask);}
}
function main(){try{return Boolean(process.argv[1])&&realpathSync(process.argv[1])===realpathSync(script);}catch{return false;}}
if(main())process.exitCode=await runCloudSmokeCLI(process.argv.slice(2));
