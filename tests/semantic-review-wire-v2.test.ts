import test from 'node:test';
import assert from 'node:assert/strict';
import {aggregateHybridEvaluationV1,buildSemanticReviewInputV1,runDeterministicChecksV1,validateSemanticReviewV1,type HybridEnvelopeV1,type SemanticReviewInputV1} from '../src/hybrid-evaluation-v1.js';
import {deriveSemanticReviewV2,type SemanticReviewWireV2} from '../src/semantic-review-wire-v2.js';
import {decisionForQuestionV1} from '../src/returns-decision-v1.js';
import {compileResponseContractV17} from '../src/response-contract-v17.js';

const policy='Standard returns require an unused item within 30 days of purchase with a receipt. Missing facts stay unknown. Unsupported external actions and data-handling promises are prohibited.';
function fixture(originalResponse='Unique evidence 😀. A standard return requires an unused item within 30 days of purchase and a receipt. The purchase date is unknown, so eligibility cannot yet be determined. When was it purchased, is it unused, and is a receipt available?'){
 const question='When can I return an unused item?',decision=decisionForQuestionV1(question),contract=compileResponseContractV17(question,decision,'plain');
 const envelope:HybridEnvelopeV1={caseId:'wire-case',runId:'wire-run',responseId:'wire-response',question,originalResponse,responseComplete:true,responseMode:'plain',policy:{version:'wire-policy-v1',text:policy},facts:{version:'returns-facts-v1',sourceId:'question-parser-v1',value:decision.facts},decision,contract};
 return {envelope,input:buildSemanticReviewInputV1(envelope)};
}
function validWire(input:SemanticReviewInputV1,quote='Unique evidence 😀'):SemanticReviewWireV2{return {ruleResults:input.applicableRules.map(rule=>({ruleId:rule.ruleId,status:'passed',reason:rule.expectation==='required'?'The required meaning is present.':'No prohibited meaning is present.',evidenceFragments:rule.expectation==='required'?[{path:'$',quote}]:[],missingReason:rule.expectation==='required'?null:'No violating text was found.'})),contradictions:[],extraClaims:[],unverifiableItems:[],reviewCompletionStatus:'completed'};}
function metadata(){return {reviewId:'review/wire-test',reviewerIdentity:'model/openai-gpt-oss-120b',modelId:'openai/gpt-oss-120b',startedAt:'2026-10-18T01:00:00.000Z',finishedAt:'2026-10-18T01:00:01.000Z',sourceMetadata:{executionMode:'real'}};}

test('program derives UTF-16 coordinates and preserves multiple exact evidence fragments',()=>{
 const {input}=fixture('Unique evidence 😀. Second exact clause.');const wire=validWire(input);const required=wire.ruleResults.find(item=>input.applicableRules.find(rule=>rule.ruleId===item.ruleId)?.expectation==='required')!;required.evidenceFragments=[{path:'$',quote:'Unique evidence 😀'},{path:'$',quote:'Second exact clause'}];
 const derived=deriveSemanticReviewV2(wire,input,metadata());assert.equal(derived.status,'passed');const row=derived.ruleResults.find(item=>item.ruleId===required.ruleId)!;assert.equal(row.evidenceFragments.length,2);for(const evidence of row.evidenceFragments){assert.equal(input.originalResponse.slice(evidence.start,evidence.end),evidence.quote);assert.equal(evidence.coordinateUnit,'utf16-code-unit');}
});

test('JSON escaping and Unicode are located in decoded fields, not in serialized bytes',()=>{
 const question='When can I return an unused item?',decision=decisionForQuestionV1(question),contract=compileResponseContractV17(question,decision,'json'),reason='He said "keep it" 😀 — exact.';
 const originalResponse=JSON.stringify({eligible:false,reason,nextStep:'Ask once.'}),envelope:HybridEnvelopeV1={caseId:'json-wire',runId:'wire-run',responseId:'json-response',question,originalResponse,responseComplete:true,responseMode:'json',policy:{version:'wire-policy-v1',text:policy},facts:{version:'returns-facts-v1',sourceId:'question-parser-v1',value:decision.facts},decision,contract},input=buildSemanticReviewInputV1(envelope),wire=validWire(input,reason);
 for(const row of wire.ruleResults)if(row.evidenceFragments.length)row.evidenceFragments=[{path:'$.reason',quote:reason}];
 const derived=deriveSemanticReviewV2(wire,input,metadata());assert.equal(derived.status,'passed');const evidence=derived.ruleResults.find(row=>row.evidenceFragments.length)!.evidenceFragments[0];assert.equal(evidence.source,'json_field');assert.equal(reason.slice(evidence.start,evidence.end),reason);
});

