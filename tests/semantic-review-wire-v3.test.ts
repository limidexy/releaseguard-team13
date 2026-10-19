import test from 'node:test';
import assert from 'node:assert/strict';
import {aggregateHybridEvaluationV1,buildSemanticReviewInputV1,runDeterministicChecksV1,validateSemanticReviewV1,type HybridEnvelopeV1,type SemanticReviewInputV1} from '../src/hybrid-evaluation-v1.js';
import {deriveSemanticReviewV3,SEMANTIC_REVIEW_LOCAL_CONSTRAINTS_V3,semanticReviewWireSchemaV3,type SemanticReviewWireV3} from '../src/semantic-review-wire-v3.js';
import {decisionForQuestionV1} from '../src/returns-decision-v1.js';
import {compileResponseContractV17} from '../src/response-contract-v17.js';

const policy='Standard returns require an unused item within 30 days of purchase with a receipt. Missing facts stay unknown. Unsupported external actions and data-handling promises are prohibited.';
function fixture(originalResponse='Unique evidence 😀. A standard return requires an unused item within 30 days of purchase and a receipt. The purchase date is unknown, so eligibility cannot yet be determined. When was it purchased, is it unused, and is a receipt available?',responseMode:'plain'|'json'='plain'){
 const question='When can I return an unused item?',decision=decisionForQuestionV1(question),contract=compileResponseContractV17(question,decision,responseMode);
 const envelope:HybridEnvelopeV1={caseId:'wire-v3-case',runId:'wire-v3-run',responseId:'wire-v3-response',question,originalResponse,responseComplete:true,responseMode,policy:{version:'wire-policy-v1',text:policy},facts:{version:'returns-facts-v1',sourceId:'question-parser-v1',value:decision.facts},decision,contract};
 return {envelope,input:buildSemanticReviewInputV1(envelope)};
}
function validWire(input:SemanticReviewInputV1,quote='Unique evidence 😀'):SemanticReviewWireV3{return {ruleResults:input.applicableRules.map(rule=>({ruleId:rule.ruleId,status:'passed',reason:rule.expectation==='required'?'The required meaning is present.':'The answer was checked and contains no prohibited meaning.',evidence:rule.expectation==='required'?[{path:'$',quote}]:[]})),contradictions:[],extraClaims:[],unverifiableItems:[],reviewCompletionStatus:'completed'};}
function metadata(){return {reviewId:'review/wire-v3-test',reviewerIdentity:'model/openai-gpt-oss-120b',modelId:'openai/gpt-oss-120b',startedAt:'2026-10-18T01:00:00.000Z',finishedAt:'2026-10-18T01:00:01.000Z',sourceMetadata:{executionMode:'offline'}};}

test('v3 removes missingReason and exposes every additional local constraint',()=>{
 const {input}=fixture(),wire:any=validWire(input);wire.ruleResults[0].missingReason='legacy field';
 assert.equal(semanticReviewWireSchemaV3.safeParse(wire).success,false);
 const ids=new Set(SEMANTIC_REVIEW_LOCAL_CONSTRAINTS_V3.map(item=>item.constraintId));
 for(const id of ['RULE_SET_EXACT','EVIDENCE_FRAGMENT_UNIQUE','EVIDENCE_EXACT_SINGLE_MATCH','REQUIRED_PASSED_NEEDS_EVIDENCE','REQUIRED_FAILED_MAY_OMIT_EVIDENCE','PROHIBITED_PASSED_MAY_OMIT_EVIDENCE','PROHIBITED_FAILED_NEEDS_EVIDENCE','CONTRADICTION_NEEDS_EVIDENCE','FAILED_EXTRA_CLAIM_NEEDS_EVIDENCE','UNVERIFIABLE_BLOCKS','COMPLETION_REQUIRED','MODEL_JUDGMENT_IMMUTABLE'])assert.ok(ids.has(id as any));
});

test('required and prohibited rules implement the declared evidence matrix',()=>{
 const {input}=fixture(),required=input.applicableRules.findIndex(rule=>rule.expectation==='required'),prohibited=input.applicableRules.findIndex(rule=>rule.expectation==='prohibited');assert.ok(required>=0);assert.ok(prohibited>=0);
 const missing=validWire(input);missing.ruleResults[required]={...missing.ruleResults[required],status:'failed',reason:'The required statement is absent.',evidence:[]};assert.equal(deriveSemanticReviewV3(missing,input,metadata()).status,'passed');
 const requiredPass=validWire(input);requiredPass.ruleResults[required]={...requiredPass.ruleResults[required],evidence:[]};assert.ok(deriveSemanticReviewV3(requiredPass,input,metadata()).errors.some(error=>error.includes('required passed')));
 const prohibitedPass=validWire(input);prohibitedPass.ruleResults[prohibited]={...prohibitedPass.ruleResults[prohibited],status:'passed',reason:'Checked; no forbidden action claim is present.',evidence:[]};assert.equal(deriveSemanticReviewV3(prohibitedPass,input,metadata()).status,'passed');
 const prohibitedFail=validWire(input);prohibitedFail.ruleResults[prohibited]={...prohibitedFail.ruleResults[prohibited],status:'failed',reason:'A forbidden action claim is present.',evidence:[]};assert.ok(deriveSemanticReviewV3(prohibitedFail,input,metadata()).errors.some(error=>error.includes('prohibited failed')));
});

