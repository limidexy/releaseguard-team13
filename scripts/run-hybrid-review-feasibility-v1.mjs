import {appendFile,mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {decisionForQuestionV1} from '../dist/src/returns-decision-v1.js';
import {compileResponseContractV17} from '../dist/src/response-contract-v17.js';
import {responseModeV8} from '../dist/src/provider.js';
import {aggregateHybridEvaluationV1,buildSemanticReviewInputV1,runDeterministicChecksV1,validateSemanticReviewV1} from '../dist/src/hybrid-evaluation-v1.js';
import {FileSemanticReviewStoreV1,buildModelReviewRequestV1,runModelSemanticReviewV1} from '../dist/src/semantic-review-sources-v1.js';
import {buildGroqSemanticReviewHttpBodyV1,createGroqSemanticReviewTransportV1} from '../dist/src/groq-semantic-review-transport-v1.js';

const evidenceDir='docs/evidence/hybrid-review-feasibility-v1-2026-10-17';
const sha=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>value===null?'null':Array.isArray(value)?'['+value.map(canonical).join(',')+']':typeof value==='object'?'{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>JSON.stringify(key)+':'+canonical(item)).join(',')+'}':JSON.stringify(value);
const objectSha=value=>sha(canonical(value));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const hashFile=async path=>sha(await readFile(path));
function parseEnv(text){const result={};for(const raw of text.split(/\r?\n/)){const line=raw.trim();if(!line||line.startsWith('#'))continue;const index=line.indexOf('=');if(index<1)continue;result[line.slice(0,index).trim()]=line.slice(index+1).trim().replace(/^['"]|['"]$/g,'');}return result;}
async function loadKey(){for(const path of ['.env.groq','/Users/ASUS/Desktop/nus- learning/ReleaseGuard_Team13/.env.groq','.env']){try{const value=parseEnv(await readFile(path,'utf8')).MODEL_API_KEY;if(value)return value;}catch(error){if(error?.code!=='ENOENT')throw error;}}throw new Error('Groq key unavailable in approved local sources');}
function invalidValidation(status,error){return {version:'semantic-review-validation-v1',status:'failed',reviewerValidationStatus:'source_unverified',errors:[`${status}: ${error??'review unavailable'}`],review:null};}
function outcome(expected,predicted){if(expected&&predicted)return'true_allow';if(expected&&!predicted)return'false_block';if(!expected&&predicted)return'false_allow';return'true_block';}

await mkdir(evidenceDir,{recursive:true});
const [plan,selection,authorization,freePlan,manifest,sourceFixtures,sourcePlan]=await Promise.all([
 json(join(evidenceDir,'EXPERIMENT-PLAN.json')),json(join(evidenceDir,'FROZEN-SAMPLE-SELECTION.json')),json(join(evidenceDir,'AUTHORIZATION.json')),json(join(evidenceDir,'FREE-PLAN-CHECK.json')),json(join(evidenceDir,'FREEZE-MANIFEST.json')),json('tests/evaluator-next-v1-holdout-v2-fixtures.json'),json('docs/evidence/model-v17-real-r1-2026-10-17/plan.json'),
]);
if(plan.status!=='AUTHORIZED_FROZEN_NOT_STARTED'||plan.maximumRequests!==20||plan.customerGenerationRequests!==0||plan.paidCallsAllowed!==false)throw new Error('Frozen experiment scope is invalid');
if(!authorization.approved||authorization.experimentId!==plan.experimentId||authorization.allowedModelId!==plan.modelId||authorization.maximumSemanticReviewRequests!==20||authorization.allowPaidCalls!==false||authorization.allowAutomaticRetry!==false||authorization.allowProviderSwitch!==false)throw new Error('Explicit authorization does not match frozen experiment');
if(freePlan.plan!=='Free'||freePlan.displayedPrice!=='$0'||freePlan.currentPlan!==true||freePlan.paymentOrUpgradeActionTaken!==false)throw new Error('Verified Free Current Plan evidence is required');
if(Date.now()-Date.parse(freePlan.observedAt)>6*60*60*1000)throw new Error('Free-plan evidence is stale; repeat read-only verification');
if(selection.selected.length!==20||selection.selected.filter(x=>x.expectedAllowed).length!==10||selection.selected.filter(x=>!x.expectedAllowed).length!==10)throw new Error('Frozen sample balance must be 10 correct and 10 violating');
for(const item of manifest.files){if(await hashFile(item.path)!==item.sha256)throw new Error('Freeze hash mismatch: '+item.path);}
if(await hashFile(selection.sourceFixturePath)!==selection.sourceFixtureSha256||await hashFile(selection.sourceQuestionPlanPath)!==selection.sourceQuestionPlanSha256)throw new Error('Frozen source hash mismatch');

const fixtures=new Map(sourceFixtures.fixtures.map(item=>[item.fixtureId,item]));
const questions=new Map(sourcePlan.suites.flatMap(suite=>suite.cases).map(item=>[item.id,item.prompt]));
const key=await loadKey();
const modelResponse=await fetch('https://api.groq.com/openai/v1/models',{headers:{authorization:'Bearer '+key},redirect:'error',signal:AbortSignal.timeout(15000)});
if(!modelResponse.ok){await modelResponse.body?.cancel();throw new Error('Groq model preflight HTTP '+modelResponse.status);}
const modelBody=await modelResponse.json(),available=Array.isArray(modelBody?.data)&&modelBody.data.some(item=>item?.id===plan.modelId);
if(!available)throw new Error('Frozen reviewer model is unavailable to the current project');
const preflight={version:'groq-reviewer-preflight-v1',checkedAt:new Date().toISOString(),endpoint:'https://api.groq.com/openai/v1/models',httpStatus:modelResponse.status,modelId:plan.modelId,available,freePlanEvidenceSha256:await hashFile(join(evidenceDir,'FREE-PLAN-CHECK.json'))};
await writeFile(join(evidenceDir,'MODEL-PREFLIGHT.json'),JSON.stringify(preflight,null,2)+'\n',{flag:'wx'});

const lock={version:'hybrid-review-experiment-lock-v1',experimentId:plan.experimentId,startedAt:new Date().toISOString(),planSha256:await hashFile(join(evidenceDir,'EXPERIMENT-PLAN.json')),selectionSha256:await hashFile(join(evidenceDir,'FROZEN-SAMPLE-SELECTION.json')),authorizationSha256:await hashFile(join(evidenceDir,'AUTHORIZATION.json')),maximumRequests:20,automaticRetries:0};
await writeFile(join(evidenceDir,'EXPERIMENT.lock.json'),JSON.stringify(lock,null,2)+'\n',{flag:'wx'});
const store=new FileSemanticReviewStoreV1(join(evidenceDir,'review-store'));
const transportConfig={apiKey:key,modelId:plan.modelId,endpoint:plan.providerEndpoint,temperature:plan.temperature,maxOutputTokens:plan.maxOutputTokens,reasoningEffort:plan.reasoningEffort,requestTimeoutMs:plan.requestTimeoutMs};
const transport=createGroqSemanticReviewTransportV1(transportConfig);
const modelConfig={judgeEnabled:true,experimentId:plan.experimentId,modelId:plan.modelId,providerId:'groq-free',temperature:plan.temperature,maxOutputTokens:plan.maxOutputTokens,requestTimeoutMs:plan.requestTimeoutMs,authorization:{authorizationId:authorization.authorizationId,experimentId:plan.experimentId,approved:true,authorizedAt:authorization.recordedAt,expiresAt:new Date(Date.parse(authorization.recordedAt)+24*60*60*1000).toISOString(),maximumRequests:20,allowedModelId:plan.modelId,allowPaidCalls:false,allowProviderSwitch:false,allowAutomaticRetry:false}};
const results=[];let nextStart=0;
for(const selected of selection.selected){
 if(Date.now()<nextStart)await sleep(nextStart-Date.now());nextStart=Date.now()+plan.minimumStartIntervalMs;
 const fixture=fixtures.get(selected.fixtureId);if(!fixture)throw new Error('Missing frozen fixture '+selected.fixtureId);const question=questions.get(fixture.caseId);if(!question)throw new Error('Missing frozen question '+fixture.caseId);
 if(fixture.expectedAllowed!==selected.expectedAllowed)throw new Error('Local reference label mismatch '+selected.fixtureId);
 const responseMode=responseModeV8(question);if(responseMode!==fixture.responseMode)throw new Error('Response-mode mismatch '+selected.fixtureId);
 const decision=decisionForQuestionV1(question),contract=compileResponseContractV17(question,decision,responseMode),envelope={caseId:fixture.caseId,runId:plan.experimentId,responseId:selected.fixtureId,question,originalResponse:fixture.response,responseComplete:true,responseMode,policy:{version:'returns-policy-course-v1',text:'Standard returns require an unused item within 30 days of purchase with a receipt. Missing facts remain unknown. Damage, disputes, requested actions and standard-ineligible cases require human review. The assistant cannot issue refunds, change decisions, contact people, forward requests, open tickets or invent channels, timelines, remedies, receipt collection, secret requests or data-handling practices.'},facts:{version:'returns-facts-v1',sourceId:'question-parser-v1',value:decision.facts},decision,contract};
 const input=buildSemanticReviewInputV1(envelope),deterministic=runDeterministicChecksV1(envelope,input);if(deterministic.status!=='passed')throw new Error('Frozen sample deterministic precheck failed '+selected.fixtureId);
 const providerRequest=buildGroqSemanticReviewHttpBodyV1(buildModelReviewRequestV1(input),transportConfig),providerRequestText=JSON.stringify(providerRequest);
 if(providerRequestText.includes('expectedAllowed')||providerRequestText.includes('expectedRuleFamilies')||providerRequestText.includes('annotationRationale'))throw new Error('Reference label leaked into provider request');
 await writeFile(join(evidenceDir,`request-${String(selected.sequence).padStart(2,'0')}-${selected.fixtureId}.json`),JSON.stringify({sequence:selected.sequence,fixtureId:selected.fixtureId,providerRequestSha256:sha(providerRequestText),providerRequest},null,2)+'\n',{flag:'wx'});
 const startedAt=new Date().toISOString(),run=await runModelSemanticReviewV1(modelConfig,input,store,transport),validation=run.review?validateSemanticReviewV1(run.review,input):invalidValidation(run.status,run.error),aggregate=aggregateHybridEvaluationV1(envelope,deterministic,validation),predictedAllowed=deterministic.status==='passed'&&validation.status==='passed'&&aggregate.candidatePolicyCompliance==='passed',classification=outcome(selected.expectedAllowed,predictedAllowed);
 const failedRuleIds=run.review?.ruleResults.filter(item=>item.status==='failed').map(item=>item.ruleId)??[],unverifiableRuleIds=run.review?.ruleResults.filter(item=>item.status==='unverifiable').map(item=>item.ruleId)??[],reasonMatches=selected.expectedRuleFamilies.map(ruleId=>({ruleId,matched:failedRuleIds.includes(ruleId)}));
 const record={sequence:selected.sequence,fixtureId:selected.fixtureId,caseId:fixture.caseId,question,originalResponse:fixture.response,reference:{sourceType:'project_reference_annotation',expectedAllowed:selected.expectedAllowed,expectedRuleFamilies:selected.expectedRuleFamilies,rationale:fixture.annotationRationale},request:{reviewInputSha256:objectSha(input),providerRequestSha256:sha(providerRequestText),labelsSent:false},run,deterministic,validation,aggregate,diagnostic:{predictedAllowed,classification,failedRuleIds,unverifiableRuleIds,reasonMatches},completedAt:new Date().toISOString()};
 results.push(record);await writeFile(join(evidenceDir,`result-${String(selected.sequence).padStart(2,'0')}-${selected.fixtureId}.json`),JSON.stringify(record,null,2)+'\n',{flag:'wx'});await appendFile(join(evidenceDir,'RUN.journal.jsonl'),JSON.stringify({event:'review-completed',sequence:selected.sequence,fixtureId:selected.fixtureId,status:run.status,requestsSent:run.requestsSent,classification,requestId:run.review?.sourceMetadata?.requestId??null,reportedModel:run.review?.sourceMetadata?.reportedModel??null,finishReason:run.review?.sourceMetadata?.finishReason??null,usage:run.review?.sourceMetadata?.usage??{},at:record.completedAt})+'\n');
 console.log(JSON.stringify({progress:`${selected.sequence}/20`,fixtureId:selected.fixtureId,status:run.status,classification,failedRuleIds,providerRequestId:run.review?.sourceMetadata?.requestId??null}));
}
const count=name=>results.filter(item=>item.diagnostic.classification===name).length,totalRequests=results.reduce((sum,item)=>sum+item.run.requestsSent,0),providerErrors=results.filter(item=>item.run.status!=='completed'),invalidReviews=results.filter(item=>item.validation.status!=='passed'),reasonExpected=results.reduce((sum,item)=>sum+item.reference.expectedRuleFamilies.length,0),reasonMatched=results.flatMap(item=>item.diagnostic.reasonMatches).filter(item=>item.matched).length;
const summary={version:'hybrid-review-feasibility-result-v1',experimentId:plan.experimentId,startedAt:lock.startedAt,finishedAt:new Date().toISOString(),status:'FEASIBILITY_DIAGNOSTIC_COMPLETED',scope:{fixedDenominator:20,correctReferences:10,violatingReferences:10,modelId:plan.modelId,provider:'Groq Free',customerGenerationRequests:0,semanticReviewRequests:totalRequests,automaticRetries:0},metrics:{trueAllow:count('true_allow'),falseBlock:count('false_block'),trueBlock:count('true_block'),falseAllow:count('false_allow'),decisionAgreement:(count('true_allow')+count('true_block'))/20,correctReferenceAllowRate:count('true_allow')/10,violationBlockRate:count('true_block')/10,reasonAgreement:reasonExpected?reasonMatched/reasonExpected:null,reasonExpected,reasonMatched,providerOrProtocolFailures:providerErrors.length,invalidReviews:invalidReviews.length},formalDelivery:{activated:false,reviewerQualification:'calibration_pending',historicalScoresChanged:false},results};
await writeFile(join(evidenceDir,'FINAL-RESULT.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
const lines=[
 '# Hybrid semantic reviewer feasibility diagnostic','',
 'Status: `FEASIBILITY_DIAGNOSTIC_COMPLETED`','',
 'This is a 20-sample project-reference diagnostic, not a hidden-set certification or production approval.','',
 '## Metrics','',
 `- Correct references allowed: **${summary.metrics.trueAllow}/10**`,
 `- Correct references incorrectly blocked: **${summary.metrics.falseBlock}/10**`,
 `- Violations blocked: **${summary.metrics.trueBlock}/10**`,
 `- Violations incorrectly allowed: **${summary.metrics.falseAllow}/10**`,
 `- Overall decision agreement: **${Math.round(summary.metrics.decisionAgreement*10000)/100}%**`,
 `- Expected failure reasons matched: **${reasonMatched}/${reasonExpected}**`,
 `- Provider/protocol failures: **${summary.metrics.providerOrProtocolFailures}**`,
 `- Invalid review payloads: **${summary.metrics.invalidReviews}**`,'',
 '## Controls','',
 `- Semantic-review requests: **${totalRequests}/20**`,
 '- Customer-generation requests: **0**',
 '- Automatic retries: **0**',
 '- Model: `'+plan.modelId+'`',
 '- Formal delivery activated: **no**',
 '- Historical scores changed: **no**','',
 '## Per sample','',
 '| # | Fixture | Reference | Reviewer | Classification | Failed rules |',
 '|---:|---|---|---|---|---|',
 ...results.map(item=>`| ${item.sequence} | ${item.fixtureId} | ${item.reference.expectedAllowed?'allow':'block'} | ${item.diagnostic.predictedAllowed?'allow':'block'} | ${item.diagnostic.classification} | ${item.diagnostic.failedRuleIds.join(', ')||'—'} |`),'',
 'Raw provider-derived review records, request hashes, request IDs, usage and rate-limit headers are retained in the result files. Reference labels were applied locally after the request and were not included in provider messages.'
];
await writeFile(join(evidenceDir,'FINAL-RESULT.md'),lines.join('\n')+'\n',{flag:'wx'});
await writeFile(join(evidenceDir,'EXPERIMENT.complete.json'),JSON.stringify({experimentId:plan.experimentId,completedAt:summary.finishedAt,totalRequests,secondRunAuthorized:false,finalResultSha256:await hashFile(join(evidenceDir,'FINAL-RESULT.json'))},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({final:'FINAL-RESULT.json',metrics:summary.metrics,totalRequests}));
