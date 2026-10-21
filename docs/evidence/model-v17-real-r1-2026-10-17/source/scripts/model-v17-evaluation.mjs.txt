import assert from 'node:assert/strict';
import {appendFile,mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parseEnv} from 'node:util';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {providerAnswer,promptSnapshot,responseModeV8} from '../dist/src/provider.js';
import {evaluateControlledV17} from '../dist/src/controlled-evaluation-v17.js';
import {checkExplanationV2} from '../dist/src/output-guard-v2.js';
import {decisionForQuestionV1} from '../dist/src/returns-decision-v1.js';
import {compileResponseContractV17} from '../dist/src/response-contract-v17.js';
import {evaluate,suiteSchema} from '../dist/src/domain.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const dir=resolve(root,'docs/evidence/model-v17-real-r1-2026-10-17');
const planFile=resolve(dir,'plan.json');
const offlineFile=resolve(root,'docs/evidence/model-v17-checker-r1-2026-10-17/offline-verification-r1.json');
const sourcePlanFile=resolve(root,'docs/evidence/model-v16-2026-10-16/plan.json');
const sha=value=>createHash('sha256').update(value).digest('hex');
const sourceFiles=[
 'src/response-contract-v17.ts','src/response-contract-guard-v17.ts','src/controlled-evaluation-v17.ts','src/provider.ts','src/domain.ts','src/support.ts','src/worker.ts',
 'src/returns-decision-v1.ts','src/output-guard-v2.ts','src/returns-policy.ts','src/returns-policy-v27.ts','src/returns-policy-v28.ts','src/returns-policy-v29.ts','src/returns-policy-v30.ts',
 'dist/src/response-contract-v17.js','dist/src/response-contract-guard-v17.js','dist/src/controlled-evaluation-v17.js','dist/src/provider.js','dist/src/domain.js','dist/src/support.js','dist/src/worker.js',
 'dist/src/returns-decision-v1.js','dist/src/output-guard-v2.js','dist/src/returns-policy.js','dist/src/returns-policy-v27.js','dist/src/returns-policy-v28.js','dist/src/returns-policy-v29.js','dist/src/returns-policy-v30.js',
 'scripts/model-v17-evaluation.mjs'
];
const action=process.argv[2];
const offlineRaw=await readFile(offlineFile),offline=JSON.parse(offlineRaw);
assert.equal(offline.status,'READY_FOR_REAL_EVALUATION');assert.equal(offline.tests.failed,0);assert.equal(offline.tests.passed,offline.tests.total);assert.equal(offline.providerCalls,0);assert.equal(offline.realModelCalls,0);

const independentOldGuard=(cases,calls)=>{const records=cases.map(testCase=>{const output=calls.find(x=>x.caseId===testCase.id),validation=checkExplanationV2(output?.output,decisionForQuestionV1(testCase.prompt),responseModeV8(testCase.prompt),output?.error);return {caseId:testCase.id,validation};});return {version:'explanation-guard-v2',allowed:records.filter(x=>x.validation.passed).length,blocked:records.filter(x=>!x.validation.passed).length,records};};
const combineScoreAndOldGuard=(raw,guard,cases)=>{const rawPassed=new Set(raw.results.filter(x=>x.status==='passed').map(x=>x.caseId)),guardPassed=new Set(guard.records.filter(x=>x.validation.passed).map(x=>x.caseId)),allowed=cases.filter(x=>rawPassed.has(x.id)&&guardPassed.has(x.id)).map(x=>x.id);return {allowed:allowed.length,blocked:cases.length-allowed.length,allowedCases:allowed,blockedCases:cases.filter(x=>!allowed.includes(x.id)).map(x=>x.id)};};