test('duplicate and missing quotes fail exact evidence validation',()=>{
 for(const [answer,quote,expected] of [['repeat repeat','repeat','ambiguous'],['only here','absent','not found']] as const){const {input}=fixture(answer),wire=validWire(input,quote),derived=deriveSemanticReviewV2(wire,input,metadata());assert.equal(derived.status,'failed');assert.ok(derived.errors.some(error=>error.includes(expected)));}
});

test('missing, duplicate and unknown rules are rejected independently of JSON schema validity',()=>{
 const {input}=fixture();
 const missing=validWire(input);missing.ruleResults.pop();assert.ok(deriveSemanticReviewV2(missing,input,metadata()).errors.some(error=>error.startsWith('Missing applicable ruleId')));
 const duplicate=validWire(input);duplicate.ruleResults.push({...duplicate.ruleResults[0]});assert.ok(deriveSemanticReviewV2(duplicate,input,metadata()).errors.some(error=>error.includes('duplicate ruleId')));
 const unknown=validWire(input);unknown.ruleResults[0]={...unknown.ruleResults[0],ruleId:'UNKNOWN_RULE'};assert.ok(deriveSemanticReviewV2(unknown,input,metadata()).errors.some(error=>error.includes('unknown or inapplicable')));
});

test('correct and violating judgments both travel without the program correcting model semantics',()=>{
 const {input}=fixture('Unique evidence 😀. Unsupported six-month retention promise.');const wire=validWire(input),prohibitedIndex=input.applicableRules.findIndex(rule=>rule.expectation==='prohibited');assert.ok(prohibitedIndex>=0);
 wire.ruleResults[prohibitedIndex]={...wire.ruleResults[prohibitedIndex],status:'failed',reason:'The answer contains an unsupported promise.',evidenceFragments:[{path:'$',quote:'Unsupported six-month retention promise.'}],missingReason:null};wire.extraClaims=[{description:'Unsupported retention promise.',status:'failed',evidenceFragments:[{path:'$',quote:'Unsupported six-month retention promise.'}],missingReason:null}];
 const violation=deriveSemanticReviewV2(wire,input,metadata());assert.equal(violation.status,'passed');assert.equal(violation.ruleResults[prohibitedIndex].status,'failed');
 const wrong=validWire(input);const requiredIndex=input.applicableRules.findIndex(rule=>rule.expectation==='required');wrong.ruleResults[requiredIndex]={...wrong.ruleResults[requiredIndex],status:'failed',reason:'Model says the statement is missing.',evidenceFragments:[],missingReason:'The model judged it absent.'};const wrongDerived=deriveSemanticReviewV2(wrong,input,metadata());assert.equal(wrongDerived.status,'passed');assert.equal(wrongDerived.ruleResults[requiredIndex].status,'failed');
});

test('a prohibited passed rule needs an explicit reason but no violation quote or missingReason',()=>{
 const {input}=fixture(),wire=validWire(input),index=input.applicableRules.findIndex(rule=>rule.expectation==='prohibited');assert.ok(index>=0);wire.ruleResults[index]={...wire.ruleResults[index],reason:'The answer was checked and contains no claim that the case is outside the window.',evidenceFragments:[],missingReason:null};const derived=deriveSemanticReviewV2(wire,input,metadata());assert.equal(derived.status,'passed');assert.equal(derived.ruleResults[index].status,'passed');assert.equal(derived.ruleResults[index].missingReason,null);
});

test('an uncalibrated model review remains blocked from formal customer delivery',()=>{
 const {input,envelope}=fixture(),derived=deriveSemanticReviewV2(validWire(input),input,metadata());assert.equal(derived.status,'passed');assert.ok(derived.compatibilityReview);const validation=validateSemanticReviewV1(derived.compatibilityReview!,input);assert.equal(validation.status,'passed');assert.equal(validation.reviewerValidationStatus,'calibration_pending');const aggregate=aggregateHybridEvaluationV1(envelope,runDeterministicChecksV1(envelope,input),validation);assert.equal(aggregate.candidateDeliveryStatus,'blocked');assert.equal(aggregate.customerOutput,null);assert.equal(aggregate.shadowOnly,true);
});
