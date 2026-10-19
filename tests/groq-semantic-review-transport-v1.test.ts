import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildSemanticReviewInputV1} from '../src/hybrid-evaluation-v1.js';
import {buildModelReviewRequestV1} from '../src/semantic-review-sources-v1.js';
import {FileGroqRawResponseRecorderV2,createGroqSemanticReviewTransportV1,buildGroqSemanticReviewHttpBodyV1,type GroqRawResponseRecorderV2} from '../src/groq-semantic-review-transport-v1.js';
import {decisionForQuestionV1} from '../src/returns-decision-v1.js';
import {compileResponseContractV17} from '../src/response-contract-v17.js';

const question='When can I return an unused item?';
const answer='A standard return requires an unused item within 30 days of purchase and a receipt. The purchase date is unknown, so standard eligibility cannot yet be determined. When was it purchased, and do you have a receipt?';
const policy='Standard returns require an unused item within 30 days of purchase with a receipt. Damage, disputes and ineligible cases require human review. No external action or unsupported data-handling claim is authorized.';
function request(){const decision=decisionForQuestionV1(question),contract=compileResponseContractV17(question,decision,'plain');return buildModelReviewRequestV1(buildSemanticReviewInputV1({caseId:'transport-case',runId:'transport-run',responseId:'transport-response',question,originalResponse:answer,responseComplete:true,responseMode:'plain',policy:{version:'transport-policy-v1',text:policy},facts:{version:'returns-facts-v1',sourceId:'question-parser-v1',value:decision.facts},decision,contract}));}
const baseConfig={apiKey:'test-secret-never-log',modelId:'openai/gpt-oss-120b' as const,temperature:0 as const,maxOutputTokens:2400,reasoningEffort:'low' as const,requestTimeoutMs:30000};
function payload(){const req=request();return {ruleResults:req.trustedContext.applicableRules.map(rule=>({ruleId:rule.ruleId,status:rule.expectation==='required'?'failed':'passed',reason:'Fixture business decision.',evidenceFragments:[],missingReason:rule.expectation==='required'?'Required statement is absent.':'No violating text was found.'})),contradictions:[],extraClaims:[],unverifiableItems:[],reviewCompletionStatus:'completed'};}
function providerResponse(content:string,options:{status?:number;finishReason?:string;model?:string;body?:string}={}){return new Response(options.body??JSON.stringify({id:'req-test-1',model:options.model??'openai/gpt-oss-120b',choices:[{finish_reason:options.finishReason??'stop',message:{content}}],usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150}}),{status:options.status??200,headers:{'content-type':'application/json','x-ratelimit-remaining-requests':'999'}});}

test('Groq body sends the complete strict JSON schema and no labels, tools or coordinate fields',()=>{
 const req=request(),body=buildGroqSemanticReviewHttpBodyV1(req,baseConfig),serialized=JSON.stringify(body);
 assert.equal(body.model,'openai/gpt-oss-120b');assert.equal(body.tool_choice,'none');assert.equal('tools' in body,false);
 assert.equal(body.response_format.type,'json_schema');assert.equal(body.response_format.json_schema.strict,true);assert.equal(body.response_format.json_schema.schema.additionalProperties,false);
 assert.deepEqual(body.response_format.json_schema.schema.required,['ruleResults','contradictions','extraClaims','unverifiableItems','reviewCompletionStatus']);
 const ruleItem=body.response_format.json_schema.schema.properties.ruleResults.items;assert.equal(ruleItem.additionalProperties,false);assert.deepEqual(ruleItem.required,['ruleId','status','reason','evidenceFragments','missingReason']);
 assert.equal(serialized.includes('coordinateUnit'),false);assert.equal(serialized.includes('expectedAllowed'),false);assert.equal(serialized.includes('expectedRuleFamilies'),false);assert.equal(serialized.includes(baseConfig.apiKey),false);
 assert.match(body.messages[1].content,/TRUSTED REVIEW CONTEXT/);assert.match(body.messages[2].content,/UNTRUSTED DATA TO REVIEW/);
});