await mkdir(dir,{recursive:true});
if(action==='freeze'){
 const sourcePlanRaw=await readFile(sourcePlanFile),sourcePlan=JSON.parse(sourcePlanRaw);
 const suites=sourcePlan.suites.map(s=>({...s,cases:s.cases.map(c=>({...c,rule:'returns_policy_v2_10'}))}));
 assert.equal(suites.flatMap(s=>s.cases).length,20);for(const {group,...suite} of suites)suiteSchema.parse(suite);
 const sources={};for(const file of sourceFiles){const bytes=await readFile(resolve(root,file));sources[file]=sha(bytes);const snapshot=resolve(dir,'source',file+'.txt');await mkdir(resolve(snapshot,'..'),{recursive:true});await writeFile(snapshot,bytes,{flag:'wx'});}
 const contracts=suites.flatMap(s=>s.cases).map(testCase=>{const decision=decisionForQuestionV1(testCase.prompt),responseMode=responseModeV8(testCase.prompt),contract=compileResponseContractV17(testCase.prompt,decision,responseMode);assert.equal(contract.compilationStatus,'ready');return {caseId:testCase.id,questionSha256:sha(testCase.prompt),decision,responseMode,contract};});
 const plan={revision:'v17-checker-r1',offlineVerificationSha256:sha(offlineRaw),frozenAt:new Date().toISOString(),model:sourcePlan.model,providerOrigin:sourcePlan.providerOrigin,evaluatorVersion:'returns-policy-v2.10',promptSnapshot:promptSnapshot('v17'),sourcePlanSha256:sha(sourcePlanRaw),questionOrder:suites.flatMap(s=>s.cases).map(c=>c.id),contracts,maxRequests:20,minimumStartIntervalMs:sourcePlan.minimumStartIntervalMs,automaticRetries:0,policy:sourcePlan.policy,sources,suites,configuration:{temperature:0.2,reasoningEffort:'low',maxOutputTokens:3072,requestTimeoutMs:20000},limitations:['Same 20 development regression cases, not a held-out benchmark.','Exactly one response per case; no retries or stability claim.','Bounded English contract checker, not complete semantic proof.','No deployment, publication, or Git push.'],environment:'Local provider adapter calling Groq Free plan; no cloud rollout, hosted CI, synthetic substitution, or answer repair.'};
 assert.deepEqual(plan.questionOrder,sourcePlan.suites.flatMap(s=>s.cases).map(c=>c.id));assert.equal(plan.policy.minScore,95);assert.equal(plan.minimumStartIntervalMs,20000);
 await writeFile(planFile,JSON.stringify(plan,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({frozen:planFile,planSha256:sha(await readFile(planFile)),callsMade:0,questions:plan.questionOrder,model:plan.model,promptSha256:plan.promptSnapshot.sha256,checkerSha256:plan.sources['src/response-contract-guard-v17.ts']}));
}else if(action==='run'){
 if(process.env.RG_CONFIRM_REAL_CALLS!=='20'||process.env.RG_CONFIRMED_FREE_PLAN!=='true')throw Error('Explicit 20-call authorization and current Free plan check required');
 if(!process.argv[3])throw Error('Supply existing local provider env file path, never a key');
 const planRaw=await readFile(planFile),plan=JSON.parse(planRaw);assert.equal(plan.offlineVerificationSha256,sha(offlineRaw));assert.equal(plan.maxRequests,20);assert.equal(plan.policy.minScore,95);assert.equal(plan.automaticRetries,0);assert.deepEqual(promptSnapshot('v17'),plan.promptSnapshot);
 for(const file of sourceFiles)assert.equal(sha(await readFile(resolve(root,file))),plan.sources[file],'Frozen source changed: '+file);
 const saved=parseEnv(await readFile(resolve(process.argv[3]),'utf8'));if(!saved.MODEL_API_KEY)throw Error('Saved provider key missing');
 await writeFile(resolve(dir,'invocation.lock'),JSON.stringify({startedAt:new Date().toISOString(),revision:plan.revision,maxCalls:20,automaticRetries:0})+'\n',{flag:'wx'});
 const stamp=new Date().toISOString().replaceAll(':','-'),runFile=resolve(dir,'real-v17-'+stamp+'.json'),journal=runFile.replace(/\.json$/,'.jsonl');
 const report={startedAt:new Date().toISOString(),source:'real',revision:plan.revision,environment:plan.environment,providerOrigin:plan.providerOrigin,model:plan.model,promptSnapshot:plan.promptSnapshot,evaluatorVersion:plan.evaluatorVersion,planSha256:sha(planRaw),sources:plan.sources,questionOrder:plan.questionOrder,minimumStartIntervalMs:plan.minimumStartIntervalMs,automaticRetries:0,freePlanVerifiedAtInvocation:true,humanReview:{status:'PENDING',reviewer:null},limitations:plan.limitations,calls:[],results:[]};
 await writeFile(journal,JSON.stringify({event:'started',...report})+'\n',{flag:'wx'});
 let nextStart=0;
 for(const suite of plan.suites){for(const testCase of suite.cases){if(Date.now()<nextStart)await delay(nextStart-Date.now());nextStart=Date.now()+plan.minimumStartIntervalMs;const startedAt=new Date().toISOString(),start=performance.now();let answer;try{answer=await providerAnswer({url:'https://api.groq.com/openai/v1/chat/completions',key:saved.MODEL_API_KEY,model:plan.model},'v17',testCase.prompt);}catch(error){answer={error:/Provider HTTP \d{3}/.exec(String(error))?.[0]??'Provider request failed or timed out; no automatic retry'};}const call={group:suite.group,caseId:testCase.id,prompt:testCase.prompt,startedAt,latencyMs:performance.now()-start,...answer};report.calls.push(call);await appendFile(journal,JSON.stringify({event:'provider-response',...call})+'\n');console.log(JSON.stringify({call:report.calls.length,caseId:testCase.id,httpStatus:answer.metadata?.httpStatus,finishReason:answer.metadata?.finishReason,error:answer.error??null}));}report.results.push({group:suite.group,...evaluate(suite.cases,plan.policy,report.calls.filter(x=>x.group===suite.group))});}
 const cases=plan.suites.flatMap(s=>s.cases);report.finishedAt=new Date().toISOString();report.totalCalls=report.calls.length;assert.equal(report.totalCalls,20);report.overall=evaluate(cases,plan.policy,report.calls);report.independentOldGuard=independentOldGuard(cases,report.calls);report.rawPlusOldGuard=combineScoreAndOldGuard(report.overall,report.independentOldGuard,cases);report.controlled=evaluateControlledV17(cases,plan.policy,report.calls);assert.deepEqual(report.controlled.rawModelEvaluation,report.overall);report.totalTokens=report.calls.reduce((sum,c)=>sum+(c.metadata?.usage?.total_tokens??0),0);report.providerFailures=report.calls.filter(c=>c.error).map(c=>({caseId:c.caseId,error:c.error}));report.fixed20Verified=report.overall.gate==='passed'&&report.controlled.result.finalDeliveryStatus==='allowed'&&report.controlled.result.deliveryValidation.allowed===20&&report.providerFailures.length===0;report.finalStatus=report.fixed20Verified?'FIXED_20_CASES_VERIFIED':'REAL_EVALUATION_COMPLETED_WITH_FAILURES';report.journalSha256=sha(await readFile(journal));await writeFile(runFile,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({report:runFile,calls:report.totalCalls,tokens:report.totalTokens,rawScore:report.overall.score,rawGate:report.overall.gate,oldGuard:{allowed:report.independentOldGuard.allowed,blocked:report.independentOldGuard.blocked},rawPlusOldGuard:report.rawPlusOldGuard,v17Delivery:report.controlled.result.deliveryValidation,finalDeliveryStatus:report.controlled.result.finalDeliveryStatus,finalStatus:report.finalStatus,providerFailures:report.providerFailures}));
}else throw Error('Use freeze or run');
