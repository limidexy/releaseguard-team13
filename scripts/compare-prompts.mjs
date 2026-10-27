// Inactive POSIX/Node24 operator entry; importing/bare invocation never connects.
// Explicit: --execute-comparison replay|real, RG_COMPARISON_CONFIG_FILE and
// RG_COMPARISON_AUTH_FILE (owned0600 JSON under owned0700 parents). No .env.
// Config: exact validateComparison fields. Report format2.2 != rules v2.1/v2.2.
// token: {token}; development: {secret:64hex,subject}; client-credentials: the
// exact guarded cloudToken config. Optional RG_COMPARISON_BASELINE_FILE is
// legacy-format JSON; its original bytes/hash and new derivation stay separate.
// Real capability requires modelRequestBudget20; no retry/automatic resume.
import { realpathSync } from 'node:fs';
import { lstat,realpath } from 'node:fs/promises';
import { dirname,join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateComparison,runComparison } from './comparison-core.mjs';
import { comparisonRequest } from './comparison-http.mjs';
import { comparisonBytes,comparisonFiles,sha256,strictComparisonJSON } from './comparison-files.mjs';
const script=fileURLToPath(import.meta.url),root=resolve(dirname(script),'..');
const deny=()=>{throw Error('Comparison entry refused');};
const selectedFile=name=>{const value=process.env[name];if(!value||/[\x00-\x1f\x7f]/.test(value)||!value.endsWith('.json')||/^\.env/.test(value.split(/[\\/]/).at(-1)))deny();return resolve(value);};
export async function runComparisonCLI(args){
 let mask,timer,controller,files,protocolStarted=false,phase='arguments';const stop=()=>controller?.abort();
 try{
  if(args.length!==2||args[0]!=='--execute-comparison'||!['replay','real'].includes(args[1])||process.platform==='win32'||
   Number(process.versions.node.split('.')[0])<24||process.env.CI||process.env.GITHUB_ACTIONS)deny();
  if((await lstat(process.argv[1]??script)).isSymbolicLink()||await realpath(process.cwd())!==await realpath(root))deny();
  if(['RELEASEGUARD_TOKEN','OIDC_CLIENT_SECRET','AUTH_SECRET','MODEL_API_KEY','RG_BASELINE_REPORT','RG_SUITE_REVISION'].some(k=>Object.hasOwn(process.env,k)))deny();
  phase='configuration';const configFile=selectedFile('RG_COMPARISON_CONFIG_FILE'),authFile=selectedFile('RG_COMPARISON_AUTH_FILE');
  if(configFile===authFile)deny();const configBytes=await comparisonBytes(configFile,{privateMode:true,limit:65536}),c=validateComparison(strictComparisonJSON(configBytes));
  if(c.source!==args[1])deny();
  if(c.targetKind==='isolated-acceptance'&&(process.env.RG_ACCEPTANCE_INTEGRATION!=='1'||process.env.RG_COMPARISON_ACCEPTANCE_RUN_ID!==c.runId||
   process.env.COMPOSE_PROJECT_NAME!=='rg-contracts-'+c.runId))deny();
  if(c.targetKind!=='isolated-acceptance'&&process.env.RG_COMPARISON_ACCEPTANCE_RUN_ID!==undefined)deny();
  const baselineFile=process.env.RG_COMPARISON_BASELINE_FILE?selectedFile('RG_COMPARISON_BASELINE_FILE'):null;
  if(baselineFile===authFile||baselineFile===configFile)deny();
  const sourceNames=['scripts/compare-prompts.mjs','scripts/comparison-core.mjs','scripts/comparison-report.mjs','scripts/comparison-http.mjs','scripts/comparison-files.mjs',
   'scripts/cloud-http.mjs','scripts/cloud-token.mjs','scripts/cloud-token-core.mjs','dist/src/domain.js','dist/src/returns-policy.js','public/demo-fixtures.json','package-lock.json'],sources={};
  for(const name of sourceNames)sources[name]=sha256(await comparisonBytes(join(root,name)));
  phase='runtime';const runtime={domain:await import('../dist/src/domain.js'),policy:await import('../dist/src/returns-policy.js')};
  mask=process.umask(0o077);controller=new AbortController();timer=setTimeout(stop,c.deadlineMs);process.on('SIGINT',stop);process.on('SIGTERM',stop);
  files=comparisonFiles(root,c.runId);let baselineOriginal;
  const operation=(n,suffix)=>'operations/'+String(n).padStart(4,'0')+'-'+suffix+'.json';
  const io={signal:controller.signal,now:()=>performance.now(),get reservationOwned(){return files.owned;},
   reserve:()=>files.reserve({schemaVersion:1,config:c,configSHA256:sha256(configBytes),sourceSHA256:sources,state:'started',automaticResume:false}),
   fixture:async()=>strictComparisonJSON(await comparisonBytes(join(root,'public/demo-fixtures.json'))),
   async baseline(secrets){if(!baselineFile)return null;baselineOriginal=await comparisonBytes(baselineFile);const value=strictComparisonJSON(baselineOriginal);
    if(secrets.some(v=>baselineOriginal.includes(Buffer.from(v))||JSON.stringify(value).includes(v)))deny();
    await files.put('baseline-original.bin',baselineOriginal);return {value,sha256:sha256(baselineOriginal)};},
   async authInputs(){if(controller.signal.aborted)deny();const v=strictComparisonJSON(await comparisonBytes(authFile,{privateMode:true,limit:262144}));
    if(!v||Object.getPrototypeOf(v)!==Object.prototype)deny();
    if(c.authMode==='token'){if(Object.keys(v).length!==1||typeof v.token!=='string'||!/^[-A-Za-z0-9._~+/]+=*$/.test(v.token)||v.token.length>16384)deny();}
    else if(c.authMode==='development'){if(Object.keys(v).length!==2||!/^[a-f0-9]{64}$/.test(v.secret??'')||!/^comparison-[a-z0-9-]{1,60}$/.test(v.subject??''))deny();}
    else if(v.targetOrigin!==c.origin||!Array.isArray(v.allowedOrigins)||v.allowedOrigins.some(o=>!c.allowedOrigins.includes(o))||!v.allowedOrigins.includes(c.origin)||typeof v.clientSecret!=='string'||!v.clientSecret.length)deny();
    return v;},
   secrets:v=>c.authMode==='token'?[v.token]:c.authMode==='development'?[v.secret]:[v.clientSecret],
   async authenticate(v,config,name,n){
    if(controller.signal.aborted)deny();if(c.authMode==='token')return v.token;
    if(c.authMode==='development'){const {SignJWT}=await import('jose');if(controller.signal.aborted)deny();return new SignJWT({workspace:c.workspace,role:'contributor',service:false})
      .setSubject(v.subject).setProtectedHeader({alg:'HS256'}).setIssuer('releaseguard-local').setAudience('releaseguard').setIssuedAt().setExpirationTime('15m').sign(new TextEncoder().encode(v.secret));}
    try{const {cloudToken}=await import('./cloud-token.mjs');return await cloudToken(v,{fetch:globalThis.fetch,signal:controller.signal});}
    catch(e){await files.json(operation(n,'authentication'),{name,tokenAndResponseBodyWithheld:true,status:Number.isInteger(e?.status)?e.status:null,
      code:typeof e?.code==='string'&&/^[a-z_]{1,80}$/.test(e.code)?e.code:'unknown',automaticRetry:false});deny();}
   },
   intent:(n,v)=>files.json(operation(n,'intent'),v),observed:(n,v)=>{const {body,...raw}=v;return files.json(operation(n,'observed'),raw);},result:(n,v)=>files.json(operation(n,'result'),v),
   request:(origin,op,token,timeout,signal,secrets)=>comparisonRequest(origin,op,token,timeout,signal,globalThis.fetch,secrets),
   async sleep(ms,signal){if(signal.aborted)deny();await new Promise((ok,bad)=>{const cancel=()=>{clearTimeout(t);bad(Error('stopped'));},t=setTimeout(()=>{signal.removeEventListener('abort',cancel);ok();},ms);signal.addEventListener('abort',cancel,{once:true});});},
   retain:(name,value)=>files.json(name,value),
   async terminal(value){
    if(value.status==='completed'){
     for(const name of sourceNames)if(sha256(await comparisonBytes(join(root,name)))!==sources[name])deny();
     if(sha256(await comparisonBytes(configFile,{privateMode:true,limit:65536}))!==sha256(configBytes)||
      baselineFile&&sha256(await comparisonBytes(baselineFile))!==sha256(baselineOriginal)||controller.signal.aborted)deny();
    }
    await files.json('terminal.json',{...value,sourceSHA256:sources,fileAloneIsNotProofOfSuccessfulExitOrDurability:true});
   },
  };
  phase='protocol';protocolStarted=true;const r=await runComparison(c,io,runtime);if(r.status!=='completed'||!r.terminalWritten)deny();
  console.log('Comparison completed; private evidence retained. Rule scores are not semantic accuracy, human approval or deployment.');return 0;
 }catch{
  if(files?.owned&&!protocolStarted){try{await files.json('terminal.json',{status:'entry_failed_or_evidence_unknown',phase,automaticResume:false});}catch{}}
  console.error('Comparison refused or unconfirmed ('+phase+'). Retain private evidence; do not repeat an uncertain run ID.');return 1;
 }finally{clearTimeout(timer);process.off('SIGINT',stop);process.off('SIGTERM',stop);if(mask!==undefined)process.umask(mask);}
}
function isMain(){try{return Boolean(process.argv[1])&&realpathSync(process.argv[1])===realpathSync(script);}catch{return false;}}
if(isMain())process.exitCode=await runComparisonCLI(process.argv.slice(2));
