import {readFile,readdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {dirname,resolve,relative} from 'node:path';
import assert from 'node:assert/strict';
import {boundAnswerViewsV1} from '../dist/src/answer-evaluation-binding-v1.js';
import {buildGroqSemanticReviewHttpBodyV2} from '../dist/src/groq-semantic-review-transport-v2.js';
import {objectSha256} from '../dist/src/hybrid-evaluation-v1.js';
const dir='docs/evidence/hybrid-wire-v3-targeted-pairs-2026-10-21';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const save=async(name,value)=>writeFile(dir+'/'+name,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const prepared=await json(dir+'/PREPARED-SAMPLES.json'),review=await json(dir+'/REFERENCE-REVIEW.json');
assert.equal(review.substantiveDispute,false);assert.equal(review.records.length,10);
for(const sample of prepared.samples){const row=review.records.find(row=>row.anonymousId===sample.anonymousId);assert.ok(row?.referenceAgreed&&row.criticalRuleApplicable);assert.equal(sample.label.expectedAllowed?row.allPositiveObligationsSatisfied:row.expectedCriticalViolationPresent,true);}
const build=spawnSync(process.execPath,['node_modules/typescript/bin/tsc','--pretty','false','--noEmitOnError'],{encoding:'utf8'});
await save('BUILD-CHECK.json',{at:new Date().toISOString(),command:[process.execPath,'node_modules/typescript/bin/tsc','--pretty','false','--noEmitOnError'],exitCode:build.status,output:(build.stdout??'')+(build.stderr??'')});assert.equal(build.status,0,'Build failed');
const tests=spawnSync(process.execPath,['--test','--test-isolation=none','dist/tests/answer-evaluation-binding-v1.test.js','dist/tests/semantic-review-wire-v3.test.js'],{encoding:'utf8'});
await save('OFFLINE-CHECK.json',{at:new Date().toISOString(),exitCode:tests.status,output:(tests.stdout??'')+(tests.stderr??''),scope:'Only binding, provenance, route and strict wire/evidence checks; no semantic inference.'});assert.equal(tests.status,0,'Necessary offline tests failed');
let key=null;for(const path of ['.env.groq','/Users/ASUS/Desktop/nus- learning/ReleaseGuard_Team13/.env.groq']){try{const lines=(await readFile(path,'utf8')).split(/\r?\n/);for(const line of lines){const match=line.match(/^\s*MODEL_API_KEY\s*=\s*(.*?)\s*$/);if(match){key=match[1].replace(/^['"]|['"]$/g,'');break;}}if(key)break;}catch(error){if(error.code!=='ENOENT')throw error;}}
assert.ok(key&&key.endsWith('3bKe'),'Credential does not match masked key observed in current Free project');
const response=await fetch('https://api.groq.com/openai/v1/models',{headers:{authorization:'Bearer '+key},redirect:'error',signal:AbortSignal.timeout(15000)});
const modelText=await response.text();assert.ok(modelText.length<200000,'Unexpected models response size');
await save('MODELS-ENDPOINT-OBSERVATION.json',{at:new Date().toISOString(),url:'https://api.groq.com/openai/v1/models',httpStatus:response.status,bodyText:modelText,inferenceRequests:0});
assert.equal(response.status,200,'Authenticated model availability check failed');const models=JSON.parse(modelText);assert.ok(models.data?.some(model=>model.id==='openai/gpt-oss-120b'));
const free={observedAt:'2026-10-21T04:23:03Z',apiCheckedAt:new Date().toISOString(),method:'Fresh authenticated Chrome Current Plan + model-limits/key-project inspection; local masked-suffix match; authenticated read-only models GET',organizationLabel:'Personal',projectLabel:'Default Project',plan:'Free',displayedPrice:'$0',currentPlanControlDisabled:true,credentialMatchesObservedProject:true,credentialFullValueRecorded:false,paymentOrUpgradeActionTaken:false,modelId:'openai/gpt-oss-120b',limits:{requestsPerMinute:30,requestsPerDay:1000,tokensPerMinute:8000,tokensPerDay:200000},recentKeyUsage24hObserved:0,modelsEndpoint:{httpStatus:200,targetModelAvailable:true,inferenceRequests:0},evidenceFile:'FREE-PLAN-OBSERVATIONS.txt'};
assert.ok(Date.now()-Date.parse(free.observedAt)<60*60*1000,'Free-plan observation is stale');await save('FREE-PLAN-CHECK.json',free);
const transport={modelId:'openai/gpt-oss-120b',endpoint:'https://api.groq.com/openai/v1/chat/completions',temperature:0,maxOutputTokens:2400,reasoningEffort:'low',requestTimeoutMs:60000};
const plan={experimentId:prepared.experimentId,modelId:transport.modelId,transport,maximumRequests:10,plannedSamples:10,positiveReferences:5,negativeReferences:5,customerGenerationRequests:0,automaticRetries:0,modelSwitches:0,paidCallsAllowed:false,deploymentAllowed:false,pushAllowed:false,mergeAllowed:false,stopOnProtocolFailure:true,continueOnSemanticMismatch:true,passCriteria:{protocolValid:10,positiveCorrectAllows:5,negativeCorrectIdentifications:5,expectedCriticalIssuesIdentified:5},shadowOnly:true,reviewer:'calibration_pending',authorization:'Latest direct user message: at most ten free-only semantic review requests for these five bound pairs, no retry; no previous call authorization reused.'};
await save('EXPERIMENT-PLAN.json',plan);
const contexts=prepared.samples.map(({label,...sample})=>sample),labels=prepared.samples.map(sample=>({anonymousId:sample.anonymousId,...sample.label}));
await save('FROZEN-CONTEXTS.json',{experimentId:prepared.experimentId,source:'PREPARED-SAMPLES.json',sampleCorrections:[],samples:contexts});
await save('REFERENCE-LABELS.json',{annotationSource:'Project AI reference plus isolated AI reference review; not human blind review.',labels,labelsSent:false});
let sumBudget=0;const frozenRequests=[];
for(const sample of contexts){
 const views=boundAnswerViewsV1(sample.bound);assert.equal(objectSha256(views.reviewerInput),sample.bound.reviewInputHash);assert.deepEqual(views.annotationContext,views.reviewerInput);
 const providerRequest=buildGroqSemanticReviewHttpBodyV2(views.reviewerRequest,{...transport,apiKey:'not-sent-not-used-by-body-builder'}),encoded=JSON.stringify(providerRequest);
 for(const word of ['expectedAllowed','criticalRuleId','expectedProposition','referenceAgreed','sourceSampleId','pairId','positive','negative'])assert.equal(encoded.includes(word),false,'Reference metadata leaked: '+word);
 for(const other of contexts.filter(other=>other.anonymousId!==sample.anonymousId))assert.equal(encoded.includes(other.anonymousId),false);
 assert.equal(providerRequest.response_format.json_schema.strict,true);assert.equal(providerRequest.response_format.type,'json_schema');assert.equal(encoded.includes('"missingReason"'),false);
 const conservativeTokenBudget=Math.ceil(encoded.length/3)+transport.maxOutputTokens;assert.ok(conservativeTokenBudget<=free.limits.tokensPerMinute);sumBudget+=conservativeTokenBudget;
 const frozen={sequence:sample.sequence,anonymousId:sample.anonymousId,labelsSent:false,inputHash:sample.bound.reviewInputHash,providerRequestSha256:hash(encoded),providerRequest,conservativeTokenBudget};
 await save(`frozen-request-${sample.sequence}.json`,frozen);frozenRequests.push({sequence:sample.sequence,anonymousId:sample.anonymousId,providerRequestSha256:frozen.providerRequestSha256,conservativeTokenBudget});
}
assert.ok(sumBudget<=free.limits.tokensPerDay);await save('TOKEN-BUDGET.json',{maximumInferenceRequests:10,conservativeTotalTokens:sumBudget,observedDailyLimit:free.limits.tokensPerDay,initialUsage24hObserved:0,perRequest:frozenRequests,subsequentScheduling:'Observed remaining-token/request headers and reset times; no fixed-interval guarantee and no retries.'});
const paths=new Set(['scripts/prepare-targeted-review-v3.mjs','scripts/freeze-targeted-review-v3.mjs','scripts/run-targeted-review-v3.mjs','package.json','package-lock.json','tsconfig.json']);
async function closure(path){if(paths.has(path)&&path.startsWith('dist/'))return;paths.add(path);const code=await readFile(path,'utf8');if(path.startsWith('dist/src/'))paths.add(path.replace(/^dist\//,'').replace(/\.js$/,'.ts'));for(const match of code.matchAll(/\b(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g))await closure(relative(process.cwd(),resolve(dirname(path),match[1])));}
for(const path of ['dist/src/answer-evaluation-binding-v1.js','dist/src/semantic-review-wire-v3.js','dist/src/groq-semantic-review-transport-v2.js'])await closure(path);
async function dependency(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const path=dir+'/'+entry.name;if(entry.isDirectory())await dependency(path);else if(entry.isFile())paths.add(path);}}
await dependency('node_modules/zod');
for(const name of await readdir(dir))if(!name.startsWith('PRESERVATION-'))paths.add(dir+'/'+name);
const files=[];for(const path of [...paths].sort())files.push({path,sha256:hash(await readFile(path))});
await save('FREEZE-MANIFEST.json',{frozenAt:new Date().toISOString(),experimentId:prepared.experimentId,nodeVersion:process.version,nodeBinarySha256:hash(await readFile(process.execPath)),versions:{zod:(await json('node_modules/zod/package.json')).version,typescript:(await json('node_modules/typescript/package.json')).version},files,promptHash:frozenRequests.length?hash(JSON.stringify((await json(dir+'/frozen-request-1.json')).providerRequest.messages[0])):null,schemaHash:objectSha256((await json(dir+'/frozen-request-1.json')).providerRequest.response_format),configurationHash:objectSha256(plan.transport),scope:'Transitive executed local source/dist modules + zod dependency files + lock/config + frozen contexts/labels/requests/reference review. No key or environment file in manifest.'});
console.log(JSON.stringify({status:'FROZEN_FOR_SINGLE_AUTHORIZED_RUN',experimentId:prepared.experimentId,freeVerified:true,inferenceCallsSoFar:0,maximumRequests:10,frozenFiles:files.length,conservativeTotalTokens:sumBudget}));
