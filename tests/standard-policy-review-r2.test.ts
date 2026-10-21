import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildStandardPolicyReviewR2,STANDARD_POLICY_REVIEW_REVISION_R2,STANDARD_POLICY_REVIEW_MEANING_R2,STANDARD_POLICY_REVIEW_INSTRUCTIONS_R2} from '../src/standard-policy-review-r2.js';
import {buildSemanticReviewInputV1,objectSha256,type HybridEnvelopeV1} from '../src/hybrid-evaluation-v1.js';
import {buildModelReviewRequestV1} from '../src/semantic-review-sources-v1.js';
import {buildGroqSemanticReviewHttpBodyV2,createGroqSemanticReviewTransportV2} from '../src/groq-semantic-review-transport-v2.js';
import {deriveSemanticReviewV3,SEMANTIC_REVIEW_WIRE_JSON_SCHEMA_V3,type SemanticReviewWireV3} from '../src/semantic-review-wire-v3.js';
const read=(path:string)=>JSON.parse(readFileSync(path,'utf8'));
const fixtures=read('tests/standard-policy-review-r2-fixtures.json');
const template=read('docs/evidence/route-contract-alignment-2026-10-21/TARGETED-PAIRS-BOUND.json').samples[0].envelope as HybridEnvelopeV1;
const config={apiKey:'offline-unit-test-not-a-credential',modelId:'openai/gpt-oss-120b' as const,temperature:0 as const,maxOutputTokens:2400,reasoningEffort:'low' as const,requestTimeoutMs:60000};
function context(answer:string){const envelope=structuredClone(template);envelope.originalResponse=answer;envelope.caseId='offline-r2-case';envelope.runId='offline-r2-run';envelope.responseId='offline-r2-response';return {envelope,input:buildSemanticReviewInputV1(envelope)};}
const realFetch=globalThis.fetch;let unexpectedNetworkAttempts=0;
before(()=>{globalThis.fetch=async()=>{unexpectedNetworkAttempts++;throw Error('Real network is forbidden in these offline tests');};});
after(()=>{globalThis.fetch=realFetch;assert.equal(unexpectedNetworkAttempts,0);});

