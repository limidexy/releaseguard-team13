// Inactive POSIX/Node24 complete500-job Worker pause replay operator tool.
// Requires a separately prepared opt-in fault fixture with trusted PodUID and
// bounded memory journal. Default manifests/current running targets are unchanged.
// Exact opt-in: --execute-worker-pause-replay --input /private/config.json
// Requires explicit private config/auth/kubeconfig/image-identity receipt;
// refuses automatic CI, ambient credentials and classroom5193. Never wired into
// application, CD or package scripts. Future live execution needs its own human
// authorization and fresh cost check; this code cannot attest free billing.
// SIGINT/TERM stops dispatch; a separate reserved cleanup budget attempts only
// owned restoration. SIGKILL/power loss cannot guarantee cleanup or zero nodes.
import {realpathSync,constants} from 'node:fs';
import {lstat,open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {comparisonBytes,comparisonFiles,noComparisonLinks,strictComparisonJSON,sha256} from './comparison-files.mjs';
import {acceptanceProcess} from './acceptance-process.mjs';
import {validateEvidenceKubeconfig,credentialLike} from './gcp-evidence-core.mjs';
import {validateWorkerPause,runWorkerPause} from './worker-pause-core.mjs';
import {workerPauseTarget} from './worker-pause-target.mjs';
import {workerPauseCommand,confirmWorkerPauseCloud} from './worker-pause-native.mjs';
import {benchmarkRequest} from './cloud-benchmark-http.mjs';
import {cloudToken} from './cloud-token.mjs';
import {declaredServiceActor} from './cloud-acceptance-core.mjs';
const script=fileURLToPath(import.meta.url),root=resolve(dirname(script),'..'),deny=()=>{throw Error('Worker pause replay refused');};
export const workerPauseSources=['scripts/cloud-autoscale-worker-pause.mjs','scripts/worker-pause-core.mjs','scripts/worker-pause-target.mjs','scripts/worker-pause-native.mjs','scripts/worker-pause-program.mjs','scripts/worker-pause-init.mjs','scripts/cloud-autoscale-core.mjs','scripts/cloud-autoscale-target.mjs','scripts/cloud-autoscale-native.mjs','scripts/cloud-benchmark-core.mjs','scripts/cloud-benchmark-target.mjs','scripts/cloud-benchmark-native.mjs','scripts/cloud-benchmark-metrics.mjs','scripts/cloud-benchmark-http.mjs',
 'scripts/cloud-http.mjs','scripts/cloud-token.mjs','scripts/cloud-token-core.mjs','scripts/cloud-smoke-core.mjs','scripts/cloud-acceptance-core.mjs','scripts/gcp-evidence-core.mjs','scripts/comparison-files.mjs','scripts/acceptance-process.mjs','scripts/retained-rescore-input.mjs','public/demo-fixtures.json'];
const identityStat=s=>[s.dev,s.ino,s.mode,s.uid,s.size,s.mtimeNs,s.ctimeNs].map(String).join(':');
async function executable(path,prior){
 await noComparisonLinks(path);const s=await lstat(path,{bigint:true});if(!s.isFile()||(s.mode&0o022n)!==0n||!(s.mode&0o111n)||s.size>256n*1024n*1024n)deny();
 const stat=identityStat(s);if(prior){if(stat!==prior.stat)deny();return prior;}
 const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{
  if(identityStat(await f.stat({bigint:true}))!==stat)deny();const h=createHash('sha256'),buffer=Buffer.alloc(65536);let size=0;
  for(;;){const {bytesRead}=await f.read(buffer,0,buffer.length,null);if(!bytesRead)break;size+=bytesRead;if(size>256*1024*1024)deny();h.update(buffer.subarray(0,bytesRead));}
  if(BigInt(size)!==s.size||identityStat(await f.stat({bigint:true}))!==stat)deny();return {stat,sha256:h.digest('hex')};
 }finally{await f.close();}
}
export async function runWorkerPauseCLI(args){
 let phase='arguments',mask,activeTimer,hardTimer,active,cleanup,files;const began=performance.now(),stop=()=>active?.abort();
 try{
  if(process.platform==='win32'||Number(process.versions.node.split('.')[0])<24||process.env.CI||process.env.GITHUB_ACTIONS||realpathSync(process.cwd())!==realpathSync(root)||
   (await lstat(process.argv[1]??script)).isSymbolicLink()||args.length!==3||args[0]!=='--execute-worker-pause-replay'||args[1]!=='--input'||!args[2])deny();
  phase='configuration';const input=resolve(args[2]);if(!input.endsWith('.json'))deny();
  const configBytes=await comparisonBytes(input,{privateMode:true}),c=validateWorkerPause(strictComparisonJSON(configBytes)),cloud=c.cloud;
  const selected=[input,c.authFile,cloud.kubeconfigFile,c.identity.path];if(new Set(selected).size!==selected.length||selected.some(p=>p.endsWith('/.env')||p.split('/').at(-1).startsWith('.env.')))deny();
  if(['RELEASEGUARD_TOKEN','OIDC_CLIENT_SECRET','OIDC_VIEWER_SECRET','GOOGLE_APPLICATION_CREDENTIALS','KUBECONFIG'].some(k=>Object.hasOwn(process.env,k)))deny();
  phase='selected-runtime';await noComparisonLinks(cloud.gcloudConfigDirectory);const dir=await lstat(cloud.gcloudConfigDirectory);if(!dir.isDirectory()||(dir.mode&0o077)!==0||dir.uid!==process.getuid())deny();
  const kubeBytes=await comparisonBytes(cloud.kubeconfigFile,{privateMode:true}),kube=validateEvidenceKubeconfig(strictComparisonJSON(kubeBytes),cloud),executables={};
  for(const path of [cloud.gcloudExecutable,cloud.kubectlExecutable,cloud.pluginExecutable])executables[path]=await executable(path);
  const sourceHashes={};for(const name of workerPauseSources)sourceHashes[name]=sha256(await comparisonBytes(join(root,name)));
  const identityBytes=await comparisonBytes(c.identity.path,{privateMode:true});if(sha256(identityBytes)!==c.identity.sha256)deny();const identity=strictComparisonJSON(identityBytes);
  if(!identity||Object.keys(identity).sort().join(',')!=='image,sourceCommit'||identity.sourceCommit!==c.commit||identity.image!==c.image)deny();
  const remaining=restoring=>Math.floor(c.deadlineMs-(performance.now()-began)-(restoring?0:300000));if(remaining(false)<=0)deny();
  active=new AbortController();cleanup=new AbortController();activeTimer=setTimeout(stop,remaining(false));hardTimer=setTimeout(()=>{active.abort();cleanup.abort();},remaining(true));process.on('SIGINT',stop);process.on('SIGTERM',stop);
  mask=process.umask(0o077);files=comparisonFiles(root,c.runId,'cloud-worker-pause');let nativeSequence=0,secrets=[],credentialsReady=false,preCredentialBytes=0;const preCredentialOutputs=[];
  function registerSecret(value,kind){
   if(kind==='token')declaredServiceActor(value,'contributor',c.workspace); // Configuration only, never JWT authentication.
   else if(typeof value!=='string'||!value.length||value.length>4096||/[\x00-\x1f\x7f]/.test(value))deny();
   // A public native value is ambiguous as a secret: reject BEFORE registering
   // it, without weakening echo withholding or poisoning owned cleanup reads.
   if(preCredentialOutputs.some(text=>text.includes(value)))deny();
   if(!secrets.includes(value))secrets.push(value);if(secrets.length>5)deny();
  }
  async function verifyRuntime(){
   if(sha256(await comparisonBytes(input,{privateMode:true}))!==sha256(configBytes)||sha256(await comparisonBytes(cloud.kubeconfigFile,{privateMode:true}))!==sha256(kubeBytes)||sha256(await comparisonBytes(c.identity.path,{privateMode:true}))!==c.identity.sha256)deny();
   for(const [name,hash]of Object.entries(sourceHashes))if(sha256(await comparisonBytes(join(root,name)))!==hash)deny();
   for(const [path,record]of Object.entries(executables))await executable(path,record);
  }
  async function command(kind,restoring=false,ops,selected){
   const signal=restoring?cleanup.signal:active.signal;if(signal.aborted||remaining(restoring)<=0)deny();await verifyRuntime();
   const serial=String(++nativeSequence).padStart(6,'0');let patchFile;
   const prefix=restoring?'cleanup-':'';
   if(ops){patchFile=join(files.directory,prefix+'kube-patch-'+serial+'.json');await files.json(prefix+'kube-patch-'+serial+'.json',ops);}
   const plan=workerPauseCommand(c,kind,patchFile,selected),name=prefix+'native-'+serial;
   await files.json(name+'-intent.json',{kind,...plan,cleanup:restoring,state:'intent'});if(signal.aborted||remaining(restoring)<=0)deny();
   const raw=await acceptanceProcess(plan.command,plan.args,{cwd:root,env:{PATH:[dirname(cloud.gcloudExecutable),dirname(cloud.pluginExecutable),'/usr/local/bin','/usr/bin','/bin'].join(':'),LANG:'C',LC_ALL:'C',
    CLOUDSDK_CONFIG:cloud.gcloudConfigDirectory,CLOUDSDK_CORE_PROJECT:cloud.project,CLOUDSDK_CORE_ACCOUNT:cloud.account,CLOUDSDK_CORE_DISABLE_PROMPTS:'1',CLOUDSDK_CORE_DISABLE_USAGE_REPORTING:'true',CLOUDSDK_COMPONENT_MANAGER_DISABLE_UPDATE_CHECK:'true',KUBECONFIG:cloud.kubeconfigFile},
    timeout:Math.max(1,Math.min(20000,remaining(restoring))),maxBuffer:2*1024*1024,signal});
   const out=typeof raw.stdout==='string'?raw.stdout:'',err=typeof raw.stderr==='string'?raw.stderr:'',withheld=credentialLike(out+'\n'+err)||secrets.some(v=>out.includes(v)||err.includes(v));
   await files.json(name+'-observed.json',{kind,status:raw.status,signal:raw.signal,errorCode:raw.error?'COMMAND_FAILED_OR_UNKNOWN':null,truncated:raw.outputTruncated===true,
    rawStdout:withheld?null:out,rawStderr:withheld?null:err,stdoutSHA256:sha256(out),stderrSHA256:sha256(err),credentialLikeContentWithheld:withheld,processEncoding:'UTF8 decoded; replacement characters rejected; not original byte attestation'});
   if(raw.status!==0||raw.signal||raw.error||raw.outputTruncated||withheld||out.includes('\ufffd')||err.includes('\ufffd')||signal.aborted||remaining(restoring)<=0)deny();
   if(!restoring&&!credentialsReady){preCredentialBytes+=Buffer.byteLength(out)+Buffer.byteLength(err);if(preCredentialBytes>8*1024*1024)deny();preCredentialOutputs.push(out,err);}
   const value=strictComparisonJSON(Buffer.from(out));await files.json(name+'-result.json',{kind,state:'parsed'});return value;
  }
  const io={signal:active.signal,now:()=>performance.now(),remaining,wallNow:()=>Date.now(),get owned(){return files.owned;},json:files.json,
   reserve:()=>files.reserve({formatVersion:1,state:'started',runId:c.runId,origin:c.origin,sourceCommit:c.commit,image:c.image,inputSHA256:sha256(configBytes),sourceSHA256:sourceHashes,
    imageIdentityReceiptSHA256:c.identity.sha256,imageToSourceIsOperatorSelectedNotIndependentAttestation:true,cleanupReserveMs:300000,hardKillRecoveryGuaranteed:false}),
   async fixture(){const bytes=await comparisonBytes(join(root,'public/demo-fixtures.json'));return {bytes,value:strictComparisonJSON(bytes)};},
   async target(){const observations={};for(const kind of ['cluster','namespace','nodes'])observations[kind]=await command(kind);
    const proof=confirmWorkerPauseCloud(c,kube,observations);await files.json('target-proof.json',proof);
    return workerPauseTarget({...c.target,runId:c.runId,namespace:cloud.namespace,imageDigest:c.image.split('@')[1],mainSHA256:c.fault.mainSHA256},
     {now:io.now,wallNow:io.wallNow,remaining,sleep:io.sleep,read:(kind,restoring)=>command(kind,restoring),patch:(kind,ops,restoring)=>command('patch-'+kind,restoring,ops),exec:(kind,pod,packet,restoring)=>command(kind,restoring,undefined,{pod,packet})});
   },
   async authInputs(){const bytes=await comparisonBytes(c.authFile,{privateMode:true}),auth=strictComparisonJSON(bytes);
    if(c.authMode==='token'){if(!auth||Object.keys(auth).join(',')!=='token'||typeof auth.token!=='string')deny();
     // Configuration check only; the API still verifies the actual signature,
     // issuer, expiry and authorization. Reject before registering echo secrets.
     registerSecret(auth.token,'token');}
    else{if(!auth||auth.targetOrigin!==c.origin||!Array.isArray(auth.allowedOrigins)||auth.allowedOrigins.some(o=>!c.allowedOrigins.includes(o))||typeof auth.clientSecret!=='string'||
     !auth.clientSecret.length||auth.clientSecret.length>4096||/[\x00-\x1f\x7f]/.test(auth.clientSecret))deny();registerSecret(auth.clientSecret,'secret');}
    return auth;
   },
   async authorize(auth,config,index){const prefix='authentication-'+index;await files.json(prefix+'-intent.json',{mode:c.authMode,state:'intent',tokenAndSecretWithheld:true});
    if(active.signal.aborted||remaining(false)<=0)deny();let value,returned=false;
    try{value=c.authMode==='token'?auth.token:await cloudToken({...auth,timeoutMs:Math.min(auth.timeoutMs,15000,remaining(false))},{fetch:globalThis.fetch,signal:active.signal});returned=true;registerSecret(value,'token');}
    catch(e){await files.json(prefix+'-observed.json',{outcome:returned?'token_returned_unconfirmed':e?.outcome==='not_sent'?'not_sent':'failed_or_unknown',status:returned&&c.authMode==='client-credentials'?200:Number.isInteger(e?.status)?e.status:null,tokenAndSecretWithheld:true});throw Error('unconfirmed');}
    credentialsReady=true;preCredentialOutputs.length=0;preCredentialBytes=0;
    await files.json(prefix+'-observed.json',{outcome:'token_returned_not_identity_attestation',tokenAndSecretWithheld:true});return value;
   },
   request:(origin,op,token,timeout,signal)=>benchmarkRequest(origin,op,token,timeout,signal,globalThis.fetch,secrets.filter(s=>s!==token).slice(-4)),
   async sleep(ms,restoring){const signal=restoring?cleanup.signal:active.signal;if(signal.aborted||remaining(restoring)<=ms)deny();await new Promise((resolve,reject)=>{
    const cancel=()=>{clearTimeout(t);reject(Error('stopped'));},t=setTimeout(()=>{signal.removeEventListener('abort',cancel);resolve();},ms);signal.addEventListener('abort',cancel,{once:true});});},
   verifyRuntime,
   terminal:report=>files.json('terminal.json',{...report,sourceSHA256:sourceHashes,nativeCommandIntents:nativeSequence,fileAloneIsNotProofOfSuccessfulExitOrPhysicalDurability:true}),
  };
  phase='protocol';const result=await runWorkerPause(c,io);if(!result.passed||result.evidenceState)deny();
  console.log('Worker pause replay completed only for this owned run. Private receipts retained; not sustained scaling benefit, maximum capacity, model quality, free-cost or deployment proof.');return 0;
 }catch{console.error('Worker pause replay refused or unconfirmed ('+phase+'). Retain original private receipts. No automatic retry/resume; cleanup or target state may require operator review.');return 1;}
 finally{clearTimeout(activeTimer);clearTimeout(hardTimer);process.off('SIGINT',stop);process.off('SIGTERM',stop);if(mask!==undefined)process.umask(mask);}
}
function main(){try{return Boolean(process.argv[1])&&realpathSync(process.argv[1])===realpathSync(script);}catch{return false;}}
if(main())process.exitCode=await runWorkerPauseCLI(process.argv.slice(2));
