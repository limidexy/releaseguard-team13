import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildSemanticReviewInputV1} from '../src/hybrid-evaluation-v1.js';
import {buildModelReviewRequestV1} from '../src/semantic-review-sources-v1.js';
import {FileGroqRawResponseRecorderV2,type GroqRawResponseRecorderV2} from '../src/groq-semantic-review-transport-v1.js';
import {buildGroqSemanticReviewHttpBodyV2,createGroqSemanticReviewTransportV2} from '../src/groq-semantic-review-transport-v2.js';
import {decisionForQuestionV1} from '../src/returns-decision-v1.js';
import {compileResponseContractV17} from '../src/response-contract-v17.js';

const question='When can I return an unused item?',answer='The purchase date is unknown, so standard eligibility cannot yet be determined. What was the purchase date?',policy='Standard returns require an unused item within 30 days of purchase with a receipt. Missing facts remain unknown.';
function request(){const decision=decisionForQuestionV1(question),contract=compileResponseContractV17(question,decision,'plain');return buildModelReviewRequestV1(buildSemanticReviewInputV1({caseId:'v3-transport-case',runId:'v3-transport-run',responseId:'v3-transport-response',question,originalResponse:answer,responseComplete:true,responseMode:'plain',policy:{version:'transport-policy-v1',text:policy},facts:{version:'returns-facts-v1',sourceId:'question-parser-v1',value:decision.facts},decision,contract}));}
const baseConfig={apiKey:'test-secret-never-log',modelId:'openai/gpt-oss-120b' as const,temperature:0 as const,maxOutputTokens:2400,reasoningEffort:'low' as const,requestTimeoutMs:30000};
function payload(){const req=request();return {ruleResults:req.trustedContext.applicableRules.map(rule=>({ruleId:rule.ruleId,status:rule.expectation==='required'?'failed':'passed',reason:rule.expectation==='required'?'Required content is absent.':'Checked; no prohibited content is present.',evidence:[]})),contradictions:[],extraClaims:[],unverifiableItems:[],reviewCompletionStatus:'completed'};}
function providerResponse(content:string,options:{status?:number;finishReason?:string;model?:string;body?:string}={}){return new Response(options.body??JSON.stringify({id:'req-v3-test-1',model:options.model??'openai/gpt-oss-120b',choices:[{finish_reason:options.finishReason??'stop',message:{content}}],usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150}}),{status:options.status??200,headers:{'content-type':'application/json','x-ratelimit-remaining-requests':'999'}});}

test('candidate request sends strict v3 schema with reason and evidence but no missingReason',()=>{
 const body=buildGroqSemanticReviewHttpBodyV2(request(),baseConfig),serialized=JSON.stringify(body),item=body.response_format.json_schema.schema.properties.ruleResults.items;
 assert.equal(body.response_format.type,'json_schema');assert.equal(body.response_format.json_schema.strict,true);assert.equal(item.additionalProperties,false);assert.deepEqual(item.required,['ruleId','status','reason','evidence']);assert.equal('missingReason' in item.properties,false);assert.equal(JSON.stringify(body.response_format.json_schema.schema).includes('missingReason'),false);assert.equal(JSON.stringify(body.response_format.json_schema.schema).includes('evidenceFragments'),false);assert.equal(serialized.includes('coordinateUnit'),false);assert.equal(serialized.includes(baseConfig.apiKey),false);
 assert.match(body.messages[0].content,/reason is the single explanation field/);assert.match(body.messages[0].content,/required \+ failed because content is missing: evidence may be empty/);assert.match(body.messages[0].content,/prohibited \+ passed: evidence may be empty/);
});

test('mock transport saves provider envelope and review text before local interpretation',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'rg-wire-v3-'));try{let calls=0,captured:any;const result=await createGroqSemanticReviewTransportV2({...baseConfig,rawResponseRecorder:new FileGroqRawResponseRecorderV2(dir),fetcher:async(_url,init)=>{calls++;captured=JSON.parse(String(init?.body));return providerResponse(JSON.stringify(payload()));}})(request());assert.equal(calls,1);assert.equal(captured.response_format.json_schema.name,'releaseguard_semantic_review_wire_v3');assert.deepEqual(result.raw,payload());const files=(await readdir(dir)).sort();assert.equal(files.filter(file=>file.endsWith('.provider.json')).length,1);assert.equal(files.filter(file=>file.endsWith('.review.txt')).length,1);const provider=JSON.parse(await readFile(join(dir,files.find(file=>file.endsWith('.provider.json'))!),'utf8'));assert.equal(provider.bodyComplete,true);assert.equal(provider.httpStatus,200);}finally{await rm(dir,{recursive:true,force:true});}
});

test('mock error paths preserve received bytes and never retry',async()=>{
 const scenarios=[{name:'http',response:()=>providerResponse('',{status:429,body:'{"error":"rate limited"}'})},{name:'outer',response:()=>providerResponse('',{body:'not-json'})},{name:'inner',response:()=>providerResponse('{not-json')},{name:'length',response:()=>providerResponse(JSON.stringify(payload()),{finishReason:'length'})}];
 for(const scenario of scenarios){const dir=await mkdtemp(join(tmpdir(),`rg-wire-v3-${scenario.name}-`));try{let calls=0;await assert.rejects(createGroqSemanticReviewTransportV2({...baseConfig,rawResponseRecorder:new FileGroqRawResponseRecorderV2(dir),fetcher:async()=>{calls++;return scenario.response();}})(request()));assert.equal(calls,1);const file=(await readdir(dir)).find(name=>name.endsWith('.provider.json'));assert.ok(file);const record=JSON.parse(await readFile(join(dir,file!),'utf8'));assert.equal(typeof record.bodyText,'string');}finally{await rm(dir,{recursive:true,force:true});}}
});

test('raw persistence failure is fatal before review-text parsing',async()=>{
 let calls=0,writes=0;const recorder:GroqRawResponseRecorderV2={async recordProviderResponse(){throw new Error('disk unavailable');},async recordReviewText(){writes++;return 'unreachable';}};await assert.rejects(createGroqSemanticReviewTransportV2({...baseConfig,rawResponseRecorder:recorder,fetcher:async()=>{calls++;return providerResponse(JSON.stringify(payload()));}})(request()),/disk unavailable/);assert.equal(calls,1);assert.equal(writes,0);
});
