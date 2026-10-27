// Inactive POSIX/Node24 entry: --execute-imported-rescore, and explicit selected
// RG_CLOUD_RESCORE_CONFIG_FILE / AUTH_FILE / SOURCE_FILE (.json). Config is
// validateRetainedConfig's exact fields; source has two real-tagged retained jobs
// and ten cases. Auth is owned0600 under owned0700 parent: {token} or the exact
// guarded cloudToken client configuration. No .env/default token/refresh/retry.
// Only imported jobs, no provider/review/deployment. A client deadline does not
// cancel an accepted server job; preserve unknown outcomes, never resend/resume.
import { realpathSync } from 'node:fs';
import { lstat,realpath } from 'node:fs/promises';
import { dirname,join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { comparisonBytes,comparisonFiles,sha256,strictComparisonJSON } from './comparison-files.mjs';
import { validateRetainedConfig,runRetainedRescore } from './retained-rescore-core.mjs';
import { retainedRequest } from './retained-rescore-http.mjs';
const script=fileURLToPath(import.meta.url),root=resolve(dirname(script),'..'),deny=()=>{throw Error('Retained rescore refused');};
function selected(name){const path=process.env[name];if(!path||!path.endsWith('.json')||/[\x00-\x1f\x7f]/.test(path)||/^\.env/.test(path.split(/[\\/]/).at(-1)))deny();return resolve(path);}
export async function runRetainedCLI(args){
 let phase='arguments',files,mask,controller,timer,protocolStarted=false;const stop=()=>controller?.abort();
 try{
  if(args.length!==1||args[0]!=='--execute-imported-rescore'||process.platform==='win32'||Number(process.versions.node.split('.')[0])<24||process.env.CI||process.env.GITHUB_ACTIONS)deny();
  if((await lstat(process.argv[1]??script)).isSymbolicLink()||await realpath(process.cwd())!==await realpath(root))deny();
  if(['RELEASEGUARD_TOKEN','OIDC_CLIENT_SECRET','AUTH_SECRET','MODEL_API_KEY','MODEL_API_URL','MODEL_ID'].some(k=>Object.hasOwn(process.env,k)))deny();
  phase='configuration';const configFile=selected('RG_CLOUD_RESCORE_CONFIG_FILE'),authFile=selected('RG_CLOUD_RESCORE_AUTH_FILE'),sourceFile=selected('RG_CLOUD_RESCORE_SOURCE_FILE');
  if(new Set([configFile,authFile,sourceFile]).size!==3)deny();
  const configBytes=await comparisonBytes(configFile,{privateMode:true,limit:65536}),c=validateRetainedConfig(strictComparisonJSON(configBytes));
  const names=['scripts/cloud-rescore-retained.mjs','scripts/retained-rescore-core.mjs','scripts/retained-rescore-input.mjs','scripts/retained-rescore-http.mjs',
   'scripts/comparison-files.mjs','scripts/cloud-http.mjs','scripts/cloud-token.mjs','scripts/cloud-token-core.mjs','src/domain.ts','src/returns-policy.ts','dist/src/domain.js','dist/src/returns-policy.js','package-lock.json'],sources={};
  for(const name of names)sources[name]=sha256(await comparisonBytes(join(root,name)));
  phase='runtime';const runtime={domain:await import('../dist/src/domain.js'),policy:await import('../dist/src/returns-policy.js')};
  mask=process.umask(0o077);controller=new AbortController();timer=setTimeout(stop,c.deadlineMs);process.on('SIGINT',stop);process.on('SIGTERM',stop);
  files=comparisonFiles(root,c.runId,'cloud-retained-rescore');let originalBytes;
  const op=(n,suffix)=>'operations/'+String(n).padStart(4,'0')+'-'+suffix+'.json',checkSecrets=(bytes,value,secrets)=>{
   if(secrets.some(s=>bytes.includes(Buffer.from(s))||JSON.stringify(value).includes(s)))deny();};
  const io={signal:controller.signal,now:()=>performance.now(),get reservationOwned(){return files.owned;},
   reserve:()=>files.reserve({formatVersion:1,tool:'cloud-retained-rescore',config:c,configSHA256:sha256(configBytes),sourceSHA256:sources,state:'started',automaticResume:false}),
   async authInputs(){if(controller.signal.aborted)deny();const v=strictComparisonJSON(await comparisonBytes(authFile,{privateMode:true,limit:262144}));
    if(!v||Object.getPrototypeOf(v)!==Object.prototype)deny();
    if(c.authMode==='token'){if(Object.keys(v).length!==1||typeof v.token!=='string'||v.token.length>16384||!/^[-A-Za-z0-9._~+/]+=*$/.test(v.token))deny();}
    else if(v.targetOrigin!==c.origin||!Array.isArray(v.allowedOrigins)||!v.allowedOrigins.includes(c.origin)||v.allowedOrigins.some(o=>!c.allowedOrigins.includes(o))||typeof v.clientSecret!=='string'||!v.clientSecret.length)deny();
    return v;},secrets:v=>[c.authMode==='token'?v.token:v.clientSecret],
   async source(secrets){if(controller.signal.aborted)deny();originalBytes=await comparisonBytes(sourceFile);const value=strictComparisonJSON(originalBytes);checkSecrets(originalBytes,value,secrets);return {value,sha256:sha256(originalBytes)};},
   async retainSource(input,secrets){checkSecrets(originalBytes,input.value,secrets);return files.put('source-original.json',originalBytes);},
   async authenticate(v,config,n){if(controller.signal.aborted)deny();if(c.authMode==='token')return v.token;
    try{const {cloudToken}=await import('./cloud-token.mjs');return await cloudToken(v,{fetch:globalThis.fetch,signal:controller.signal});}
    catch(e){await files.json(op(n,'authentication'),{tokenAndResponseBodyWithheld:true,status:Number.isInteger(e?.status)?e.status:null,
      code:typeof e?.code==='string'&&/^[a-z_]{1,80}$/.test(e.code)?e.code:'unknown',automaticRetry:false});deny();}},
   intent:(n,v)=>files.json(op(n,'intent'),v),observed:(n,v)=>{const {body,...raw}=v;return files.json(op(n,'observed'),raw);},result:(n,v)=>files.json(op(n,'result'),v),
   request:(origin,operation,token,timeout,signal,secrets)=>retainedRequest(origin,operation,token,timeout,signal,globalThis.fetch,secrets),
   async sleep(ms,signal){if(signal.aborted)deny();await new Promise((ok,bad)=>{const cancelled=()=>{clearTimeout(t);bad(Error('stopped'));},t=setTimeout(()=>{signal.removeEventListener('abort',cancelled);ok();},ms);signal.addEventListener('abort',cancelled,{once:true});});},
   retain:(name,value)=>files.json(name,value),
   async terminal(value){
    if(value.status==='completed'){
     for(const name of names)if(sha256(await comparisonBytes(join(root,name)))!==sources[name])deny();
     if(sha256(await comparisonBytes(configFile,{privateMode:true,limit:65536}))!==sha256(configBytes)||sha256(await comparisonBytes(sourceFile))!==sha256(originalBytes)||controller.signal.aborted)deny();
    }
    await files.json('terminal.json',{...value,sourceSHA256:sources,fileAloneIsNotProofOfSuccessfulExitOrDurability:true});
   },
  };
  phase='protocol';protocolStarted=true;const result=await runRetainedRescore(c,io,runtime);if(result.status!=='completed'||!result.terminalWritten)deny();
  console.log('Imported rescore protocol completed. Original records retained; rule outcomes are not semantic quality, human approval or deployment.');return 0;
 }catch{
  if(files?.owned&&!protocolStarted){try{await files.json('terminal.json',{status:'entry_failed_or_evidence_unknown',phase,automaticResume:false});}catch{}}
  console.error('Imported rescore refused or unconfirmed ('+phase+'). Preserve evidence; do not repeat an uncertain run ID.');return 1;
 }finally{clearTimeout(timer);process.off('SIGINT',stop);process.off('SIGTERM',stop);if(mask!==undefined)process.umask(mask);}
}
function main(){try{return Boolean(process.argv[1])&&realpathSync(process.argv[1])===realpathSync(script);}catch{return false;}}
if(main())process.exitCode=await runRetainedCLI(process.argv.slice(2));
