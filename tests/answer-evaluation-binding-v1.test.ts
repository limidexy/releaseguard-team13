import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {bindAnswerSampleV1,boundAnswerViewsV1,validateBoundAnswerSampleV1,assertReviewReplayBindingV1} from '../src/answer-evaluation-binding-v1.js';
import {aggregateHybridEvaluationV1,runDeterministicChecksV1,validateSemanticReviewV1,objectSha256,sha256,type HybridEnvelopeV1} from '../src/hybrid-evaluation-v1.js';
import {decideReturnV1} from '../src/returns-decision-v1.js';
import {compileResponseContractV17} from '../src/response-contract-v17.js';
import {deriveSemanticReviewV3,type SemanticReviewWireV3} from '../src/semantic-review-wire-v3.js';
import {buildGroqSemanticReviewHttpBodyV2} from '../src/groq-semantic-review-transport-v2.js';

function fixture(){
 const question='When can I return an unused item?',facts={purchaseDaysAgo:null,unused:null,receipt:null,damaged:false,dispute:false,actionRequested:false,privacy:false};
 const decision=decideReturnV1(facts),envelope:HybridEnvelopeV1={caseId:'bound-case',runId:'offline-binding',responseId:'reference-1',question,
  originalResponse:'A synthetic reference answer, not a model result.',responseComplete:true,responseMode:'plain',
  policy:{version:'course-policy-v1',text:'Standard returns require an unused item within 30 days of purchase with a receipt.'},
  facts:{version:'frozen-facts-v1',sourceId:'explicit-reference-facts',value:facts},decision,contract:compileResponseContractV17(question,decision,'plain')};
 return bindAnswerSampleV1(envelope,{questionVersion:'question-fixture-v1',answerVersion:'synthetic-reference-v1',answerKind:'synthetic_regression',sourceArtifact:'tests/reference-input',sourceArtifactSha256:sha256('frozen reference input')});
}
test('all five objects and policy have versions/hashes; annotator and reviewer share facts and contract',()=>{
 const sample=fixture(),views=boundAnswerViewsV1(sample);
 assert.deepEqual(validateBoundAnswerSampleV1(sample),[]);
 for(const key of ['question','facts','decision','contract','answer','policy'] as const){assert.ok(sample.components[key].version);assert.match(sample.components[key].hash,/^[a-f0-9]{64}$/);}
 assert.deepEqual(views.annotationContext,views.reviewerInput);
 assert.deepEqual(views.reviewerRequest.trustedContext.facts.value,views.annotationContext.facts.value);
 assert.deepEqual(views.reviewerRequest.trustedContext.contract.value,views.annotationContext.contract.value);
 assert.equal(sample.evaluationTarget,'answer_compliance_only');assert.equal(sample.factExtractionScored,false);
 assert.equal(views.reviewerInput.facts.value.unused,null); // No re-interpretation from wording.
});
test('question, facts, decision, contract, answer and versions cannot be silently replaced',()=>{
 const changes=[(s:ReturnType<typeof fixture>)=>s.envelope.question+=' Extra question.',
  (s:ReturnType<typeof fixture>)=>s.envelope.facts.value.unused=true,
  (s:ReturnType<typeof fixture>)=>s.envelope.decision.jsonEligible=true,
  (s:ReturnType<typeof fixture>)=>s.envelope.contract.mustAsk.pop(),
  (s:ReturnType<typeof fixture>)=>s.envelope.originalResponse+=' Changed.',
  (s:ReturnType<typeof fixture>)=>s.components.answer.version='different-version'];
 for(const change of changes){const sample=fixture();change(sample);assert.ok(validateBoundAnswerSampleV1(sample).length);assert.throws(()=>boundAnswerViewsV1(sample));}
 const sample=fixture();sample.envelope.facts.value.unused=true;
 assert.throws(()=>bindAnswerSampleV1(sample.envelope,sample.provenance),/FACTS_DECISION_MISMATCH|DECISION_MISMATCH/);
});
test('reference sidecar is excluded from the actual strict wire v3 HTTP body',()=>{
 const sample=fixture(),sidecar={expectedAllowed:true,annotationReason:'LABEL_SENTINEL_DO_NOT_SEND'},views=boundAnswerViewsV1(sample);
 const body=buildGroqSemanticReviewHttpBodyV2(views.reviewerRequest,{apiKey:'offline-placeholder-not-a-credential',modelId:'openai/gpt-oss-120b',temperature:0,maxOutputTokens:4000,reasoningEffort:'low',requestTimeoutMs:1000});
 assert.equal(body.response_format.type,'json_schema');assert.equal(body.response_format.json_schema.strict,true);
 const encoded=JSON.stringify(body);for(const label of [sidecar.annotationReason,'expectedAllowed','missingReason"'])assert.equal(encoded.includes(label),false);
 assert.equal(sample.envelope.originalResponse,views.reviewerRequest.untrustedData.originalResponse);
});
test('saved review replay is restricted to the original full context, not a new answer or contract',()=>{
 const sample=fixture(),input=boundAnswerViewsV1(sample).reviewerInput;
 assert.equal(assertReviewReplayBindingV1(sample,input).mode,'historical_original_object_replay');
 for(const key of ['originalQuestion','originalResponse'] as const){const changed=structuredClone(input);changed[key]+=' Different.';assert.throws(()=>assertReviewReplayBindingV1(sample,changed),/REPLAY_SOURCE_CONTEXT_MISMATCH/);}
 const changed=structuredClone(input);changed.decision.hash='0'.repeat(64);assert.throws(()=>assertReviewReplayBindingV1(sample,changed),/REPLAY_SOURCE_CONTEXT_MISMATCH/);
});
test('missing review blocks with no handwritten evaluator fallback',()=>{
 const sample=fixture(),input=boundAnswerViewsV1(sample).reviewerInput;
 const result=aggregateHybridEvaluationV1(sample.envelope,runDeterministicChecksV1(sample.envelope,input),validateSemanticReviewV1(null,input));
 assert.equal(result.semanticReviewStatus,'missing');assert.equal(result.candidateDeliveryStatus,'blocked');assert.equal(result.customerOutput,null);
});
test('mechanical wire derivation preserves mock judgment and cannot qualify an uncalibrated reviewer',()=>{
 const sample=fixture(),input=boundAnswerViewsV1(sample).reviewerInput,raw=sample.envelope.originalResponse!;
 // Deliberately not a semantic assertion: all-passed mock transport proves only gate wiring.
 const wire:SemanticReviewWireV3={ruleResults:input.applicableRules.map(rule=>({ruleId:rule.ruleId,status:'passed',reason:'Offline protocol stub, not semantic evidence of capability.',evidence:rule.expectation==='required'?[{path:'$',quote:raw}]:[]})),contradictions:[],extraClaims:[],unverifiableItems:[],reviewCompletionStatus:'completed'};
 const copy=JSON.stringify(wire),derived=deriveSemanticReviewV3(wire,input,{reviewId:'offline-protocol-stub',reviewerIdentity:'model/offline-stub',modelId:'openai/gpt-oss-120b',startedAt:'2026-10-21T00:00:00Z',finishedAt:'2026-10-21T00:00:01Z',sourceMetadata:{executionMode:'offline_mock'}});
 assert.equal(derived.status,'passed');assert.equal(JSON.stringify(wire),copy);
 const validation=validateSemanticReviewV1(derived.compatibilityReview,input),result=aggregateHybridEvaluationV1(sample.envelope,runDeterministicChecksV1(sample.envelope,input),validation);
 assert.equal(validation.reviewerValidationStatus,'calibration_pending');assert.equal(result.candidateDeliveryStatus,'blocked');assert.equal(result.customerOutput,null);assert.equal(result.shadowOnly,true);
 assert.equal(result.originalResponseHash,sha256(raw));assert.equal(sample.components.answer.hash,sha256(raw));
 assert.equal(sample.reviewInputHash,objectSha256(input));
});

