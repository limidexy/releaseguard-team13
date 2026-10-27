// Inactive operator tool, POSIX Node24 only. Never wired to application/CI/CD.
// --archive-offline --input <private JSON>: archive explicitly selected records.
// --collect-readonly --input <private JSON> [--power-only]: own opt-in to bounded
// read-only gcloud/kubectl commands; NOT a shutdown or free-quota action.
// No login/get-credentials/install/apply/resize/delete/exec/retry is implemented.
// A live run requires a minified private JSON kubeconfig with an explicitly
// selected existing GKE exec plugin. Default kubeconfig/.env is never read.
import {realpathSync} from 'node:fs';
import {lstat} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {comparisonBytes,comparisonFiles,noComparisonLinks,strictComparisonJSON,sha256} from './comparison-files.mjs';
import {acceptanceProcess} from './acceptance-process.mjs';
import {validateEvidenceConfiguration,validateEvidenceKubeconfig,runEvidenceProtocol} from './gcp-evidence-core.mjs';
const script=fileURLToPath(import.meta.url),root=resolve(dirname(script),'..'),deny=()=>{throw Error('Cloud evidence refused');};
async function privateDirectory(path){await noComparisonLinks(path);const s=await lstat(path);if(!s.isDirectory()||(s.mode&0o077)!==0||s.uid!==process.getuid())deny();}
export async function runGcpEvidenceCLI(args){
 let phase='arguments',timer,mask,controller,files;const began=performance.now(),stop=()=>controller?.abort();
 try{
  if(process.platform==='win32'||Number(process.versions.node.split('.')[0])<24||process.env.CI||process.env.GITHUB_ACTIONS||
   realpathSync(process.cwd())!==realpathSync(root)||(await lstat(process.argv[1]??script)).isSymbolicLink())deny();
  const powerOnly=args.length===4&&args[3]==='--power-only';
  if(!['--archive-offline','--collect-readonly'].includes(args[0])||args[1]!=='--input'||!args[2]||args.length!==(powerOnly?4:3))deny();
  phase='configuration';const input=resolve(args[2]);if(!input.endsWith('.json'))deny();
  const configBytes=await comparisonBytes(input,{privateMode:true}),config=validateEvidenceConfiguration(strictComparisonJSON(configBytes),powerOnly);
  if(args[0]!=='--'+config.mode)deny();
  if(Object.values(config.sources).some(x=>resolve(x.path)===input))deny();
  const remaining=()=>Math.floor(config.deadlineMs-(performance.now()-began));if(remaining()<=0)deny();
  controller=new AbortController();timer=setTimeout(stop,remaining());process.on('SIGINT',stop);process.on('SIGTERM',stop);
  let kube=null,kubeSHA256;
  if(config.mode==='collect-readonly'){
   phase='selected-runtime';const c=config.cloud;
   if(input===c.kubeconfigFile||Object.values(config.sources).some(x=>resolve(x.path)===c.kubeconfigFile))deny();
   await privateDirectory(c.gcloudConfigDirectory);
   // Only validate the explicitly selected file; never persist its credentials.
   const kubeBytes=await comparisonBytes(c.kubeconfigFile,{privateMode:true});kubeSHA256=sha256(kubeBytes);
   kube=validateEvidenceKubeconfig(strictComparisonJSON(kubeBytes),c);
   for(const file of [c.gcloudExecutable,c.kubectlExecutable,c.pluginExecutable]){await noComparisonLinks(file);const s=await lstat(file);if(!s.isFile()||(s.mode&0o022)!==0)deny();}
  }
  const sourceHashes={};for(const name of ['scripts/gcp-evidence.mjs','scripts/gcp-evidence-core.mjs','scripts/comparison-files.mjs','scripts/acceptance-process.mjs'])
   sourceHashes[name]=sha256(await comparisonBytes(join(root,name)));
  mask=process.umask(0o077);files=comparisonFiles(root,config.runId,'cloud-evidence');
  async function verifyRuntime(){
   if(sha256(await comparisonBytes(input,{privateMode:true}))!==sha256(configBytes))deny();
   if(config.cloud&&sha256(await comparisonBytes(config.cloud.kubeconfigFile,{privateMode:true}))!==kubeSHA256)deny();
   for(const [name,hash]of Object.entries(sourceHashes))if(sha256(await comparisonBytes(join(root,name)))!==hash)deny();
  }
  const io={
   powerOnly,kube,signal:controller.signal,remaining,clock:()=>performance.now(),get owned(){return files.owned;},
   reserve:metadata=>files.reserve({...metadata,inputSHA256:sha256(configBytes),sourceSHA256:sourceHashes,declaredIdentityIsNotAttestation:true}),
   read:path=>comparisonBytes(path),put:files.put,json:files.json,verifyRuntime,
   async verifyArchives(entries){for(const row of entries)if(sha256(await comparisonBytes(join(files.directory,row.role),{privateMode:true}))!==row.sha256)deny();},
   async command({command,args}){
    await verifyRuntime();if(controller.signal.aborted||remaining()<=0)deny();const c=config.cloud;
    if(command!==c.gcloudExecutable&&command!==c.kubectlExecutable)deny();
    return acceptanceProcess(command,args,{cwd:root,env:{PATH:[dirname(c.gcloudExecutable),dirname(c.pluginExecutable),'/usr/local/bin','/usr/bin','/bin'].join(':'),
     LANG:'C',LC_ALL:'C',CLOUDSDK_CONFIG:c.gcloudConfigDirectory,CLOUDSDK_CORE_PROJECT:c.project,CLOUDSDK_CORE_ACCOUNT:c.account,
     CLOUDSDK_CORE_DISABLE_PROMPTS:'1',CLOUDSDK_CORE_DISABLE_USAGE_REPORTING:'true',CLOUDSDK_COMPONENT_MANAGER_DISABLE_UPDATE_CHECK:'true',KUBECONFIG:c.kubeconfigFile},
     timeout:Math.min(60000,remaining()),maxBuffer:2*1024*1024,signal:controller.signal});
   },
  };
  phase='protocol';const result=await runEvidenceProtocol(config,io);
  if(result.status!=='completed'||result.evidenceState)deny();
  console.log('Evidence workflow completed only. Shutdown/free-cost claims are separate; no model or deployment action.');return 0;
 }catch{
  console.error('Cloud evidence refused or unconfirmed ('+phase+'). Retain this private run; no automatic retry or resume.');return 1;
 }finally{
  clearTimeout(timer);process.off('SIGINT',stop);process.off('SIGTERM',stop);if(mask!==undefined)process.umask(mask);
 }
}
function isMain(){try{return Boolean(process.argv[1])&&realpathSync(process.argv[1])===realpathSync(script);}catch{return false;}}
if(isMain())process.exitCode=await runGcpEvidenceCLI(process.argv.slice(2));
