import assert from 'node:assert/strict';
import {appendFile,mkdir,open,readFile,stat,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parseEnv} from 'node:util';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {boundedJson,responseModeV8,responseModesV14} from '../dist/src/provider.js';
import {decisionForQuestionV1} from '../dist/src/returns-decision-v1.js';
import {compileResponseContractV17} from '../dist/src/response-contract-v17.js';
import {checkResponseContractV17} from '../dist/src/response-contract-guard-v17.js';
import {compileGenerationViewV17R3,generationPromptV17R3,generationViewContextV17R3} from '../dist/src/generation-view-v17.js';
import {checkExplanationV2} from '../dist/src/output-guard-v2.js';
import {evaluate} from '../dist/src/domain.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const evidenceDir=resolve(root,'docs/evidence/model-v17-ab-r4-2026-10-17');
const planPath=resolve(evidenceDir,'ab-plan-v17-r4.json');
const manifestPath=resolve(evidenceDir,'freeze-manifest-r4.json');
const verificationPath=resolve(evidenceDir,'free-plan-verification-r4.json');
const lockPath=resolve(evidenceDir,'experiment-v17-r4.lock.json');
const attemptsPath=resolve(evidenceDir,'experiment-v17-r4.attempts.jsonl');
const outcomesPath=resolve(evidenceDir,'experiment-v17-r4.outcomes.jsonl');
const completionPath=resolve(evidenceDir,'experiment-v17-r4.complete.json');
const finalReportPath=resolve(evidenceDir,'ab-real-v17-r4-final.json');
const sha=value=>createHash('sha256').update(value).digest('hex');
const stableSha=value=>sha(JSON.stringify(value));
const safeRateHeaders=response=>Object.fromEntries(['x-ratelimit-limit-requests','x-ratelimit-remaining-requests','x-ratelimit-reset-requests','x-ratelimit-limit-tokens','x-ratelimit-remaining-tokens','x-ratelimit-reset-tokens','retry-after'].map(name=>[name,response.headers.get(name)]).filter(([,value])=>value!==null));
const exists=async path=>{try{await stat(path);return true;}catch(error){if(error?.code==='ENOENT')return false;throw error;}};
const readJson=async path=>JSON.parse(await readFile(path,'utf8'));
const appendDurable=async(path,value)=>{const handle=await open(path,'a');try{await handle.appendFile(JSON.stringify(value)+'\n');await handle.sync();}finally{await handle.close();}};
const readJsonl=async path=>{if(!await exists(path))return [];return (await readFile(path,'utf8')).split('\n').filter(Boolean).map(line=>JSON.parse(line));};
const percentile=(numbers,p)=>{if(!numbers.length)return null;const sorted=[...numbers].sort((a,b)=>a-b),index=Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1);return Number(sorted[Math.max(0,index)].toFixed(2));};
const latencySummary=numbers=>({count:numbers.length,min:percentile(numbers,0),p50:percentile(numbers,.5),p95:percentile(numbers,.95),max:percentile(numbers,1),mean:numbers.length?Number((numbers.reduce((a,b)=>a+b,0)/numbers.length).toFixed(2)):null});

if(process.env.RG_CONFIRM_AB_CALLS!=='40')throw Error('This one-time experiment requires RG_CONFIRM_AB_CALLS=40 from the explicitly authorized execution.');
if(!process.argv[2])throw Error('Supply the existing local provider env-file path, never an API key.');
await mkdir(evidenceDir,{recursive:true});
if(await exists(completionPath))throw Error('The one-time v17 r4 experiment is already complete; a second run is forbidden.');