test('transport stores the complete provider envelope and review text before later validation',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'rg-groq-strict-'));try{
  let calls=0,captured:any;const fetcher:typeof fetch=async(_url,init)=>{calls++;captured=JSON.parse(String(init?.body));return providerResponse(JSON.stringify(payload()));};
  const result=await createGroqSemanticReviewTransportV1({...baseConfig,rawResponseRecorder:new FileGroqRawResponseRecorderV2(dir),fetcher})(request());
  assert.equal(calls,1);assert.equal(captured.response_format.type,'json_schema');assert.equal(result.requestId,'req-test-1');assert.equal(result.reportedModel,'openai/gpt-oss-120b');assert.equal(result.finishReason,'stop');assert.equal(result.httpStatus,200);assert.equal(result.usage.total_tokens,150);assert.deepEqual(result.raw,payload());
  const files=(await readdir(dir)).sort();assert.equal(files.length,2);assert.ok(files.some(file=>file.endsWith('.provider.json')));assert.ok(files.some(file=>file.endsWith('.review.txt')));
  const provider=JSON.parse(await readFile(join(dir,files.find(file=>file.endsWith('.provider.json'))!),'utf8'));assert.equal(provider.bodyComplete,true);assert.equal(provider.httpStatus,200);assert.match(provider.bodyText,/req-test-1/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('all provider and parsing error paths retain every received raw byte without retry',async()=>{
 const scenarios:{name:string;response:()=>Response;expected:string}[]=[
  {name:'http',response:()=>providerResponse('',{status:429,body:'{"error":"rate limited"}'}),expected:'rate limited'},
  {name:'outer-json',response:()=>providerResponse('',{body:'not-json'}),expected:'not-json'},
  {name:'inner-json',response:()=>providerResponse('{not-json'),expected:'{not-json'},
  {name:'length',response:()=>providerResponse(JSON.stringify(payload()),{finishReason:'length'}),expected:'req-test-1'},
  {name:'model',response:()=>providerResponse(JSON.stringify(payload()),{model:'another-model'}),expected:'another-model'},
 ];
 for(const scenario of scenarios){
  const dir=await mkdtemp(join(tmpdir(),`rg-${scenario.name}-`));try{let calls=0;await assert.rejects(createGroqSemanticReviewTransportV1({...baseConfig,rawResponseRecorder:new FileGroqRawResponseRecorderV2(dir),fetcher:async()=>{calls++;return scenario.response();}})(request()));assert.equal(calls,1);const providerFile=(await readdir(dir)).find(file=>file.endsWith('.provider.json'));assert.ok(providerFile);const provider=JSON.parse(await readFile(join(dir,providerFile!),'utf8'));assert.match(provider.bodyText,new RegExp(scenario.expected.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));}finally{await rm(dir,{recursive:true,force:true});}
 }
});

test('partial stream read is saved as incomplete and never invented',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'rg-read-failure-'));try{
  let pulled=0;const stream=new ReadableStream<Uint8Array>({pull(controller){if(pulled++===0)controller.enqueue(new TextEncoder().encode('{"partial":'));else controller.error(new Error('read boom'));}});
  let calls=0;await assert.rejects(createGroqSemanticReviewTransportV1({...baseConfig,rawResponseRecorder:new FileGroqRawResponseRecorderV2(dir),fetcher:async()=>{calls++;return new Response(stream,{status:200});}})(request()),/read incomplete/);assert.equal(calls,1);
  const providerFile=(await readdir(dir)).find(file=>file.endsWith('.provider.json'));const record=JSON.parse(await readFile(join(dir,providerFile!),'utf8'));assert.equal(record.bodyComplete,false);assert.equal(record.bodyText,'{"partial":');assert.match(record.readError,/read boom/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('raw persistence failure is fatal and prevents parsing',async()=>{
 let calls=0,reviewWrites=0;const recorder:GroqRawResponseRecorderV2={async recordProviderResponse(){throw new Error('disk unavailable');},async recordReviewText(){reviewWrites++;return 'unreachable';}};
 await assert.rejects(createGroqSemanticReviewTransportV1({...baseConfig,rawResponseRecorder:recorder,fetcher:async()=>{calls++;return providerResponse(JSON.stringify(payload()));}})(request()),/disk unavailable/);assert.equal(calls,1);assert.equal(reviewWrites,0);
});
