// Inactive POSIX/Node24 full cloud acceptance. Import/bare invocation does nothing.
// Exact command flags: --execute-cloud-acceptance --allow-denied-review-probe
// The second flag acknowledges a valid negative review POST could mutate a broken
// target. No CI/manual-CD activation. Never run this against classroom5193.
// Explicit RG_ALLOW_CLOUD_ACCEPTANCE=true, RELEASEGUARD_URL/allowlist,
// RG_CLOUD_ACCEPTANCE_RUN_ID, RG_COMMIT/RG_IMAGE, workspace and auth mode.
// RG_CLOUD_ACCEPTANCE_AUTH_FILE: owned0600 JSON pair {contributor,viewer}, parent0700.
// tokens mode: two service JWTs; client-credentials: two explicit cloudToken configs.
// No ambient token/password fallback, credential CLI/URL/log, retry or human approval.
import { constants,realpathSync } from 'node:fs';
import { lstat,mkdir,open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname,join,parse,relative,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { validateCloudAcceptance,runCloudAcceptance } from './cloud-acceptance-core.mjs';
import { acceptanceRequest } from './cloud-acceptance-http.mjs';
import { cloudToken } from './cloud-token.mjs';
const script=fileURLToPath(import.meta.url),root=resolve(dirname(script),'..'),hash=x=>createHash('sha256').update(x).digest('hex');
const deny=()=>{throw Error('Cloud acceptance refused');};
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
export async function runCloudAcceptanceCLI(args){
 let mask,controller,timer,deadline,phase='arguments';const stop=()=>controller?.abort();
 try{
  if(args.length!==2||args[0]!=='--execute-cloud-acceptance'||args[1]!=='--allow-denied-review-probe'||process.platform==='win32'||Number(process.versions.node.split('.')[0])<24)deny();
  if((await lstat(process.argv[1]??script)).isSymbolicLink())deny();
  phase='guard';
  const c=validateCloudAcceptance({allowAcceptance:process.env.RG_ALLOW_CLOUD_ACCEPTANCE==='true',allowNegativeReviewProbe:true,origin:process.env.RELEASEGUARD_URL,
   allowedOrigins:(process.env.RG_CLOUD_ALLOWED_ORIGINS??'').split(','),runId:process.env.RG_CLOUD_ACCEPTANCE_RUN_ID,commit:process.env.RG_COMMIT,image:process.env.RG_IMAGE,workspace:process.env.RG_CLOUD_ACCEPTANCE_WORKSPACE,authMode:process.env.RG_CLOUD_ACCEPTANCE_AUTH_MODE});
  if(process.env.CI||process.env.GITHUB_ACTIONS)deny();
  const sourceNames=['scripts/cloud-acceptance.mjs','scripts/cloud-acceptance-core.mjs','scripts/cloud-acceptance-http.mjs','scripts/cloud-http.mjs','scripts/cloud-smoke-core.mjs','scripts/cloud-token.mjs','scripts/cloud-token-core.mjs','public/demo-fixtures.json'],sources={};
  for(const name of sourceNames)sources[name]=hash(await read(join(root,name)));
  mask=process.umask(0o077);controller=new AbortController();deadline=performance.now()+180000;timer=setTimeout(stop,180000);process.on('SIGINT',stop);process.on('SIGTERM',stop);
  let output;const json=(name,value)=>exclusive(join(output,name),JSON.stringify(value,null,2)+'\n'),summary=join(root,'evidence/cloud-acceptance-'+c.runId+'.json');
  const io={
   signal:controller.signal,now:()=>performance.now(),get reservationOwned(){return Boolean(output);},
   async reserve(){
    phase='reservation';await noLinks(root);let parent=root;for(const[name,priv]of [['evidence',false],['private',true],['cloud-acceptance',true]]){parent=join(parent,name);await directory(parent,priv);}
    try{await lstat(summary);deny();}catch(e){if(e.code!=='ENOENT')throw e;}
    const proposed=join(parent,c.runId);await mkdir(proposed,{mode:0o700});output=proposed;await syncDir(parent);
    await json('started.json',{formatVersion:1,runId:c.runId,state:'started',origin:c.origin,commit:c.commit,image:c.image,authMode:c.authMode,sourceSHA256:sources,identityDeclaredNotLiveAttestation:true});
    await directory(join(output,'operations'));
   },
   intent:(n,v)=>json('operations/'+String(n).padStart(3,'0')+'-intent.json',v),
   observed(n,v){const {body,...original}=v;return json('operations/'+String(n).padStart(3,'0')+'-observed.json',original);},
   result:(n,v)=>json('operations/'+String(n).padStart(3,'0')+'-result.json',v),
   async fixture(){return JSON.parse((await read(join(root,'public/demo-fixtures.json'))).toString('utf8'));},
   async authInputs(){
    if(controller.signal.aborted||!process.env.RG_CLOUD_ACCEPTANCE_AUTH_FILE||['RELEASEGUARD_TOKEN','OIDC_CLIENT_SECRET','OIDC_VIEWER_SECRET'].some(k=>Object.hasOwn(process.env,k)))deny();
    const file=resolve(process.env.RG_CLOUD_ACCEPTANCE_AUTH_FILE),selectedName=file.split('/').at(-1);
    if(selectedName==='.env'||selectedName.startsWith('.env.')||['.key','.pem','.crt'].some(suffix=>selectedName.endsWith(suffix)))deny();
    const pair=JSON.parse((await read(file,true)).toString('utf8'));
    if(!pair||Object.getPrototypeOf(pair)!==Object.prototype||Object.keys(pair).length!==2||!Object.hasOwn(pair,'contributor')||!Object.hasOwn(pair,'viewer'))deny();
    for(const value of Object.values(pair)){
     if(c.authMode==='tokens'){if(typeof value!=='string')deny();}
     else if(!value||value.targetOrigin!==c.origin||!Array.isArray(value.allowedOrigins)||!value.allowedOrigins.includes(c.origin)||value.allowedOrigins.some(v=>!c.allowedOrigins.includes(v)))deny();
    }
    return pair;
   },
   async authenticate(role,value,config,ordinal){
    if(controller.signal.aborted)deny();if(c.authMode==='tokens')return value;
    let token;try{token=await cloudToken(value,{fetch:globalThis.fetch,signal:controller.signal});}
    catch(e){await json('operations/'+String(ordinal).padStart(3,'0')+'-authentication.json',{role,tokenAndResponseBodyWithheld:true,
     code:typeof e?.code==='string'&&/^[a-z_]{1,80}$/.test(e.code)?e.code:'unconfirmed',status:Number.isInteger(e?.status)?e.status:null,outcome:e?.outcome==='not_sent'?'not_sent':'failed_or_unknown'});throw Error('unconfirmed');}
    await json('operations/'+String(ordinal).padStart(3,'0')+'-authentication.json',{role,status:200,tokenAndResponseBodyWithheld:true,outcome:'token_returned_not_identity_attestation'});return token;
   },
   request:(origin,op,credentials,remaining,signal,allow)=>acceptanceRequest(origin,op,credentials,remaining,signal,globalThis.fetch,allow),
   async sleep(ms,signal){if(signal.aborted)deny();await new Promise((resolve,reject)=>{const cancel=()=>{clearTimeout(t);reject(Error('stopped'));},t=setTimeout(()=>{signal.removeEventListener('abort',cancel);resolve();},ms);signal.addEventListener('abort',cancel,{once:true});});},
   retain(name,value){if(!['job.json','before.json','after.json'].includes(name))deny();return json(name,value);},
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
  phase='protocol';const r=await runCloudAcceptance(c,io);if(!r.passed||r.evidenceState)deny();
  console.log('Cloud acceptance completed for this explicit run. Metadata only; service-denial assertions are not human approval, model-quality, scaling or deployment proof.');return 0;
 }catch{console.error('Cloud acceptance refused or unconfirmed ('+phase+'). Retain original evidence; do not repeat this run ID. No private detail is printed.');return 1;}
 finally{clearTimeout(timer);process.off('SIGINT',stop);process.off('SIGTERM',stop);if(mask!==undefined)process.umask(mask);}
}
function main(){try{return Boolean(process.argv[1])&&realpathSync(process.argv[1])===realpathSync(script);}catch{return false;}}
if(main())process.exitCode=await runCloudAcceptanceCLI(process.argv.slice(2));
