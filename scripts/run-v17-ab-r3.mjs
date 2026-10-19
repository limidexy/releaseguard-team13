import assert from 'node:assert/strict';
import {appendFile,mkdir,readFile,writeFile} from 'node:fs/promises';
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
const evidenceDir=resolve(root,'docs/evidence/model-v17-credibility-r3-2026-10-17');
const planPath=resolve(evidenceDir,'ab-plan-v17-r3.json');
const sha=value=>createHash('sha256').update(value).digest('hex');
const stableSha=value=>sha(JSON.stringify(value));

if(process.env.RG_CONFIRM_AB_CALLS!=='40')throw Error('Not authorized: set RG_CONFIRM_AB_CALLS=40 only after explicit approval of the frozen 40-call A/B experiment.');
if(process.env.RG_CONFIRMED_FREE_PLAN!=='true')throw Error('Refresh the provider Free-plan state before execution; paid upgrade is not authorized.');
if(!process.argv[2])throw Error('Supply the existing local provider env-file path, never an API key.');

const plan=JSON.parse(await readFile(planPath,'utf8'));
assert.equal(plan.totalBudgetedCalls,40);assert.equal(plan.automaticRetries,0);assert.equal(plan.authorization.paidUpgradeAllowed,false);assert.equal(plan.authorization.providerSwitchAllowed,false);
const sourcePlanRaw=await readFile(resolve(root,plan.sourceQuestionPlan));assert.equal(sha(sourcePlanRaw),plan.sourceQuestionPlanSha256);
const sourcePlan=JSON.parse(sourcePlanRaw),cases=sourcePlan.suites.flatMap(s=>s.cases);
assert.deepEqual(cases.map(c=>c.id),plan.questionOrder);assert.equal(cases.length,20);
const sourcePaths=['src/generation-view-v17.ts','src/response-contract-v17.ts','src/response-contract-guard-v17.ts','src/controlled-evaluation-v17.ts','src/returns-decision-v1.ts','src/domain.ts','src/output-guard-v2.ts','scripts/run-v17-ab-r3.mjs'];
for(const path of sourcePaths)assert.equal(sha(await readFile(resolve(root,path))),plan.frozenHashes[path],`Frozen source changed: ${path}`);
assert.equal(sha(await readFile(resolve(evidenceDir,'semantic-audit-v17-r3.json'))),plan.frozenHashes['semantic-audit-v17-r3.json']);
assert.equal(sha(generationPromptV17R3),plan.frozenHashes.generationPrompt);assert.equal(stableSha(responseModesV14),plan.frozenHashes.responseModes);
const frozenCases=cases.map(testCase=>{const decision=decisionForQuestionV1(testCase.prompt),responseMode=responseModeV8(testCase.prompt),contract=compileResponseContractV17(testCase.prompt,decision,responseMode),view=compileGenerationViewV17R3(decision,contract);assert.equal(contract.compilationStatus,'ready');return {caseId:testCase.id,questionSha256:sha(testCase.prompt),contractSha256:stableSha(contract),generationViewSha256:stableSha(view)};});
assert.equal(stableSha(frozenCases),plan.frozenHashes.compiledCaseContractAndViewSet);

const saved=parseEnv(await readFile(resolve(process.argv[2]),'utf8'));if(!saved.MODEL_API_KEY)throw Error('Saved provider key missing');
const modelResponse=await fetch('https://api.groq.com/openai/v1/models',{headers:{authorization:'Bearer '+saved.MODEL_API_KEY},redirect:'error',signal:AbortSignal.timeout(15000)});
if(!modelResponse.ok)throw Error('Provider account preflight failed with HTTP '+modelResponse.status);
const modelBody=await boundedJson(modelResponse),listed=new Set((modelBody?.data??[]).filter(x=>x?.active!==false).map(x=>x.id));for(const arm of plan.arms)if(!listed.has(arm.model))throw Error('Frozen model is unavailable: '+arm.model);