const [planRaw,manifestRaw,verificationRaw]=await Promise.all([readFile(planPath),readFile(manifestPath),readFile(verificationPath)]);
const plan=JSON.parse(planRaw),manifest=JSON.parse(manifestRaw),verification=JSON.parse(verificationRaw);
assert.equal(plan.revision,'v17-generation-view-r4-ab1');
assert.equal(plan.totalBudgetedCalls,40);assert.equal(plan.automaticRetries,0);
assert.equal(plan.authorization.userAuthorizedOneExperiment,true);
for(const field of ['paidUpgradeAllowed','providerSwitchAllowed','deploymentAllowed','publicationAllowed','gitPushAllowed'])assert.equal(plan.authorization[field],false);
assert.equal(verification.billingPage.visiblePlan,'Free');assert.equal(verification.billingPage.visiblePrice,'$0');assert.equal(verification.billingPage.visibleStatus,'Current Plan');assert.equal(verification.billingPage.paidUpgradePerformed,false);
assert.equal(sha(verificationRaw),plan.freePlanVerificationSha256);
assert.ok(Date.now()-Date.parse(verification.checkedAt)<2*60*60*1000,'Free-plan UI evidence is stale; stop before inference.');
assert.equal(sha(manifestRaw),plan.freezeManifestSha256);
for(const entry of manifest.files){const raw=await readFile(resolve(root,entry.path));assert.equal(sha(raw),entry.sha256,`Frozen execution file changed: ${entry.path}`);assert.equal(raw.length,entry.bytes,`Frozen execution file size changed: ${entry.path}`);}
assert.equal(process.version,manifest.runtime.nodeVersion,'Node runtime differs from the frozen runtime.');

const sourcePlanRaw=await readFile(resolve(root,plan.sourceQuestionPlan));assert.equal(sha(sourcePlanRaw),plan.sourceQuestionPlanSha256);
const sourcePlan=JSON.parse(sourcePlanRaw),cases=sourcePlan.suites.flatMap(s=>s.cases);
assert.deepEqual(cases.map(c=>c.id),plan.questionOrder);assert.equal(cases.length,20);
assert.equal(sha(generationPromptV17R3),plan.frozenDerivedHashes.generationPrompt);
assert.equal(stableSha(responseModesV14),plan.frozenDerivedHashes.responseModes);
const frozenCases=cases.map(testCase=>{const decision=decisionForQuestionV1(testCase.prompt),responseMode=responseModeV8(testCase.prompt),contract=compileResponseContractV17(testCase.prompt,decision,responseMode),view=compileGenerationViewV17R3(decision,contract);assert.equal(contract.compilationStatus,'ready');return {caseId:testCase.id,questionSha256:sha(testCase.prompt),contractSha256:stableSha(contract),generationViewSha256:stableSha(view)};});
assert.equal(stableSha(frozenCases),plan.frozenDerivedHashes.compiledCaseContractAndViewSet);

const saved=parseEnv(await readFile(resolve(process.argv[2]),'utf8'));if(!saved.MODEL_API_KEY)throw Error('Saved provider key missing.');
const modelsResponse=await fetch('https://api.groq.com/openai/v1/models',{headers:{authorization:'Bearer '+saved.MODEL_API_KEY},redirect:'error',signal:AbortSignal.timeout(15000)});
if(!modelsResponse.ok)throw Error('Provider account preflight failed with HTTP '+modelsResponse.status+'. No inference request was made.');
const modelsBody=await boundedJson(modelsResponse),listed=new Set((modelsBody?.data??[]).filter(x=>x?.active!==false).map(x=>x.id));for(const arm of plan.arms)if(!listed.has(arm.model))throw Error('Frozen model is unavailable: '+arm.model+'. No inference request was made.');

const planSha256=sha(planRaw),lockRecord={experimentId:plan.experimentId,revision:plan.revision,planSha256,createdAt:new Date().toISOString(),state:'STARTED',maximumInferenceRequests:40,noAutomaticRetry:true};
if(!await exists(lockPath)){await writeFile(lockPath,JSON.stringify(lockRecord,null,2)+'\n',{flag:'wx'});await appendDurable(attemptsPath,{event:'ledger-created',experimentId:plan.experimentId,createdAt:lockRecord.createdAt});}
else{const existing=await readJson(lockPath);assert.equal(existing.experimentId,plan.experimentId);assert.equal(existing.planSha256,planSha256);}

const previousAttempts=await readJsonl(attemptsPath),attemptedKeys=new Set(previousAttempts.filter(x=>x.event==='send-attempt-recorded').map(x=>x.key));
const previousOutcomes=await readJsonl(outcomesPath),outcomesByKey=new Map(previousOutcomes.filter(x=>x.event==='provider-outcome').map(x=>[x.key,x]));
assert.equal(attemptedKeys.size,previousAttempts.filter(x=>x.event==='send-attempt-recorded').length,'Duplicate attempt keys exist; stop rather than resend.');

