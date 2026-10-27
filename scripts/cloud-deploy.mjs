// Inactive complete six-role deployment operator. Bare invocation/import refuses.
// Only: node scripts/cloud-deploy.mjs --execute-owned-deployment --input /private/config.json
// Future target use requires separate authorization and billing confirmation.
// No env activation, default CD caller, resume, retry, force conflict or model call.
import {realpathSync,constants} from 'node:fs';
import {lstat,open,mkdir} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {comparisonFiles,comparisonBytes,noComparisonLinks,strictComparisonJSON,sha256,syncComparisonDirectory} from './comparison-files.mjs';
import {validateEvidenceKubeconfig,credentialLike} from './gcp-evidence-core.mjs';
import {confirmBackupCloud} from './backup-native.mjs';
import {validateDeploy,runDeploy} from './deploy-core.mjs';
import {deployCommand} from './deploy-native.mjs';
import {backupProcess} from './backup-process.mjs';
import {runCloudReplaySmoke} from './cloud-smoke-core.mjs';
import {smokeRequest} from './cloud-smoke-http.mjs';
import {cloudToken} from './cloud-token.mjs';
const script=fileURLToPath(import.meta.url),root=resolve(dirname(script),'..'),deny=()=>{throw Error('Deployment refused');};
export const deploySources=['scripts/cloud-deploy.mjs','scripts/deploy-core.mjs','scripts/deploy-native.mjs','scripts/deploy-object-core.mjs','scripts/comparison-files.mjs','scripts/gcp-evidence-core.mjs','scripts/backup-native.mjs','scripts/backup-sql.mjs','scripts/backup-process.mjs','scripts/cloud-smoke-core.mjs','scripts/cloud-smoke-http.mjs','scripts/cloud-http.mjs','scripts/cloud-token.mjs','scripts/cloud-token-core.mjs','scripts/render-cloud.mjs','scripts/worker-pause-init.mjs','scripts/worker-pause-program.mjs','public/demo-fixtures.json'];
const stamp=s=>[s.dev,s.ino,s.mode,s.uid,s.size,s.mtimeNs,s.ctimeNs].map(String).join(':');
async function executable(path,previous){
 await noComparisonLinks(path);const s=await lstat(path,{bigint:true});if(!s.isFile()||(s.mode&0o022n)!==0n||!(s.mode&0o111n)||s.size>256n*1024n*1024n)deny();
 if(previous){if(stamp(s)!==previous.stat)deny();return previous;}
 const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{if(stamp(await f.stat({bigint:true}))!==stamp(s))deny();const h=createHash('sha256'),b=Buffer.alloc(65536);let size=0;for(;;){const r=await f.read(b,0,b.length,null);if(!r.bytesRead)break;size+=r.bytesRead;if(size>256*1024*1024)deny();h.update(b.subarray(0,r.bytesRead));}if(BigInt(size)!==s.size||stamp(await f.stat({bigint:true}))!==stamp(s))deny();return {stat:stamp(s),sha256:h.digest('hex')};}finally{await f.close();}
}
export async function runDeployCLI(args){
 let phase='arguments',mask,activeTimer,hardTimer,active,cleanup;const began=performance.now(),stop=()=>active?.abort();
 try{
  if(process.platform==='win32'||Number(process.versions.node.split('.')[0])<24||process.env.CI||process.env.GITHUB_ACTIONS||realpathSync(process.cwd())!==realpathSync(root)||(await lstat(process.argv[1]??script)).isSymbolicLink()||args.length!==3||args[0]!=='--execute-owned-deployment'||args[1]!=='--input'||!args[2])deny();
  phase='configuration';const input=resolve(args[2]);if(!input.endsWith('.json')||input.split('/').at(-1).startsWith('.env'))deny();
  const bytes=await comparisonBytes(input,{privateMode:true}),c=validateDeploy(strictComparisonJSON(bytes)),x=c.cloud;
  if(['RELEASEGUARD_TOKEN','OIDC_CLIENT_SECRET','OIDC_VIEWER_SECRET','GOOGLE_APPLICATION_CREDENTIALS','KUBECONFIG','NODE_EXTRA_CA_CERTS','NODE_TLS_REJECT_UNAUTHORIZED'].some(k=>Object.hasOwn(process.env,k)))deny();
  phase='runtime';await noComparisonLinks(x.gcloudConfigDirectory);const dir=await lstat(x.gcloudConfigDirectory);if(!dir.isDirectory()||(dir.mode&0o077)!==0||dir.uid!==process.getuid())deny();
  const kubeBytes=await comparisonBytes(x.kubeconfigFile,{privateMode:true}),kube=validateEvidenceKubeconfig(strictComparisonJSON(kubeBytes),x),authBytes=await comparisonBytes(c.authFile,{privateMode:true}),auth=strictComparisonJSON(authBytes);
  if(auth.allowServiceAuthentication!==true||auth.targetOrigin!==c.render.origin||auth.issuer!==c.render.issuer||new URL(auth.issuer).origin!==c.render.origin||!Array.isArray(auth.allowedOrigins)||!auth.allowedOrigins.length||auth.allowedOrigins.some(v=>!c.allowedOrigins.includes(v)))deny();
  if(Object.keys(auth).length!==7||!['allowServiceAuthentication','targetOrigin','allowedOrigins','issuer','clientId','clientSecret','timeoutMs'].every(k=>Object.hasOwn(auth,k))||typeof auth.clientId!=='string'||!/^[A-Za-z0-9._-]{1,150}$/.test(auth.clientId)||typeof auth.clientSecret!=='string'||!auth.clientSecret.length||auth.clientSecret.length>4096||/[\x00-\x1f\x7f]/.test(auth.clientSecret)||!Number.isInteger(auth.timeoutMs)||auth.timeoutMs<1||auth.timeoutMs>15000||auth.allowedOrigins.length>20||auth.allowedOrigins.some(v=>typeof v!=='string'||new URL(v).origin!==v||new URL(v).protocol!=='https:')||/[\x00-\x20\x7f%\\?#]/.test(auth.issuer))deny();
  const issuerURL=new URL(auth.issuer);if(auth.issuer!==(issuerURL.pathname==='/'?issuerURL.origin:issuerURL.href)||issuerURL.pathname!=='/'&&(!/^\/(?:[A-Za-z0-9._~-]+\/)*[A-Za-z0-9._~-]+$/.test(issuerURL.pathname)||issuerURL.pathname.split('/').some(s=>s==='.'||s==='..')))deny();
  const executables={},sources={};for(const path of [process.execPath,x.gcloudExecutable,x.kubectlExecutable,x.pluginExecutable])executables[path]=await executable(path);for(const name of deploySources)sources[name]=sha256(await comparisonBytes(join(root,name)));
  const remaining=clean=>Math.floor(c.deadlineMs-(performance.now()-began)-(clean?0:360000));if(remaining(false)<=0)deny();
  active=new AbortController();cleanup=new AbortController();activeTimer=setTimeout(stop,remaining(false));hardTimer=setTimeout(()=>{active.abort();cleanup.abort();},remaining(true));process.on('SIGINT',stop);process.on('SIGTERM',stop);mask=process.umask(0o077);
  const files=comparisonFiles(root,c.runId,'cloud-deploy');let nativeSequence=0,requestSequence=0,smokeSequence=0;
  async function verifyRuntime(){if(sha256(await comparisonBytes(input,{privateMode:true}))!==sha256(bytes)||sha256(await comparisonBytes(x.kubeconfigFile,{privateMode:true}))!==sha256(kubeBytes)||sha256(await comparisonBytes(c.authFile,{privateMode:true}))!==sha256(authBytes))deny();for(const[name,h]of Object.entries(sources))if(sha256(await comparisonBytes(join(root,name)))!==h)deny();for(const[path,proof]of Object.entries(executables))await executable(path,proof);}
  const env={PATH:[dirname(x.gcloudExecutable),dirname(x.pluginExecutable),'/usr/local/bin','/usr/bin','/bin'].join(':'),LANG:'C',LC_ALL:'C',HOME:files.directory??'/nonexistent',CLOUDSDK_CONFIG:x.gcloudConfigDirectory,CLOUDSDK_CORE_PROJECT:x.project,CLOUDSDK_CORE_ACCOUNT:x.account,CLOUDSDK_CORE_DISABLE_PROMPTS:'1',CLOUDSDK_CORE_DISABLE_USAGE_REPORTING:'true',CLOUDSDK_COMPONENT_MANAGER_DISABLE_UPDATE_CHECK:'true',KUBECONFIG:x.kubeconfigFile};
  async function native(plan,kind,clean=false){
   const signal=clean?cleanup.signal:active.signal;if(signal.aborted||remaining(clean)<=0)deny();await verifyRuntime();const n=(clean?'cleanup-':'')+'native-'+String(++nativeSequence).padStart(6,'0');
   await files.json(n+'-intent.json',{kind,command:plan.command,args:plan.args,inputBytes:plan.input?.length??0,inputSHA256:plan.input?sha256(plan.input):null,noRetry:true});if(signal.aborted||remaining(clean)<=0)deny();
   const r=await backupProcess(plan.command,plan.args,{cwd:root,env:{...env,HOME:files.directory},input:plan.input,timeout:Math.max(1,Math.min(60000,remaining(clean))),maxBuffer:4*1024*1024,signal});
   // Raw private streams are retained before interpreting status or JSON.
   await files.put(n+'-stdout.bin',r.stdout);await files.put(n+'-stderr.bin',r.stderr);await files.json(n+'-observed.json',{status:r.status,signal:r.signal,errorCode:r.error?.code??null,spawnEntered:r.spawnEntered,outputTruncated:r.outputTruncated,stdoutSHA256:sha256(r.stdout),stderrSHA256:sha256(r.stderr)});
   if(r.status!==0||r.signal||r.error||r.outputTruncated||signal.aborted||remaining(clean)<=0)deny();return r.stdout;
  }
  async function command(kind,detail={},clean=false){
   if(!['cluster','namespace'].includes(kind))await confirmTarget(clean);
   if(['patch','previewPatch'].includes(kind)){const name=(clean?'cleanup-':'')+'request-'+String(++requestSequence).padStart(6,'0')+'.json';await files.json(name,detail.plan.patch);detail={...detail,file:join(files.directory,name)};}
   const value=await native(deployCommand(c,kind,detail),kind,clean);if(kind==='get'&&!value.length)return null;return strictComparisonJSON(value);
  }
  async function confirmTarget(clean=false){const cluster=await command('cluster',{},clean),namespace=await command('namespace',{},clean);return confirmBackupCloud(c,kube,{cluster,namespace});}
  const io={signal:active.signal,cleanupSignal:cleanup.signal,now:()=>performance.now(),get owned(){return files.owned;},json:files.json,verifyRuntime,
   reserve:()=>files.reserve({formatVersion:1,state:'started',runId:c.runId,sourceCommit:c.sourceCommit,image:c.image,inputSHA256:sha256(bytes),sourceSHA256:sources,executableSHA256:Object.fromEntries(Object.entries(executables).map(([k,v])=>[k,v.sha256])),cleanupReserveMs:360000,sourceAndCIIdentityNotLiveAttested:true,noRetry:true}),
   preflight:()=>confirmTarget(),
   async render(){
    const stage=join(files.directory,'render-stage');await mkdir(stage,{mode:0o700});await syncComparisonDirectory(files.directory);await mkdir(join(stage,'scripts'),{mode:0o700});await syncComparisonDirectory(stage);
    for(const name of ['render-cloud.mjs','worker-pause-init.mjs','worker-pause-program.mjs']){const data=await comparisonBytes(join(root,'scripts',name)),f=await open(join(stage,'scripts',name),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{await f.writeFile(data);await f.sync();}finally{await f.close();}}
    await syncComparisonDirectory(join(stage,'scripts'));const r=c.render,renderEnv={PATH:'/usr/bin:/bin',RG_IMAGE:c.image,PUBLIC_ORIGIN:r.origin,AUTH_ISSUER:r.issuer,OIDC_JWKS_URL:r.jwks,SUBMISSION_CLOCK_SKEW_BOUND_MS:String(r.clockSkewBoundMs),RG_INTERNAL_CA:String(r.internalCA),RG_TRIAL_SMALL:String(r.trialSmall),RG_SKIP_NAMESPACE:'true',RG_ENABLE_WORKER_FAULT_FIXTURE:'false',RG_DEPLOYMENT_ENV:r.environment};
    await verifyRuntime();const n='render-native',plan={command:process.execPath,args:[join(stage,'scripts/render-cloud.mjs')]};await files.json(n+'-intent.json',{...plan,envNames:Object.keys(renderEnv),noExternalIORequested:true});
    const result=await backupProcess(plan.command,plan.args,{cwd:stage,env:renderEnv,timeout:Math.min(30000,remaining(false)),maxBuffer:65536,signal:active.signal});await files.put(n+'-stdout.bin',result.stdout);await files.put(n+'-stderr.bin',result.stderr);await files.json(n+'-observed.json',{status:result.status,signal:result.signal,errorCode:result.error?.code??null});if(result.status!==0||result.signal||result.error||result.outputTruncated||active.signal.aborted)deny();
    const raw=await comparisonBytes(join(stage,'deploy/k8s/rendered/services.yaml'),{privateMode:true});await files.put('rendered-manifests.bin',raw);return raw.toString('utf8').trim().split('\n---\n').map(v=>strictComparisonJSON(Buffer.from(v)));
   },
   get:(ref,clean)=>command('get',{ref},clean),previewPatch:(plan,clean)=>command('previewPatch',{plan},clean),patch:(plan,clean)=>command('patch',{plan},clean),previewApply:document=>command('previewApply',{document}),previewCreate:document=>command('previewCreate',{document}),create:document=>command('create',{document}),deleteCreated:(snapshot,clean)=>command('deleteCreated',{snapshot},clean),
   async sleep(ms,clean){const signal=clean?cleanup.signal:active.signal;if(signal.aborted)deny();await new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(t);reject(Error('stopped'));},t=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});},
   async smoke(label,selected,clean){
    await confirmTarget(clean);await verifyRuntime();const prefix='smoke-'+label+'-',signal=clean?cleanup.signal:active.signal,runId=randomUUID();let smokeOwned=false;
    const config={allowReplaySmoke:true,origin:c.render.origin,allowedOrigins:c.allowedOrigins,runId,commit:selected.source,image:selected.image,authMode:'client-credentials'};
    const smokeIO={signal,now:()=>performance.now(),get reservationOwned(){return smokeOwned;},async reserve(){await files.json(prefix+'started.json',{runId,commit:selected.source,image:selected.image,requestedSource:'replay',identityDeclaredNotLiveAttestation:true});smokeOwned=true;},
     intent:(n,v)=>files.json(prefix+String(n).padStart(4,'0')+'-intent.json',v),observed(n,v){const {body,...original}=v;return files.json(prefix+String(n).padStart(4,'0')+'-observed.json',original);},result:(n,v)=>files.json(prefix+String(n).padStart(4,'0')+'-result.json',v),
     fixture:async()=>strictComparisonJSON(await comparisonBytes(join(root,'public/demo-fixtures.json'))),authorize:async()=>{await verifyRuntime();if(signal.aborted||remaining(clean)<=0)deny();return cloudToken(auth,{fetch:globalThis.fetch,signal});},
     request:(origin,op,token,left)=>smokeRequest(origin,op,token,Math.max(1,Math.min(left,remaining(clean))),signal,globalThis.fetch),sleep:ms=>io.sleep(ms,clean),retainJob:job=>files.json(prefix+'job.json',job),terminal:r=>files.json(prefix+'terminal.json',r)};
    smokeSequence++;return runCloudReplaySmoke(config,smokeIO);
   },
  };
  phase='protocol';const result=await runDeploy(c,io);if(!result.passed||result.evidenceState)deny();console.log('Explicit owned six-role lifecycle completed. Private evidence retained; not independent approval, billing, live API compatibility certification or availability/scaling proof.');return 0;
 }catch{console.error('Deployment refused or unconfirmed ('+phase+'). Retain private intents and raw observations; no automatic retry or resume. Target reconciliation may still be required.');return 1;}
 finally{clearTimeout(activeTimer);clearTimeout(hardTimer);process.off('SIGINT',stop);process.off('SIGTERM',stop);if(mask!==undefined)process.umask(mask);}
}
function main(){try{return Boolean(process.argv[1])&&realpathSync(process.argv[1])===realpathSync(script);}catch{return false;}}
if(main())process.exitCode=await runDeployCLI(process.argv.slice(2));