const callOnce=async(model,testCase)=>{
 const decision=decisionForQuestionV1(testCase.prompt),responseMode=responseModeV8(testCase.prompt),contract=compileResponseContractV17(testCase.prompt,decision,responseMode),viewContext=generationViewContextV17R3(decision,contract);
 const systemText=generationPromptV17R3+'\n\n'+viewContext.text+'\n\n'+responseModesV14[responseMode];
 const startedAt=new Date().toISOString(),start=performance.now();
 try{
  const response=await fetch(plan.providerEndpoint,{method:'POST',headers:{authorization:'Bearer '+saved.MODEL_API_KEY,'content-type':'application/json'},redirect:'error',signal:AbortSignal.timeout(plan.configuration.requestTimeoutMs),body:JSON.stringify({model,messages:[{role:'system',content:systemText},{role:'user',content:testCase.prompt}],temperature:plan.configuration.temperature,reasoning_effort:plan.configuration.reasoningEffort,max_completion_tokens:plan.configuration.maxOutputTokens})});
  if(!response.ok){await response.body?.cancel();return {startedAt,latencyMs:performance.now()-start,error:'Provider HTTP '+response.status,metadata:{httpStatus:response.status,finishReason:null,usage:{}}};}
  const body=await boundedJson(response),output=body?.choices?.[0]?.message?.content,finishReason=typeof body?.choices?.[0]?.finish_reason==='string'?body.choices[0].finish_reason:null,usage={};for(const field of ['prompt_tokens','completion_tokens','total_tokens'])if(Number.isSafeInteger(body?.usage?.[field])&&body.usage[field]>=0)usage[field]=body.usage[field];
  const error=finishReason==='length'?'Provider answer truncated at token limit':typeof output!=='string'||!output.trim()?'Provider returned no text':finishReason!=='stop'?'Provider finish reason '+finishReason:undefined;
  return {startedAt,latencyMs:performance.now()-start,...(typeof output==='string'?{output}:{}),...(error?{error}:{}),metadata:{httpStatus:response.status,finishReason,usage,responseMode,systemPromptSha256:sha(systemText),contractSha256:stableSha(contract),generationViewSha256:stableSha(viewContext.view),oldGuard:checkExplanationV2(output,decision,responseMode,error),contractGuard:checkResponseContractV17(output,contract,decision,error)}};
 }catch(error){return {startedAt,latencyMs:performance.now()-start,error:'Provider request failed or timed out; no retry',metadata:{httpStatus:null,finishReason:null,usage:{},failureClass:error?.name??'Error'}};}
};

await mkdir(evidenceDir,{recursive:true});
const stamp=new Date().toISOString().replaceAll(':','-'),journalPath=resolve(evidenceDir,'ab-real-'+stamp+'.jsonl'),reportPath=resolve(evidenceDir,'ab-real-'+stamp+'.json');
const report={revision:plan.revision,startedAt:new Date().toISOString(),planSha256:sha(await readFile(planPath)),source:'real',automaticRetries:0,totalBudgetedCalls:40,questionOrder:plan.questionOrder,arms:plan.arms,configuration:plan.configuration,calls:[]};
await writeFile(journalPath,JSON.stringify({event:'started',...report})+'\n',{flag:'wx'});
let nextStart=0;
for(const testCase of cases)for(const arm of plan.arms){if(Date.now()<nextStart)await delay(nextStart-Date.now());nextStart=Date.now()+plan.configuration.minimumStartIntervalMs;const result=await callOnce(arm.model,testCase),call={arm:arm.arm,model:arm.model,caseId:testCase.id,prompt:testCase.prompt,...result};report.calls.push(call);await appendFile(journalPath,JSON.stringify({event:'provider-response',...call})+'\n');console.log(JSON.stringify({call:report.calls.length,arm:arm.arm,caseId:testCase.id,httpStatus:call.metadata.httpStatus,finishReason:call.metadata.finishReason,error:call.error??null}));}
assert.equal(report.calls.length,40);assert.equal(new Set(report.calls.map(x=>x.arm+':'+x.caseId)).size,40);
report.finishedAt=new Date().toISOString();report.results=plan.arms.map(arm=>{const calls=report.calls.filter(x=>x.arm===arm.arm),raw=evaluate(cases,{minScore:95,maxLatencyMs:null},calls),contractAllowed=calls.filter(x=>x.metadata?.contractGuard?.finalDeliveryStatus==='allowed'&&!x.error).length,oldAllowed=calls.filter(x=>x.metadata?.oldGuard?.passed&&!x.error).length;return {arm:arm.arm,model:arm.model,raw,oldGuard:{allowed:oldAllowed,blocked:20-oldAllowed},contractGuard:{allowed:contractAllowed,blocked:20-contractAllowed},providerFailures:calls.filter(x=>x.error).map(x=>({caseId:x.caseId,error:x.error}))};});
report.totalTokens=report.calls.reduce((sum,x)=>sum+(x.metadata?.usage?.total_tokens??0),0);report.journalSha256=sha(await readFile(journalPath));report.limitations=plan.limitations;
await writeFile(reportPath,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({report:reportPath,totalCalls:40,results:report.results.map(x=>({arm:x.arm,model:x.model,score:x.raw.score,rawGate:x.raw.gate,oldGuard:x.oldGuard,contractGuard:x.contractGuard,providerFailures:x.providerFailures.length}))}));