const callOnce=async(model,testCase,arm)=>{
 const decision=decisionForQuestionV1(testCase.prompt),responseMode=responseModeV8(testCase.prompt),contract=compileResponseContractV17(testCase.prompt,decision,responseMode),viewContext=generationViewContextV17R3(decision,contract);
 const systemText=generationPromptV17R3+'\n\n'+viewContext.text+'\n\n'+responseModesV14[responseMode];
 const requestBody={model,messages:[{role:'system',content:systemText},{role:'user',content:testCase.prompt}],temperature:plan.configuration.temperature,reasoning_effort:plan.configuration.reasoningEffort,max_completion_tokens:plan.configuration.maxOutputTokens};
 const key=arm+':'+testCase.id,requestSnapshot={providerEndpoint:plan.providerEndpoint,arm,caseId:testCase.id,...requestBody};
 await appendDurable(attemptsPath,{event:'send-attempt-recorded',experimentId:plan.experimentId,key,recordedAt:new Date().toISOString(),requestSnapshotSha256:stableSha(requestSnapshot),requestSnapshot});attemptedKeys.add(key);
 const startedAt=new Date().toISOString(),start=performance.now();
 try{
  const response=await fetch(plan.providerEndpoint,{method:'POST',headers:{authorization:'Bearer '+saved.MODEL_API_KEY,'content-type':'application/json'},redirect:'error',signal:AbortSignal.timeout(plan.configuration.requestTimeoutMs),body:JSON.stringify(requestBody)});
  const rateLimitHeaders=safeRateHeaders(response),headerRequestId=response.headers.get('x-request-id')??response.headers.get('request-id');
  let body;try{body=await boundedJson(response);}catch(error){body={parseError:error?.message??'Unable to parse provider body'};}
  const common={startedAt,latencyMs:Number((performance.now()-start).toFixed(2)),requestSnapshotSha256:stableSha(requestSnapshot),metadata:{httpStatus:response.status,providerRequestId:body?.id??headerRequestId??null,reportedModel:body?.model??null,rateLimitHeaders,responseMode,systemPromptSha256:sha(systemText),contractSha256:stableSha(contract),generationViewSha256:stableSha(viewContext.view)}};
  if(!response.ok){const providerError={type:body?.error?.type??null,code:body?.error?.code??null,message:typeof body?.error?.message==='string'?body.error.message.slice(0,500):null};return {...common,error:'Provider HTTP '+response.status,metadata:{...common.metadata,finishReason:null,usage:{},providerError}};}
  const output=body?.choices?.[0]?.message?.content,finishReason=typeof body?.choices?.[0]?.finish_reason==='string'?body.choices[0].finish_reason:null,usage={};for(const field of ['prompt_tokens','completion_tokens','total_tokens'])if(Number.isSafeInteger(body?.usage?.[field])&&body.usage[field]>=0)usage[field]=body.usage[field];
  const error=finishReason==='length'?'Provider answer truncated at token limit':typeof output!=='string'||!output.trim()?'Provider returned no text':finishReason!=='stop'?'Provider finish reason '+String(finishReason):undefined;
  return {...common,...(typeof output==='string'?{output}:{}),...(error?{error}:{}),metadata:{...common.metadata,finishReason,usage,oldGuard:checkExplanationV2(output,decision,responseMode,error),contractGuard:checkResponseContractV17(output,contract,decision,error)}};
 }catch(error){return {startedAt,latencyMs:Number((performance.now()-start).toFixed(2)),requestSnapshotSha256:stableSha(requestSnapshot),error:'Provider request failed or timed out; not retried',metadata:{httpStatus:null,providerRequestId:null,reportedModel:null,rateLimitHeaders:{},finishReason:null,usage:{},failureClass:error?.name??'Error',responseMode,systemPromptSha256:sha(systemText),contractSha256:stableSha(contract),generationViewSha256:stableSha(viewContext.view),oldGuard:checkExplanationV2(undefined,decision,responseMode,'Provider request failed'),contractGuard:checkResponseContractV17(undefined,contract,decision,'Provider request failed')}};}
};