function sourceClosure(entry:string){const visited=new Set<string>();function visit(file:string){if(visited.has(file))return;visited.add(file);const text=readFileSync(file,'utf8');for(const match of text.matchAll(/\b(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)){const target=resolve(dirname(file),match[1].replace(/\.js$/,'.ts'));visit(target);}}visit(resolve(entry));return visited;}
test('formal Worker dependency closure excludes both handwritten candidates and Hybrid activation',()=>{
 const closure=sourceClosure('src/worker.ts');assert.ok(closure.has(resolve('src/controlled-evaluation-v17.ts')));
 for(const path of ['src/evaluator-next-v1.ts','src/evaluator-next-v2.ts','src/hybrid-evaluation-v1.ts','src/answer-evaluation-binding-v1.ts'])assert.equal(closure.has(resolve(path)),false,path);
 const hybrid=sourceClosure('src/hybrid-evaluation-v1.ts');assert.equal(hybrid.has(resolve('src/evaluator-next-v2.ts')),false);
 const runner=readFileSync('scripts/run-semantic-review-wire-v3-cross-scenario-dev.mjs','utf8');
 for(const name of ['buildSemanticReviewInputV1','runDeterministicChecksV1','createGroqSemanticReviewTransportV2','deriveSemanticReviewV3','validateSemanticReviewV1','aggregateHybridEvaluationV1'])assert.ok(runner.includes(name));
 assert.equal(runner.includes('evaluator-next-v2'),false);
});
