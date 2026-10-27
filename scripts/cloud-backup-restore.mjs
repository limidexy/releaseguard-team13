// Inactive POSIX/Node24 full three-database logical restore operator.
// Only --execute-backup-restore --input /private/config.json can invoke it.
// Future live use needs separate human authorization, free-cost confirmation,
// trusted source superusers, an isolated admin window and explicit existing target credentials. This code
// cannot attest billing. No deployment, resize, provider, issuer or retry.
import {realpathSync,constants} from 'node:fs';
import {lstat,open} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {comparisonFiles,comparisonBytes,noComparisonLinks,strictComparisonJSON,sha256} from './comparison-files.mjs';
import {validateEvidenceKubeconfig,credentialLike} from './gcp-evidence-core.mjs';
import {validateBackup,runBackup} from './backup-core.mjs';
import {backupCommand,confirmBackupCloud,confirmBackupPod} from './backup-native.mjs';
import {backupProcess} from './backup-process.mjs';
const script=fileURLToPath(import.meta.url),root=resolve(dirname(script),'..'),deny=()=>{throw Error('Backup refused');};
export const backupSources=['scripts/cloud-backup-restore.mjs','scripts/backup-core.mjs','scripts/backup-native.mjs','scripts/backup-sql.mjs','scripts/backup-process.mjs','scripts/comparison-files.mjs','scripts/gcp-evidence-core.mjs'];
const stamp=s=>[s.dev,s.ino,s.mode,s.uid,s.size,s.mtimeNs,s.ctimeNs].map(String).join(':');
async function executable(path,previous){
 await noComparisonLinks(path);const s=await lstat(path,{bigint:true});if(!s.isFile()||(s.mode&0o022n)!==0n||!(s.mode&0o111n)||s.size>256n*1024n*1024n)deny();
 if(previous){if(stamp(s)!==previous.stat)deny();return previous;}const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{if(stamp(await f.stat({bigint:true}))!==stamp(s))deny();const hash=createHash('sha256'),b=Buffer.alloc(65536);let size=0;for(;;){const r=await f.read(b,0,b.length,null);if(!r.bytesRead)break;size+=r.bytesRead;if(size>256*1024*1024)deny();hash.update(b.subarray(0,r.bytesRead));}if(BigInt(size)!==s.size||stamp(await f.stat({bigint:true}))!==stamp(s))deny();return {stat:stamp(s),sha256:hash.digest('hex')};}finally{await f.close();}
}
export async function runBackupCLI(args){
 let phase='arguments',mask,activeTimer,hardTimer,active,cleanup,files;const began=performance.now(),stop=()=>active?.abort();
 try{
  if(process.platform==='win32'||Number(process.versions.node.split('.')[0])<24||process.env.CI||process.env.GITHUB_ACTIONS||realpathSync(process.cwd())!==realpathSync(root)||
   (await lstat(process.argv[1]??script)).isSymbolicLink()||args.length!==3||args[0]!=='--execute-backup-restore'||args[1]!=='--input'||!args[2])deny();
  phase='configuration';const input=resolve(args[2]);if(!input.endsWith('.json')||input.split('/').at(-1).startsWith('.env'))deny();
  const bytes=await comparisonBytes(input,{privateMode:true}),c=validateBackup(strictComparisonJSON(bytes)),x=c.cloud;
  if(input===x.kubeconfigFile||['RELEASEGUARD_TOKEN','OIDC_CLIENT_SECRET','OIDC_VIEWER_SECRET','GOOGLE_APPLICATION_CREDENTIALS','KUBECONFIG'].some(k=>Object.hasOwn(process.env,k)))deny();
  phase='selected-runtime';await noComparisonLinks(x.gcloudConfigDirectory);const dir=await lstat(x.gcloudConfigDirectory);if(!dir.isDirectory()||(dir.mode&0o077)!==0||dir.uid!==process.getuid())deny();
  const kubeBytes=await comparisonBytes(x.kubeconfigFile,{privateMode:true}),kube=validateEvidenceKubeconfig(strictComparisonJSON(kubeBytes),x),executables={},sources={};
  for(const path of [x.gcloudExecutable,x.kubectlExecutable,x.pluginExecutable])executables[path]=await executable(path);
  for(const name of backupSources)sources[name]=sha256(await comparisonBytes(join(root,name)));
  const remaining=clean=>Math.floor(c.deadlineMs-(performance.now()-began)-(clean?0:360000));if(remaining(false)<=0)deny();
  active=new AbortController();cleanup=new AbortController();activeTimer=setTimeout(stop,remaining(false));hardTimer=setTimeout(()=>{active.abort();cleanup.abort();},remaining(true));process.on('SIGINT',stop);process.on('SIGTERM',stop);
  mask=process.umask(0o077);files=comparisonFiles(root,c.runId,'cloud-backup');let nativeSequence=0;
  async function verifyRuntime(){if(sha256(await comparisonBytes(input,{privateMode:true}))!==sha256(bytes)||sha256(await comparisonBytes(x.kubeconfigFile,{privateMode:true}))!==sha256(kubeBytes))deny();
   for(const [name,digest]of Object.entries(sources))if(sha256(await comparisonBytes(join(root,name)))!==digest)deny();for(const [path,proof]of Object.entries(executables))await executable(path,proof);}
  async function native(kind,row,extra={},clean=false){
   const signal=clean?cleanup.signal:active.signal;if(signal.aborted||remaining(clean)<=0)deny();await verifyRuntime();const plan=backupCommand(c,kind,row,extra),name=(clean?'cleanup-':'')+'native-'+String(++nativeSequence).padStart(6,'0');
   await files.json(name+'-intent.json',{kind,command:plan.command,args:plan.args,inputBytes:plan.input?.length??0,inputSHA256:plan.input?sha256(plan.input):null,state:'intent',noRetry:true});if(signal.aborted||remaining(clean)<=0)deny();
   const r=await backupProcess(plan.command,plan.args,{cwd:root,env:{PATH:[dirname(x.gcloudExecutable),dirname(x.pluginExecutable),'/usr/local/bin','/usr/bin','/bin'].join(':'),LANG:'C',LC_ALL:'C',CLOUDSDK_CONFIG:x.gcloudConfigDirectory,CLOUDSDK_CORE_PROJECT:x.project,CLOUDSDK_CORE_ACCOUNT:x.account,CLOUDSDK_CORE_DISABLE_PROMPTS:'1',CLOUDSDK_CORE_DISABLE_USAGE_REPORTING:'true',CLOUDSDK_COMPONENT_MANAGER_DISABLE_UPDATE_CHECK:'true',KUBECONFIG:x.kubeconfigFile},
    input:plan.input,timeout:Math.max(1,Math.min(120000,remaining(clean))),maxBuffer:kind==='dump'?66*1024*1024:2*1024*1024,signal});
   await files.json(name+'-observed.json',{kind,status:r.status,signal:r.signal,errorCode:r.error?.code??null,spawnEntered:r.spawnEntered,outputTruncated:r.outputTruncated,stdoutBytes:r.stdout.length,stderrBytes:r.stderr.length,stdoutSHA256:sha256(r.stdout),stderrSHA256:sha256(r.stderr),rawBinaryStoredByProtocol:!['cluster','namespace','pod'].includes(kind),noRetry:true});return r;
  }
  async function read(kind,clean=false){const r=await native(kind,undefined,{},clean);if(r.status!==0||r.signal||r.error||r.outputTruncated||credentialLike(r.stdout.toString())||credentialLike(r.stderr.toString()))deny();return strictComparisonJSON(r.stdout);}
  async function pod(clean=false){const value=await read('pod',clean);if(value.spec?.containers?.some(c=>c.env?.some(e=>/PASSWORD|TOKEN|SECRET/i.test(e.name??'')&&typeof e.value==='string'&&e.value.length)))deny();return confirmBackupPod(c,value);}
  const io={signal:active.signal,now:()=>performance.now(),remaining,get owned(){return files.owned;},json:files.json,put:files.put,readDump:(path,size)=>comparisonBytes(join(files.directory,path),{privateMode:true,limit:size}),
   reserve:()=>files.reserve({formatVersion:1,state:'started',runId:c.runId,sourceCommit:c.sourceCommit,inputSHA256:sha256(bytes),sourceSHA256:sources,cleanupReserveMs:360000,sourceCommitIsOperatorDeclaration:true,noRetry:true,privateBackupBytesMustNotBePublished:true}),
   async preflight(){const observations={cluster:await read('cluster'),namespace:await read('namespace')};const proof=confirmBackupCloud(c,kube,observations);await files.json('target-proof.json',{...proof,pod:await pod()});},
   async command(kind,row,extra,clean){await pod(clean);return native(kind,row,extra,clean);},verifyRuntime,
   terminal:r=>files.json('terminal.json',{...r,sourceSHA256:sources,nativeCommandIntents:nativeSequence,privateArtifacts:true,fileAloneIsNotSuccessfulExitOrPhysicalDurabilityProof:true}),
  };
  phase='protocol';const r=await runBackup(c,io);if(!r.passed||r.evidenceState)deny();console.log('Three selected database logical restores completed for this owned run. Private binary evidence retained; not regional recovery, schema/identity-store proof, billing, deployment or recovery SLA.');return 0;
 }catch{console.error('Backup refused or unconfirmed ('+phase+'). Preserve private intents/binary receipts. No automatic retry or resume; scratch ownership/cleanup may need manual reconciliation.');return 1;}
 finally{clearTimeout(activeTimer);clearTimeout(hardTimer);process.off('SIGINT',stop);process.off('SIGTERM',stop);if(mask!==undefined)process.umask(mask);}
}
function main(){try{return Boolean(process.argv[1])&&realpathSync(process.argv[1])===realpathSync(script);}catch{return false;}}
if(main())process.exitCode=await runBackupCLI(process.argv.slice(2));