let nextStart=0;
for(const testCase of cases)for(const arm of plan.arms){
 const key=arm.arm+':'+testCase.id;
 if(attemptedKeys.has(key))continue;
 if(Date.now()<nextStart)await delay(nextStart-Date.now());nextStart=Date.now()+plan.configuration.minimumStartIntervalMs;
 const result=await callOnce(arm.model,testCase,arm.arm),outcome={event:'provider-outcome',experimentId:plan.experimentId,key,arm:arm.arm,model:arm.model,caseId:testCase.id,prompt:testCase.prompt,recordedAt:new Date().toISOString(),...result};
 await appendDurable(outcomesPath,outcome);outcomesByKey.set(key,outcome);
 console.log(JSON.stringify({attempted:attemptedKeys.size,arm:arm.arm,caseId:testCase.id,httpStatus:outcome.metadata.httpStatus,finishReason:outcome.metadata.finishReason,error:outcome.error??null}));
}

const finalAttempts=await readJsonl(attemptsPath),finalOutcomes=await readJsonl(outcomesPath),finalAttemptedKeys=new Set(finalAttempts.filter(x=>x.event==='send-attempt-recorded').map(x=>x.key)),finalOutcomesByKey=new Map(finalOutcomes.filter(x=>x.event==='provider-outcome').map(x=>[x.key,x]));
assert.ok(finalAttemptedKeys.size<=40);assert.equal(finalAttemptedKeys.size,40,'Experiment stopped before all authorized attempts were recorded. Preserve ledgers and resume only this same experiment.');

const report={revision:plan.revision,experimentId:plan.experimentId,startedAt:lockRecord.createdAt,finishedAt:new Date().toISOString(),source:'real',planSha256,freezeManifestSha256:sha(manifestRaw),freePlanVerificationSha256:sha(verificationRaw),automaticRetries:0,totalBudgetedCalls:40,totalAttemptedRequests:finalAttemptedKeys.size,questionOrder:plan.questionOrder,arms:plan.arms,configuration:plan.configuration,calls:[],results:[],comparison:null,semanticReferenceAnnotations:{source:'Project evaluation annotations, not a verified independent human-review record.',historicalArtifact:'docs/evidence/model-v17-credibility-r3-2026-10-17/semantic-audit-v17-r3.json'},limitations:plan.limitations};
for(const testCase of cases)for(const arm of plan.arms){const key=arm.arm+':'+testCase.id,outcome=finalOutcomesByKey.get(key);report.calls.push(outcome?{...outcome,event:undefined,experimentId:undefined,key:undefined,recordedAt:undefined}:{arm:arm.arm,model:arm.model,caseId:testCase.id,prompt:testCase.prompt,error:'Attempt recorded but provider outcome is unknown; request was not resent.',metadata:{httpStatus:null,providerRequestId:null,reportedModel:null,rateLimitHeaders:{},finishReason:null,usage:{}}});}