test('unverifiable remains unchanged and cannot activate formal delivery',()=>{
 const {input,envelope}=fixture(),wire=validWire(input),index=input.applicableRules.findIndex(rule=>rule.expectation==='required');wire.ruleResults[index]={...wire.ruleResults[index],status:'unverifiable',reason:'The wording is not reliably decidable.',evidence:[]};wire.unverifiableItems=[{reason:'The wording is not reliably decidable.',evidence:[]}];
 const derived=deriveSemanticReviewV3(wire,input,metadata());assert.equal(derived.status,'passed');assert.equal(derived.ruleResults[index].status,'unverifiable');assert.ok(derived.compatibilityReview);
 const validation=validateSemanticReviewV1(derived.compatibilityReview!,input);assert.equal(validation.status,'passed');const aggregate=aggregateHybridEvaluationV1(envelope,runDeterministicChecksV1(envelope,input),validation);assert.equal(aggregate.candidateDeliveryStatus,'blocked');assert.equal(aggregate.customerOutput,null);assert.equal(aggregate.shadowOnly,true);
});

test('explicit contradiction and failed extra claim require evidence',()=>{
 const {input}=fixture('Unique evidence 😀. Contradictory promise.');
 const contradiction=validWire(input);contradiction.contradictions=[{reason:'The answer contradicts itself.',evidence:[]}];assert.ok(deriveSemanticReviewV3(contradiction,input,metadata()).errors.some(error=>error.includes('contradiction')));
 const claim=validWire(input);claim.extraClaims=[{status:'failed',reason:'Unsupported promise.',evidence:[]}];assert.ok(deriveSemanticReviewV3(claim,input,metadata()).errors.some(error=>error.includes('extra claim')));
 const supported=validWire(input);supported.contradictions=[{reason:'The answer contradicts itself.',evidence:[{path:'$',quote:'Contradictory promise.'}]}];supported.extraClaims=[{status:'failed',reason:'Unsupported promise.',evidence:[{path:'$',quote:'Contradictory promise.'}]}];assert.equal(deriveSemanticReviewV3(supported,input,metadata()).status,'passed');
});

test('multiple evidence is located mechanically without changing status, reason or quotes',()=>{
 const {input}=fixture('Unique evidence 😀. Second exact clause.'),wire=validWire(input),index=input.applicableRules.findIndex(rule=>rule.expectation==='required');const reason='Model keeps this exact judgment.';wire.ruleResults[index]={...wire.ruleResults[index],status:'failed',reason,evidence:[{path:'$',quote:'Unique evidence 😀'},{path:'$',quote:'Second exact clause'}]};
 const derived=deriveSemanticReviewV3(wire,input,metadata()),row=derived.ruleResults[index];assert.equal(derived.status,'passed');assert.equal(row.status,'failed');assert.equal(row.reason,reason);assert.deepEqual(row.evidence.map(item=>item.quote),wire.ruleResults[index].evidence.map(item=>item.quote));for(const evidence of row.evidence)assert.equal(input.originalResponse.slice(evidence.start,evidence.end),evidence.quote);
});

test('duplicate, absent and ambiguous evidence are rejected',()=>{
 const cases=[{answer:'Unique evidence 😀.',quotes:['Unique evidence 😀','Unique evidence 😀'],message:'duplicate evidence'},{answer:'Unique evidence 😀.',quotes:['absent'],message:'not found'},{answer:'repeat repeat',quotes:['repeat'],message:'ambiguous'}];
 for(const item of cases){const {input}=fixture(item.answer),wire=validWire(input,item.quotes[0]),index=input.applicableRules.findIndex(rule=>rule.expectation==='required');wire.ruleResults[index].evidence=item.quotes.map(quote=>({path:'$',quote}));const derived=deriveSemanticReviewV3(wire,input,metadata());assert.equal(derived.status,'failed');assert.ok(derived.errors.some(error=>error.includes(item.message)),derived.errors.join('; '));}
});

test('JSON field evidence handles escaping and Unicode while raw or missing fields fail',()=>{
 const reason='He said "keep it" 😀 — exact.',originalResponse=JSON.stringify({eligible:false,reason,nextStep:'Ask once.'}),{input}=fixture(originalResponse,'json'),wire=validWire(input,reason);
 for(const row of wire.ruleResults)if(row.evidence.length)row.evidence=[{path:'$.reason',quote:reason}];const derived=deriveSemanticReviewV3(wire,input,metadata());assert.equal(derived.status,'passed');const evidence=derived.ruleResults.find(row=>row.evidence.length)!.evidence[0];assert.equal(evidence.source,'json_field');assert.equal(reason.slice(evidence.start,evidence.end),reason);
 const unavailable=validWire(input,reason);for(const row of unavailable.ruleResults)if(row.evidence.length)row.evidence=[{path:'$.nextStep',quote:reason}];assert.ok(deriveSemanticReviewV3(unavailable,input,metadata()).errors.some(error=>error.includes('not found')));
});

test('missing, duplicate and unknown rule IDs and incomplete status fail locally',()=>{
 const {input}=fixture();const missing=validWire(input);missing.ruleResults.pop();assert.ok(deriveSemanticReviewV3(missing,input,metadata()).errors.some(error=>error.startsWith('Missing applicable ruleId')));
 const duplicate=validWire(input);duplicate.ruleResults.push({...duplicate.ruleResults[0]});assert.ok(deriveSemanticReviewV3(duplicate,input,metadata()).errors.some(error=>error.includes('duplicate ruleId')));
 const unknown=validWire(input);unknown.ruleResults[0]={...unknown.ruleResults[0],ruleId:'UNKNOWN_RULE'};assert.ok(deriveSemanticReviewV3(unknown,input,metadata()).errors.some(error=>error.includes('unknown or inapplicable')));
 const incomplete=validWire(input);incomplete.reviewCompletionStatus='truncated';assert.ok(deriveSemanticReviewV3(incomplete,input,metadata()).errors.some(error=>error.includes('Review completion')));
});