test('r2 instructions require completeness, whole-answer consistency and ownership, not keyword negation',()=>{
 assert.ok(STANDARD_POLICY_REVIEW_MEANING_R2.length<=1000);
 for(const clause of ['all three jointly necessary standard-return conditions','entire answer','EXTRA_CLAIMS_AUTHORIZED'])assert.ok(STANDARD_POLICY_REVIEW_MEANING_R2.includes(clause));
 for(const clause of ['A correct opening cannot cancel a later contradiction','attributed customer quotation','explicitly rejected and corrected','Quotation marks or a negation word alone','unverifiable','cannot be automatically treated as corrected']){
  // Last condition is stated equivalently as "must not be automatically treated".
  if(clause==='cannot be automatically treated as corrected')assert.ok(STANDARD_POLICY_REVIEW_INSTRUCTIONS_R2.includes('must not be automatically treated as corrected'));
  else assert.ok(STANDARD_POLICY_REVIEW_INSTRUCTIONS_R2.includes(clause),clause);
 }
});
test('references cover all three conditions and four categories, with both corrected-quote owners',()=>{
 assert.equal(fixtures.samples.length,15);
 for(const condition of ['unused','30_days','receipt']){
  const rows=fixtures.samples.filter((row:any)=>row.condition===condition);
  assert.deepEqual(new Set(rows.map((row:any)=>row.category)),new Set(['correct_policy','missing_condition','contrary_assertion','quoted_error_corrected']));
  assert.deepEqual(new Set(rows.filter((row:any)=>row.category==='quoted_error_corrected').map((row:any)=>row.attribution)),new Set(['customer_quote_rejected','erroneous_example_rejected']));
  for(const row of rows)assert.equal(row.expectedStandardPolicy,['missing_condition','contrary_assertion'].includes(row.category)?'failed':'passed');
 }
 // These are reference labels and coverage checks, NOT inferred/model-validated judgments.
 assert.match(fixtures.annotationSource,/not real model outputs/);
});
test('new revision preserves original context and isolates itself from the old request version/hash',()=>{
 const {envelope,input}=context(fixtures.samples[0].answer),original=JSON.stringify({envelope,input});
 const oldRequest=buildModelReviewRequestV1(input),oldBody=buildGroqSemanticReviewHttpBodyV2(oldRequest,config),oldRequestCopy=JSON.stringify(oldRequest);
 const candidate=buildStandardPolicyReviewR2(input,config);
 assert.equal(candidate.revision,STANDARD_POLICY_REVIEW_REVISION_R2);assert.equal(candidate.baseReviewInputHash,objectSha256(input));
 assert.notEqual(candidate.providerRequestHash,objectSha256(oldBody));assert.notEqual(candidate.reviewContextHash,objectSha256(oldRequest.trustedContext));
 assert.equal(JSON.stringify({envelope,input}),original);assert.equal(JSON.stringify(oldRequest),oldRequestCopy);
 assert.deepEqual(buildGroqSemanticReviewHttpBodyV2(buildModelReviewRequestV1(input),config),oldBody);
 for(const key of ['policy','facts','decision','contract'] as const)assert.deepEqual(candidate.request.trustedContext[key],oldRequest.trustedContext[key]);
 assert.deepEqual(candidate.request.untrustedData,oldRequest.untrustedData);
 for(const rule of candidate.request.trustedContext.applicableRules)assert.deepEqual(rule,rule.ruleId==='STANDARD_POLICY'?{...oldRequest.trustedContext.applicableRules.find(row=>row.ruleId===rule.ruleId)!,meaning:STANDARD_POLICY_REVIEW_MEANING_R2}:oldRequest.trustedContext.applicableRules.find(row=>row.ruleId===rule.ruleId));
});
test('existing transport receives the actual r2 body for all references via a local fake fetcher only',async()=>{
 let mockDispatches=0;
 for(const fixture of fixtures.samples){
  const {input}=context(fixture.answer),candidate=buildStandardPolicyReviewR2(input,config),captures:unknown[]=[];
  const transport=createGroqSemanticReviewTransportV2({...config,
   rawResponseRecorder:{async recordProviderResponse(record){captures.push(record);return 'memory://offline-provider';},async recordReviewText(id,text){captures.push({id,text});return 'memory://offline-review';}},
   fetcher:async(_url,options)=>{
    mockDispatches++;const body=JSON.parse(String(options?.body));assert.deepEqual(body,candidate.providerRequest);
    assert.ok(body.messages[0].content.includes(STANDARD_POLICY_REVIEW_INSTRUCTIONS_R2));
    const trusted=JSON.parse(body.messages[1].content.split('\n').slice(1).join('\n'));
    assert.equal(trusted.applicableRules.find((rule:any)=>rule.ruleId==='STANDARD_POLICY').meaning,STANDARD_POLICY_REVIEW_MEANING_R2);
    assert.deepEqual(trusted.facts,input.facts);assert.deepEqual(trusted.decision,input.decision);assert.deepEqual(trusted.contract,input.contract);
    const untrusted=JSON.parse(body.messages[2].content.split('\n').slice(1).join('\n'));assert.equal(untrusted.originalResponse,fixture.answer);assert.equal(untrusted.originalResponseHash,input.originalResponseHash);
    for(const key of ['expectedStandardPolicy','annotationSource','fixtureId','attribution'])assert.equal(String(options?.body).includes('"'+key+'"'),false);
    assert.equal(body.response_format.type,'json_schema');assert.equal(body.response_format.json_schema.strict,true);assert.deepEqual(body.response_format.json_schema.schema,SEMANTIC_REVIEW_WIRE_JSON_SCHEMA_V3);
    assert.equal(body.model,'openai/gpt-oss-120b');assert.equal(body.max_completion_tokens,2400);assert.equal(body.temperature,0);
    return new Response(JSON.stringify({id:'offline-stub',model:'openai/gpt-oss-120b',choices:[{finish_reason:'stop',message:{content:'{"transportStub":"not-a-semantic-review"}'}}],usage:{prompt_tokens:0,completion_tokens:0,total_tokens:0}}),{status:200});
   }});
  const response=await transport(candidate.request);assert.deepEqual(response.raw,{transportStub:'not-a-semantic-review'});assert.equal(captures.length,2);
 }
 assert.equal(mockDispatches,15);assert.equal(unexpectedNetworkAttempts,0);
});
test('wire derivation does not rewrite a deliberately inconsistent synthetic STANDARD_POLICY judgment',()=>{
 const fixture=fixtures.samples.find((row:any)=>row.id==='unused-contradiction'),{input}=context(fixture.answer),wire:SemanticReviewWireV3={
  ruleResults:input.applicableRules.map(rule=>({ruleId:rule.ruleId,status:rule.ruleId==='EXTRA_CLAIMS_AUTHORIZED'?'failed':'passed',reason:'Synthetic mechanical-preservation fixture; not model judgment.',evidence:rule.expectation==='required'||rule.ruleId==='EXTRA_CLAIMS_AUTHORIZED'?[{path:'$',quote:fixture.answer}]:[]})),
  contradictions:[{reason:'Synthetic contradiction observation.',evidence:[{path:'$',quote:fixture.answer}]}],extraClaims:[],unverifiableItems:[],reviewCompletionStatus:'completed'};
 const original=JSON.stringify(wire),derived=deriveSemanticReviewV3(wire,input,{reviewId:'r2-offline-mock',reviewerIdentity:'offline/mock',modelId:'openai/gpt-oss-120b',startedAt:'2026-10-21T00:00:00Z',finishedAt:'2026-10-21T00:00:01Z',sourceMetadata:{executionMode:'offline_mock',reviewDefinitionRevision:STANDARD_POLICY_REVIEW_REVISION_R2}});
 assert.equal(derived.status,'passed');assert.equal(JSON.stringify(wire),original);
 assert.equal(derived.ruleResults.find(row=>row.ruleId==='STANDARD_POLICY')!.status,'passed');assert.equal(derived.ruleResults.find(row=>row.ruleId==='EXTRA_CLAIMS_AUTHORIZED')!.status,'failed');
});
test('old failed experiment remains failed with its original per-rule judgments',()=>{
 const dir='docs/evidence/hybrid-wire-v3-targeted-pairs-2026-10-21',summary=read(dir+'/FINAL-RESULT.json'),record=read(dir+'/result-10.json');
 assert.equal(summary.status,'TARGETED_VALIDATION_FAILED');assert.equal(record.derived.ruleResults.find((row:any)=>row.ruleId==='STANDARD_POLICY').status,'passed');
 assert.equal(record.derived.ruleResults.find((row:any)=>row.ruleId==='EXTRA_CLAIMS_AUTHORIZED').status,'failed');
});
