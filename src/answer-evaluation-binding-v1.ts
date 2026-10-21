import {
 buildSemanticReviewInputV1,objectSha256,sha256,
 type HybridEnvelopeV1,type SemanticReviewInputV1,
} from './hybrid-evaluation-v1.js';
import {buildModelReviewRequestV1} from './semantic-review-sources-v1.js';
import {decideReturnV1} from './returns-decision-v1.js';
import {compileResponseContractV17} from './response-contract-v17.js';

/** Offline sample packaging only. Not an evaluator, transport, or Worker route. */
export const ANSWER_EVALUATION_BINDING_VERSION='answer-evaluation-binding-v1' as const;
export type AnswerSampleProvenanceV1={
 questionVersion:string;answerVersion:string;
 answerKind:'model_original'|'ai_reference'|'synthetic_regression';
 sourceArtifact:string;sourceArtifactSha256:string;
};
type Component={version:string;hash:string};
export type BoundAnswerSampleV1={
 version:typeof ANSWER_EVALUATION_BINDING_VERSION;
 evaluationTarget:'answer_compliance_only';factExtractionScored:false;
 envelope:HybridEnvelopeV1;provenance:AnswerSampleProvenanceV1;
 components:Record<'question'|'facts'|'decision'|'contract'|'answer'|'policy',Component>;
 reviewInputHash:string;bindingHash:string;
};
function components(envelope:HybridEnvelopeV1,provenance:AnswerSampleProvenanceV1){return {
 question:{version:provenance.questionVersion,hash:sha256(envelope.question)},
 facts:{version:envelope.facts.version,hash:objectSha256(envelope.facts.value)},
 decision:{version:envelope.decision.version,hash:objectSha256(envelope.decision)},
 contract:{version:envelope.contract.contractVersion,hash:objectSha256(envelope.contract)},
 answer:{version:provenance.answerVersion,hash:sha256(envelope.originalResponse??'')},
 policy:{version:envelope.policy.version,hash:sha256(envelope.policy.text)},
};}
function unsigned(sample:BoundAnswerSampleV1){const {bindingHash,...value}=sample;return value;}

export function validateBoundAnswerSampleV1(sample:BoundAnswerSampleV1):string[]{
 const errors:string[]=[];
 if(sample.version!==ANSWER_EVALUATION_BINDING_VERSION||sample.evaluationTarget!=='answer_compliance_only'||sample.factExtractionScored!==false)errors.push('BINDING_SCOPE');
 if(!/^[a-f0-9]{64}$/.test(sample.provenance.sourceArtifactSha256)||!sample.provenance.sourceArtifact.trim())errors.push('SOURCE_ARTIFACT_PROVENANCE');
 for(const [name,value] of Object.entries(sample.components))if(!value.version?.trim())errors.push(`VERSION_REQUIRED:${name}`);
 if(objectSha256(sample.components)!==objectSha256(components(sample.envelope,sample.provenance)))errors.push('COMPONENT_BINDING');
 if(sample.bindingHash!==objectSha256(unsigned(sample)))errors.push('BINDING_HASH');
 try{
  // Never re-extract facts from the question here. Extraction has its own test target.
  if(objectSha256(sample.envelope.facts.value)!==objectSha256(sample.envelope.decision.facts))errors.push('FACTS_DECISION_MISMATCH');
  if(objectSha256(decideReturnV1(sample.envelope.facts.value))!==objectSha256(sample.envelope.decision))errors.push('DECISION_MISMATCH');
  if(objectSha256(compileResponseContractV17(sample.envelope.question,sample.envelope.decision,sample.envelope.responseMode))!==objectSha256(sample.envelope.contract))errors.push('CONTRACT_MISMATCH');
  const input=buildSemanticReviewInputV1(sample.envelope);
  if(sample.reviewInputHash!==objectSha256(input))errors.push('REVIEW_INPUT_BINDING');
 }catch(error){errors.push('INVALID_BOUND_CONTEXT:'+(error instanceof Error?error.message:String(error)));}
 return errors;
}

export function bindAnswerSampleV1(envelope:HybridEnvelopeV1,provenance:AnswerSampleProvenanceV1):BoundAnswerSampleV1{
 const context=structuredClone(envelope),source=structuredClone(provenance);
 const value={version:ANSWER_EVALUATION_BINDING_VERSION,evaluationTarget:'answer_compliance_only' as const,factExtractionScored:false as const,
  envelope:context,provenance:source,components:components(context,source),reviewInputHash:objectSha256(buildSemanticReviewInputV1(context))};
 const sample={...value,bindingHash:objectSha256(value)};
 const errors=validateBoundAnswerSampleV1(sample);if(errors.length)throw Error(errors.join('; '));return sample;
}

/** Both consumers get the same complete context; reference labels are separate sidecars. */
export function boundAnswerViewsV1(sample:BoundAnswerSampleV1){
 const errors=validateBoundAnswerSampleV1(sample);if(errors.length)throw Error(errors.join('; '));
 const input=buildSemanticReviewInputV1(sample.envelope);
 return {bindingHash:sample.bindingHash,reviewInputHash:sample.reviewInputHash,
  annotationContext:structuredClone(input),reviewerInput:structuredClone(input),
  reviewerRequest:buildModelReviewRequestV1(input)};
}

/** Offline replay guard: an old review's source context must match this entire input. */
export function assertReviewReplayBindingV1(sample:BoundAnswerSampleV1,originalInput:SemanticReviewInputV1){
 const errors=validateBoundAnswerSampleV1(sample);if(errors.length)throw Error(errors.join('; '));
 if(objectSha256(originalInput)!==sample.reviewInputHash)throw Error('REPLAY_SOURCE_CONTEXT_MISMATCH');
 return {mode:'historical_original_object_replay' as const,bindingHash:sample.bindingHash};
}
