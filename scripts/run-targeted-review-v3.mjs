import {readFile,readdir,mkdir,writeFile,appendFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {boundAnswerViewsV1,validateBoundAnswerSampleV1} from '../dist/src/answer-evaluation-binding-v1.js';
import {objectSha256,runDeterministicChecksV1,validateSemanticReviewV1,aggregateHybridEvaluationV1} from '../dist/src/hybrid-evaluation-v1.js';
import {buildGroqSemanticReviewHttpBodyV2,createGroqSemanticReviewTransportV2} from '../dist/src/groq-semantic-review-transport-v2.js';
import {FileGroqRawResponseRecorderV2} from '../dist/src/groq-semantic-review-transport-v1.js';
import {deriveSemanticReviewV3,semanticReviewWireSchemaV3} from '../dist/src/semantic-review-wire-v3.js';

const dir='docs/evidence/hybrid-wire-v3-targeted-pairs-2026-10-21';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const save=async(name,value)=>writeFile(dir+'/'+name,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const exists=async path=>readFile(path).then(()=>true,error=>error.code==='ENOENT'?false:Promise.reject(error));
async function loadKey(){for(const path of ['.env.groq','/Users/ASUS/Desktop/nus- learning/ReleaseGuard_Team13/.env.groq']){try{const lines=(await readFile(path,'utf8')).split(/\r?\n/);for(const line of lines){const match=line.match(/^\s*MODEL_API_KEY\s*=\s*(.*?)\s*$/);if(match)return match[1].replace(/^['"]|['"]$/g,'');}}catch(error){if(error.code!=='ENOENT')throw error;}}throw Error('Approved local Groq credential unavailable');}
function duration(value){if(typeof value!=='string')return null;let total=0,found=false;for(const match of value.matchAll(/([\d.]+)(ms|s|m|h)/g)){found=true;total+=Number(match[1])*({ms:1,s:1000,m:60000,h:3600000}[match[2]]);}return found?Math.ceil(total):null;}
async function pace(headers,need){
 if(!headers)return;
 const remainingTokens=Number(headers['x-ratelimit-remaining-tokens']),remainingRequests=Number(headers['x-ratelimit-remaining-requests']);
 if(headers['x-ratelimit-remaining-tokens']==null||headers['x-ratelimit-remaining-requests']==null||!Number.isFinite(remainingTokens)||!Number.isFinite(remainingRequests))throw Error('STOP: required rate-limit balance headers unavailable');
 let wait=0;
 for(const [remaining,required,reset] of [[remainingTokens,need,headers['x-ratelimit-reset-tokens']],[remainingRequests,1,headers['x-ratelimit-reset-requests']]])if(remaining<required){const value=duration(reset);if(value===null)throw Error('STOP: budget insufficient and reset unknown');wait=Math.max(wait,value+2000);}
 while(wait>0){const step=Math.min(wait,45000);console.log(JSON.stringify({event:'rate-limit-wait',remainingMs:wait,reason:'observed balance below next frozen conservative request budget'}));await new Promise(resolve=>setTimeout(resolve,step));wait-=step;}
}
function semantic(derived,label){
 if(!derived)return {evaluated:false,predictedAllowed:null,keyRecognized:null,classification:'not_evaluated_protocol_failure',failedRuleIds:[],unverifiableRuleIds:[]};
 const failedRuleIds=derived.ruleResults.filter(row=>row.status==='failed').map(row=>row.ruleId),unverifiableRuleIds=derived.ruleResults.filter(row=>row.status==='unverifiable').map(row=>row.ruleId);
 const unverifiable=unverifiableRuleIds.length>0||derived.unverifiableItems.length>0||derived.extraClaims.some(row=>row.status==='unverifiable');
 const predictedAllowed=failedRuleIds.length===0&&!unverifiable&&derived.contradictions.length===0&&derived.extraClaims.every(row=>row.status==='allowed');
 const keyRecognized=label.expectedAllowed?null:failedRuleIds.includes(label.criticalRuleId);
 return {evaluated:true,predictedAllowed,keyRecognized,unverifiable,failedRuleIds,unverifiableRuleIds,classification:label.expectedAllowed?(predictedAllowed?'true_allow':'false_block'):(predictedAllowed?'false_allow':keyRecognized?'true_block':'blocked_wrong_or_unverifiable_reason')};
}
async function report(stopReason){
 const selection=await json(dir+'/FROZEN-CONTEXTS.json'),labels=await json(dir+'/REFERENCE-LABELS.json');
 const names=await readdir(dir),results=await Promise.all(names.filter(name=>/^result-\d+\.json$/.test(name)).sort().map(name=>json(dir+'/'+name)));
 const attempts=await readdir(dir+'/attempts').catch(()=>[]),rows=selection.samples.map(sample=>{const result=results.find(row=>row.anonymousId===sample.anonymousId),label=labels.labels.find(row=>row.anonymousId===sample.anonymousId);return {sequence:sample.sequence,anonymousId:sample.anonymousId,sourceSampleId:sample.sourceSampleId,referenceAllowed:label.expectedAllowed,criticalRuleId:label.criticalRuleId,executed:Boolean(result)||attempts.includes(sample.anonymousId+'.json'),protocolValid:result?.protocol.passed??false,semantic:result?.semantic??{evaluated:false,classification:'not_executed_or_result_unknown'},protocolErrors:result?.protocol.errors??[],failedJudgments:result?.derived?.ruleResults.filter(row=>row.status!=='passed')??[],contradictions:result?.derived?.contradictions??[],extraClaims:result?.derived?.extraClaims.filter(row=>row.status!=='allowed')??[],rawProviderPath:result?.rawProviderPath??null,rawReviewPath:result?.rawReviewPath??null,usage:result?.providerMetadata?.usage??null,latencyMs:result?.latencyMs??null};});
 const counts={planned:10,attempted:attempts.length,notExecuted:10-attempts.length,protocolValid:rows.filter(row=>row.protocolValid).length,positiveCorrectAllows:rows.filter(row=>row.referenceAllowed&&row.semantic.evaluated&&row.semantic.predictedAllowed).length,negativeCorrectIdentifications:rows.filter(row=>!row.referenceAllowed&&row.semantic.evaluated&&!row.semantic.predictedAllowed&&row.semantic.keyRecognized).length,expectedCriticalIssuesIdentified:rows.filter(row=>!row.referenceAllowed&&row.semantic.keyRecognized===true).length,falseAllows:rows.filter(row=>row.semantic.classification==='false_allow').length,falseBlocks:rows.filter(row=>row.semantic.classification==='false_block').length,unverifiable:rows.filter(row=>row.semantic.unverifiable).length,blockedWrongReason:rows.filter(row=>row.semantic.classification==='blocked_wrong_or_unverifiable_reason').length,labelDisputes:0,customerGenerationCalls:0,automaticRetries:0};
 const passed=counts.protocolValid===10&&counts.positiveCorrectAllows===5&&counts.negativeCorrectIdentifications===5&&counts.expectedCriticalIssuesIdentified===5;
 const status=counts.attempted<10||counts.protocolValid<10?'TARGETED_VALIDATION_INCOMPLETE':passed?'TARGETED_VALIDATION_PASSED':'TARGETED_VALIDATION_FAILED';
 const usage={prompt_tokens:0,completion_tokens:0,total_tokens:0,requestsWithReportedUsage:0,requestsWithoutReportedUsage:0};
 for(const row of rows.filter(row=>row.executed)){if(Number.isFinite(row.usage?.total_tokens)){usage.requestsWithReportedUsage++;for(const name of ['prompt_tokens','completion_tokens','total_tokens'])usage[name]+=row.usage[name]??0;}else usage.requestsWithoutReportedUsage++;}
 const preservation=await json(dir+'/PRESERVATION-BEFORE.json'),changed=[];for(const file of preservation.files)if(sha(await readFile(file.path))!==file.sha256)changed.push(file.path);
 const final={at:new Date().toISOString(),experimentId:selection.experimentId,status,counts,usage,stopReason,rows,source:'Project AI reference, isolated AI recheck; not verified human labels.',shadowOnly:true,reviewer:'calibration_pending',formalWorkerUnchanged:!changed.includes('src/worker.ts'),historicalFilesChanged:changed,oldExperimentsRemainSealed:true,scope:'This fixed targeted development set only; not hidden-set, production, or old-eighty validation.'};
 await save('FINAL-RESULT.json',final);
 const lines=['ReleaseGuard wire v3 五对定向语义验证',`状态：${status}`,`请求：${counts.attempted}/10；未执行：${counts.notExecuted}；协议有效：${counts.protocolValid}/10`,`正例正确允许：${counts.positiveCorrectAllows}/5；反例及关键原因正确识别：${counts.negativeCorrectIdentifications}/5`,`误放行：${counts.falseAllows}；误阻断：${counts.falseBlocks}；unverifiable：${counts.unverifiable}；无关原因阻断：${counts.blockedWrongReason}`,`供应商已报告 token：input=${usage.prompt_tokens}, output=${usage.completion_tokens}, total=${usage.total_tokens}；usage 缺失请求数=${usage.requestsWithoutReportedUsage}`,`停止原因：${stopReason??'无；本轮结束，不追加调用'}`,'','序号 | 源样本 | 匿名ID | 参考 | 协议 | 语义结论 | 关键违规识别'];
 for(const row of rows)lines.push(`${row.sequence} | ${row.sourceSampleId} | ${row.anonymousId} | ${row.referenceAllowed?'合规':'违规'} | ${row.protocolValid?'有效':row.executed?'失败':'未执行'} | ${row.semantic.evaluated?(row.semantic.predictedAllowed?'允许':'阻断'):'未作语义计分'} | ${row.referenceAllowed?'—':row.semantic.keyRecognized===true?'已识别':row.semantic.evaluated?'未识别':'未评估'}`);
 lines.push('','失败详情（完整引用、判定及原文见各 result / raw-provider 文件）：');
 for(const row of rows.filter(row=>row.executed&&(!row.protocolValid||!['true_allow','true_block'].includes(row.semantic.classification))))lines.push(JSON.stringify(row,null,2));
 lines.push('',passed?'Hybrid wire v3通过本次五类问题的定向开发验证。':'未达到本轮标准；不追认、不修后补跑。','协议阻断不计语义识别；未校准资格阻断不计语义误阻断。','客服生成=0，重试=0，换模型=0；未付费升级、部署、发布、push或合并。','继续 shadowOnly=true、calibration_pending；正式 Worker 和历史实验不变。');
 await writeFile(dir+'/结果表.txt',lines.join('\n')+'\n',{flag:'wx'});
 await save('EXPERIMENT.complete.json',{status,completedAt:final.at,attempts:attempts.length,finalResultSha256:sha(await readFile(dir+'/FINAL-RESULT.json')),noAdditionalRequestsAuthorized:true});
 console.log(JSON.stringify({status,counts,usage,stopReason,changedExistingFiles:changed.length}));
}

if(process.argv[2]==='--report-only'){await report('Report-only recovery; no network or resend.');process.exit(0);}
if(process.argv[2]!=='--run-authorized')throw Error('Explicit --run-authorized is required; no calls sent');
const manifest=await json(dir+'/FREEZE-MANIFEST.json'),plan=await json(dir+'/EXPERIMENT-PLAN.json'),free=await json(dir+'/FREE-PLAN-CHECK.json'),selection=await json(dir+'/FROZEN-CONTEXTS.json'),reference=await json(dir+'/REFERENCE-LABELS.json');
assert.equal(plan.maximumRequests,10);assert.equal(plan.modelId,'openai/gpt-oss-120b');assert.equal(plan.customerGenerationRequests,0);assert.equal(plan.automaticRetries,0);assert.equal(plan.paidCallsAllowed,false);
assert.equal(free.plan,'Free');assert.equal(free.credentialMatchesObservedProject,true);assert.equal(free.modelsEndpoint.targetModelAvailable,true);assert.ok(Date.now()-Date.parse(free.observedAt)<60*60*1000);
async function verifyFreeze(){for(const file of manifest.files)assert.equal(sha(await readFile(file.path)),file.sha256,'Frozen file changed: '+file.path);assert.equal(sha(await readFile(process.execPath)),manifest.nodeBinarySha256);}
await verifyFreeze();
if(await exists(dir+'/EXPERIMENT.complete.json'))throw Error('Experiment sealed; no additional calls');
await writeFile(dir+'/RUN-ONCE.lock.json',JSON.stringify({experimentId:plan.experimentId,startedAt:new Date().toISOString(),maximumRequests:10,freezeSha256:sha(await readFile(dir+'/FREEZE-MANIFEST.json')),restartMayNotResend:true})+'\n',{flag:'wx'});
await mkdir(dir+'/attempts');
const key=await loadKey(),config={...plan.transport,apiKey:key,rawResponseRecorder:new FileGroqRawResponseRecorderV2(dir+'/raw-provider')};
let headers=null,stopReason=null;
try{for(const sample of selection.samples){
 await verifyFreeze();assert.deepEqual(validateBoundAnswerSampleV1(sample.bound),[]);
 const label=reference.labels.find(row=>row.anonymousId===sample.anonymousId);assert.ok(label);assert.equal(label.bindingHash,sample.bound.bindingHash);
 const views=boundAnswerViewsV1(sample.bound),input=views.reviewerInput,request=views.reviewerRequest,deterministic=runDeterministicChecksV1(sample.bound.envelope,input);
 assert.equal(deterministic.status,'passed');assert.equal(objectSha256(input),sample.bound.reviewInputHash);
 const frozen=await json(dir+`/frozen-request-${sample.sequence}.json`),body=buildGroqSemanticReviewHttpBodyV2(request,config);
 assert.equal(sha(JSON.stringify(body)),frozen.providerRequestSha256);assert.deepEqual(body,frozen.providerRequest);
 await pace(headers,frozen.conservativeTokenBudget);
 await save(`request-${sample.sequence}.json`,{at:new Date().toISOString(),anonymousId:sample.anonymousId,bindingHash:sample.bound.bindingHash,inputHash:sample.bound.reviewInputHash,providerRequestSha256:frozen.providerRequestSha256,providerRequest:body,labelsSent:false});
 let dispatchCount=0;
 const fetcher=async(url,options)=>{
  assert.equal(dispatchCount,0,'One request per sample, no retries');assert.equal(sha(options.body),frozen.providerRequestSha256);
  const previous=await readdir(dir+'/attempts');assert.ok(previous.length<10,'Global persistent ten-request limit');
  await writeFile(dir+'/attempts/'+sample.anonymousId+'.json',JSON.stringify({experimentId:plan.experimentId,anonymousId:sample.anonymousId,sequence:sample.sequence,dispatchDeclaredAt:new Date().toISOString(),bindingHash:sample.bound.bindingHash,providerRequestSha256:frozen.providerRequestSha256})+'\n',{flag:'wx'});
  await appendFile(dir+'/ATTEMPTS.jsonl',JSON.stringify({sequence:sample.sequence,anonymousId:sample.anonymousId,at:new Date().toISOString(),maximumRequests:10})+'\n');
  dispatchCount++;return fetch(url,options);
 };
 const transport=createGroqSemanticReviewTransportV2({...config,fetcher}),startedAt=new Date().toISOString(),start=process.hrtime.bigint();let provider=null,error=null;
 try{provider=await transport(request);}catch(caught){error=caught instanceof Error?caught.message:String(caught);}
 const finishedAt=new Date().toISOString(),latencyMs=Number(process.hrtime.bigint()-start)/1e6;
 const prefix=sample.anonymousId+'-'+input.originalResponseHash.slice(0,16),rawProviderPath=dir+'/raw-provider/'+prefix+'.provider.json',rawReviewPath=dir+'/raw-provider/'+prefix+'.review.txt';
 const providerSaved=await exists(rawProviderPath),reviewSaved=await exists(rawReviewPath),rawProvider=providerSaved?await json(rawProviderPath):null;
 // Raw recorder has already persisted bytes/text before these parsing/validation operations.
 let envelopeBody=null;try{envelopeBody=JSON.parse(rawProvider?.bodyText??'');}catch{}
 const providerMetadata={httpStatus:rawProvider?.httpStatus??null,requestId:provider?.requestId??envelopeBody?.id??null,reportedModel:provider?.reportedModel??envelopeBody?.model??null,finishReason:provider?.finishReason??envelopeBody?.choices?.[0]?.finish_reason??null,usage:provider?.usage??envelopeBody?.usage??null,rateLimitHeaders:provider?.rateLimitHeaders??rawProvider?.headers??null};
 const structure=provider?semanticReviewWireSchemaV3.safeParse(provider.raw):null;
 const derived=provider?deriveSemanticReviewV3(provider.raw,input,{reviewId:'model-review/'+plan.experimentId+'/'+sample.sequence,reviewerIdentity:'model/'+plan.modelId,modelId:plan.modelId,startedAt,finishedAt,sourceMetadata:{experimentId:plan.experimentId,providerId:'groq-free',requestId:provider.requestId,reportedModel:provider.reportedModel,usage:provider.usage,finishReason:provider.finishReason,httpStatus:provider.httpStatus,inputHash:sample.bound.reviewInputHash,bindingHash:sample.bound.bindingHash,automaticRetries:0}}):null;
 const validation=derived?.compatibilityReview?validateSemanticReviewV1(derived.compatibilityReview,input):null;
 const errors=[...(error?[error]:[]),...(structure&&!structure.success?structure.error.issues.map(issue=>issue.path.join('.')+': '+issue.message):[]),...(derived?.errors??[]),...(validation?.errors??[])];
 const sourceStillBound=validateBoundAnswerSampleV1(sample.bound).length===0&&objectSha256(input)===sample.bound.reviewInputHash;
 const protocol={httpPassed:providerMetadata.httpStatus===200,strictSchemaAccepted:providerMetadata.httpStatus===200,rawProviderSaved:providerSaved,rawReviewSaved:reviewSaved,responseComplete:rawProvider?.bodyComplete===true,finishPassed:providerMetadata.finishReason==='stop',modelMatched:providerMetadata.reportedModel===plan.modelId,schemaPassed:structure?.success===true,ruleSetPassed:derived!==null&&!derived.errors.some(item=>/ruleId|Missing applicable/.test(item)),evidencePassed:derived!==null&&!derived.errors.some(item=>/evidence|quote|field .*unavailable/i.test(item)),localDerivationPassed:derived?.status==='passed',sourceValidationPassed:validation?.status==='passed',bindingPassed:sourceStillBound,errors};
 protocol.passed=Boolean(provider)&&Object.entries(protocol).filter(([name])=>name!=='errors').every(([,value])=>value===true);
 const comparison=semantic(protocol.passed?derived:null,label),aggregate=protocol.passed?aggregateHybridEvaluationV1(sample.bound.envelope,deterministic,validation):null;
 const result={experimentId:plan.experimentId,sequence:sample.sequence,anonymousId:sample.anonymousId,sourceSampleId:sample.sourceSampleId,bindingHash:sample.bound.bindingHash,question:sample.bound.envelope.question,facts:sample.bound.envelope.facts,decision:sample.bound.envelope.decision,contract:sample.bound.envelope.contract,originalAnswer:sample.bound.envelope.originalResponse,reference:label,startedAt,finishedAt,latencyMs,providerMetadata,rawProviderPath:providerSaved?rawProviderPath:null,rawReviewPath:reviewSaved?rawReviewPath:null,rawReview:provider?.raw??null,derived,validation,protocol,semantic:comparison,aggregate};
 await save(`result-${sample.sequence}.json`,result);
 console.log(JSON.stringify({event:'completed',sequence:sample.sequence,protocolPassed:protocol.passed,semanticClassification:comparison.classification,usage:providerMetadata.usage}));
 if(!protocol.passed){stopReason='Protocol/integrity failure at sequence '+sample.sequence+': '+errors.join('; ');break;}
 headers=provider.rateLimitHeaders;
}}catch(error){stopReason='Stopped without retry: '+(error instanceof Error?error.message:String(error));await save('STOP-ERROR.json',{at:new Date().toISOString(),stopReason});}
await report(stopReason);