const finalByArm={};
for(const arm of plan.arms){
 const calls=report.calls.filter(x=>x.arm===arm.arm),outputs=calls.map(x=>({caseId:x.caseId,...(x.output!==undefined?{output:x.output}:{}),latencyMs:x.latencyMs??0,...(x.error?{error:x.error}:{})})),raw=evaluate(cases,{minScore:95,maxLatencyMs:null},outputs),rawByCase=new Map(raw.results.map(x=>[x.caseId,x]));
 const perCase=calls.map(call=>{const rawCase=rawByCase.get(call.caseId),oldGuard=call.metadata?.oldGuard??{passed:false,failures:['missing_old_guard']},contractGuard=call.metadata?.contractGuard??{responseContractCompliance:{status:'blocked',ruleIds:['missing_contract_guard']},businessConsistency:{status:'blocked',ruleIds:['missing_contract_guard']},customerTextSafety:{status:'blocked',ruleIds:['missing_contract_guard']},finalDeliveryStatus:'blocked'};const conditions={providerComplete:!call.error&&call.metadata?.httpStatus===200&&call.metadata?.finishReason==='stop',rawV210:rawCase?.status==='passed',independentOldGuard:oldGuard.passed===true,newContractCompliance:contractGuard.responseContractCompliance?.status==='passed',businessConsistency:contractGuard.businessConsistency?.status==='passed',customerTextSafety:contractGuard.customerTextSafety?.status==='passed',contractFinalDelivery:contractGuard.finalDeliveryStatus==='allowed'};return {caseId:call.caseId,conditions,finalDelivery:Object.values(conditions).every(Boolean)?'allowed':'blocked',rawV210:rawCase,oldGuard,contractGuard,provider:{error:call.error??null,httpStatus:call.metadata?.httpStatus??null,finishReason:call.metadata?.finishReason??null,requestId:call.metadata?.providerRequestId??null,reportedModel:call.metadata?.reportedModel??null,usage:call.metadata?.usage??{},latencyMs:call.latencyMs??null}};});
 const tokenTotals=['prompt_tokens','completion_tokens','total_tokens'].reduce((acc,field)=>({...acc,[field]:calls.reduce((sum,x)=>sum+(x.metadata?.usage?.[field]??0),0)}),{});
 const result={arm:arm.arm,model:arm.model,fixedDenominator:20,rawV210:{score:raw.score,gate:raw.gate,passed:raw.passed,errors:raw.errors,criticalFailures:raw.criticalFailures},independentOldGuard:{allowed:perCase.filter(x=>x.conditions.independentOldGuard).length,blocked:perCase.filter(x=>!x.conditions.independentOldGuard).length},newContractCompliance:{allowed:perCase.filter(x=>x.conditions.newContractCompliance).length,blocked:perCase.filter(x=>!x.conditions.newContractCompliance).length},businessConsistency:{allowed:perCase.filter(x=>x.conditions.businessConsistency).length,blocked:perCase.filter(x=>!x.conditions.businessConsistency).length},customerTextSafety:{allowed:perCase.filter(x=>x.conditions.customerTextSafety).length,blocked:perCase.filter(x=>!x.conditions.customerTextSafety).length},finalExactIntersection:{allowed:perCase.filter(x=>x.finalDelivery==='allowed').length,blocked:perCase.filter(x=>x.finalDelivery!=='allowed').length},providerErrors:perCase.filter(x=>x.provider.error).map(x=>({caseId:x.caseId,error:x.provider.error,httpStatus:x.provider.httpStatus})),truncated:perCase.filter(x=>x.provider.finishReason==='length').map(x=>x.caseId),unexecuted:perCase.filter(x=>x.provider.error?.startsWith('Attempt recorded but')).map(x=>x.caseId),tokens:tokenTotals,latencyMs:latencySummary(perCase.map(x=>x.provider.latencyMs).filter(Number.isFinite)),perCase};
 report.results.push(result);finalByArm[arm.arm]=new Map(perCase.map(x=>[x.caseId,x]));
}
const comparison={bothAllowed:[],onlyAAllowed:[],onlyBAllowed:[],bothBlocked:[]};
for(const testCase of cases){const a=finalByArm.A.get(testCase.id),b=finalByArm.B.get(testCase.id);if(a.finalDelivery==='allowed'&&b.finalDelivery==='allowed')comparison.bothAllowed.push(testCase.id);else if(a.finalDelivery==='allowed')comparison.onlyAAllowed.push(testCase.id);else if(b.finalDelivery==='allowed')comparison.onlyBAllowed.push(testCase.id);else comparison.bothBlocked.push({caseId:testCase.id,aFailedConditions:Object.entries(a.conditions).filter(([,ok])=>!ok).map(([name])=>name),bFailedConditions:Object.entries(b.conditions).filter(([,ok])=>!ok).map(([name])=>name)});}
report.comparison=comparison;report.totalTokens=report.results.reduce((sum,x)=>sum+x.tokens.total_tokens,0);report.ledgerHashes={lock:sha(await readFile(lockPath)),attempts:sha(await readFile(attemptsPath)),outcomes:sha(await readFile(outcomesPath))};
await writeFile(finalReportPath,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
await writeFile(completionPath,JSON.stringify({experimentId:plan.experimentId,completedAt:report.finishedAt,attemptedRequests:finalAttemptedKeys.size,report:'ab-real-v17-r4-final.json',reportSha256:sha(await readFile(finalReportPath)),secondRunAuthorized:false},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({report:finalReportPath,totalAttemptedRequests:finalAttemptedKeys.size,totalTokens:report.totalTokens,results:report.results.map(x=>({arm:x.arm,model:x.model,raw:x.rawV210,finalExactIntersection:x.finalExactIntersection,providerErrors:x.providerErrors.length})),comparison:report.comparison}));
