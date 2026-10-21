import {z} from 'zod';
import {
 REVIEW_PROMPT_VERSION,REVIEW_RESULT_VERSION,semanticReviewResultSchemaV1,
 type ReviewEvidenceV1,type SemanticReviewInputV1,type SemanticReviewResultV1,
} from './hybrid-evaluation-v1.js';
import {semanticReviewWireSchemaV2,type SemanticReviewWireV2} from './semantic-review-wire-v2.js';

export const SEMANTIC_REVIEW_WIRE_VERSION_V3='semantic-review-wire-v3-candidate' as const;
export const SEMANTIC_REVIEW_WIRE_SCHEMA_NAME_V3='releaseguard_semantic_review_wire_v3' as const;

export const semanticReviewWireDefinitionV3={
 paths:['$','$.reason','$.nextStep'] as const,
 ruleStatuses:['passed','failed','unverifiable'] as const,
 claimStatuses:['allowed','failed','unverifiable'] as const,
 completionStatuses:['completed','timeout','provider_error','truncated','invalid'] as const,
};

const evidenceSchema=z.object({path:z.enum(semanticReviewWireDefinitionV3.paths),quote:z.string().min(1).max(10000)}).strict();
const evidenceArraySchema=z.array(evidenceSchema).max(12);
const ruleResultSchema=z.object({
 ruleId:z.string().min(1).max(160),status:z.enum(semanticReviewWireDefinitionV3.ruleStatuses),reason:z.string().min(1).max(1000),evidence:evidenceArraySchema,
}).strict();
const observationSchema=z.object({reason:z.string().min(1).max(1000),evidence:evidenceArraySchema}).strict();
const extraClaimSchema=observationSchema.extend({status:z.enum(semanticReviewWireDefinitionV3.claimStatuses)}).strict();

export const semanticReviewWireSchemaV3=z.object({
 ruleResults:z.array(ruleResultSchema).min(1).max(100),contradictions:z.array(observationSchema).max(100),
 extraClaims:z.array(extraClaimSchema).max(100),unverifiableItems:z.array(observationSchema).max(100),
 reviewCompletionStatus:z.enum(semanticReviewWireDefinitionV3.completionStatuses),
}).strict();
export type SemanticReviewWireV3=z.infer<typeof semanticReviewWireSchemaV3>;

const text=(description:string,maxLength:number)=>({type:'string',minLength:1,maxLength,description} as const);
const evidenceJsonSchema={type:'object',additionalProperties:false,properties:{
 path:{type:'string',enum:[...semanticReviewWireDefinitionV3.paths],description:'Original response field containing the exact quote.'},
 quote:text('Exact verbatim substring copied from that original response field.',10000),
},required:['path','quote']} as const;
const evidenceArrayJsonSchema={type:'array',items:evidenceJsonSchema,maxItems:12,description:'Zero or more exact quotes. Character positions are derived locally.'} as const;
const observationProperties={reason:text('Short business reason. Explain missing or uncertain content in this field.',1000),evidence:evidenceArrayJsonSchema} as const;

/** Provider-visible structural schema. Every object is closed and every field is required. */
export const SEMANTIC_REVIEW_WIRE_JSON_SCHEMA_V3={
 type:'object',additionalProperties:false,properties:{
  ruleResults:{type:'array',minItems:1,maxItems:100,items:{type:'object',additionalProperties:false,properties:{
   ruleId:text('One supplied applicable rule identifier, copied exactly.',160),status:{type:'string',enum:[...semanticReviewWireDefinitionV3.ruleStatuses]},
   reason:text('Short business judgment. For missing required content, explain the omission here.',1000),evidence:evidenceArrayJsonSchema,
  },required:['ruleId','status','reason','evidence']}},
  contradictions:{type:'array',maxItems:100,items:{type:'object',additionalProperties:false,properties:observationProperties,required:['reason','evidence']}},
  extraClaims:{type:'array',maxItems:100,items:{type:'object',additionalProperties:false,properties:{...observationProperties,status:{type:'string',enum:[...semanticReviewWireDefinitionV3.claimStatuses]}},required:['status','reason','evidence']}},
  unverifiableItems:{type:'array',maxItems:100,items:{type:'object',additionalProperties:false,properties:observationProperties,required:['reason','evidence']}},
  reviewCompletionStatus:{type:'string',enum:[...semanticReviewWireDefinitionV3.completionStatuses]},
 },required:['ruleResults','contradictions','extraClaims','unverifiableItems','reviewCompletionStatus'],
} as const;

/** Explicit local constraints not expressible in the provider's supported structural subset. */
export const SEMANTIC_REVIEW_LOCAL_CONSTRAINTS_V3=[
 {constraintId:'RULE_SET_EXACT',rule:'Each applicable rule appears exactly once; unknown, missing and duplicate rule IDs fail validation.'},
 {constraintId:'EVIDENCE_FRAGMENT_UNIQUE',rule:'The same path and quote cannot be repeated inside one judgment.'},
 {constraintId:'EVIDENCE_EXACT_SINGLE_MATCH',rule:'Each quote must occur exactly once in the selected original field; zero or multiple matches fail.'},
 {constraintId:'REQUIRED_PASSED_NEEDS_EVIDENCE',rule:'A required rule marked passed must include at least one valid quote.'},
 {constraintId:'REQUIRED_FAILED_MAY_OMIT_EVIDENCE',rule:'A required rule marked failed may have no quote when content is missing; reason carries the omission explanation.'},
 {constraintId:'PROHIBITED_PASSED_MAY_OMIT_EVIDENCE',rule:'A prohibited rule marked passed may have no violating quote; reason records the inspection conclusion.'},
 {constraintId:'PROHIBITED_FAILED_NEEDS_EVIDENCE',rule:'A prohibited rule marked failed must include at least one violating quote.'},
 {constraintId:'CONTRADICTION_NEEDS_EVIDENCE',rule:'Every explicit contradiction must include at least one exact quote.'},
 {constraintId:'FAILED_EXTRA_CLAIM_NEEDS_EVIDENCE',rule:'An extra claim marked failed must include at least one exact quote.'},
 {constraintId:'UNVERIFIABLE_BLOCKS',rule:'Unverifiable remains a model judgment with its reason and cannot be converted to passed by the program.'},
 {constraintId:'COMPLETION_REQUIRED',rule:'Only reviewCompletionStatus=completed passes protocol validation.'},
 {constraintId:'MODEL_JUDGMENT_IMMUTABLE',rule:'Local derivation may locate quotes and add compatibility metadata but never changes status, reason or quote.'},
] as const;

export type LocatedEvidenceV3=ReviewEvidenceV1&{matchCount:1};
export type DerivedRuleResultV3=Omit<SemanticReviewWireV3['ruleResults'][number],'evidence'>&{evidence:LocatedEvidenceV3[]};
export type DerivedObservationV3={reason:string;evidence:LocatedEvidenceV3[]};
export type DerivedExtraClaimV3=DerivedObservationV3&{status:'allowed'|'failed'|'unverifiable'};
export type DerivedSemanticReviewV3={
 version:typeof SEMANTIC_REVIEW_WIRE_VERSION_V3;status:'passed'|'failed';errors:string[];
 ruleResults:DerivedRuleResultV3[];contradictions:DerivedObservationV3[];extraClaims:DerivedExtraClaimV3[];unverifiableItems:DerivedObservationV3[];
 reviewCompletionStatus:SemanticReviewWireV3['reviewCompletionStatus'];compatibilityReview:SemanticReviewResultV1|null;
};

function sourceAt(input:SemanticReviewInputV1,path:SemanticReviewWireV3['ruleResults'][number]['evidence'][number]['path']){
 if(path==='$')return input.originalResponse;
 try{const value=JSON.parse(input.originalResponse),key=path.slice(2);return typeof value?.[key]==='string'?value[key]:null;}catch{return null;}
}
function locate(input:SemanticReviewInputV1,fragment:z.infer<typeof evidenceSchema>,label:string,errors:string[]):LocatedEvidenceV3|null{
 const source=sourceAt(input,fragment.path);if(source===null){errors.push(`${label}: field ${fragment.path} is unavailable for exact evidence lookup`);return null;}
 const offsets:number[]=[];let cursor=0;while(cursor<=source.length){const found=source.indexOf(fragment.quote,cursor);if(found<0)break;offsets.push(found);cursor=found+1;}
 if(offsets.length===0){errors.push(`${label}: quote not found exactly in ${fragment.path}`);return null;}
 if(offsets.length>1){errors.push(`${label}: quote is ambiguous in ${fragment.path} (${offsets.length} exact matches)`);return null;}
 const start=offsets[0];return {source:fragment.path==='$'?(input.responseMode==='plain'?'plain':'raw_response'):'json_field',path:fragment.path,coordinateUnit:'utf16-code-unit',start,end:start+fragment.quote.length,quote:fragment.quote,matchCount:1};
}
function locateAll(input:SemanticReviewInputV1,fragments:z.infer<typeof evidenceSchema>[],label:string,errors:string[]){
 const seen=new Set<string>(),located:LocatedEvidenceV3[]=[];
 for(let index=0;index<fragments.length;index++){
  const key=fragments[index].path+'\u0000'+fragments[index].quote;if(seen.has(key)){errors.push(`${label}.evidence[${index}]: duplicate evidence fragment`);continue;}seen.add(key);
  const item=locate(input,fragments[index],`${label}.evidence[${index}]`,errors);if(item)located.push(item);
 }
 return located;
}
function firstCompatibilityEvidence(item:LocatedEvidenceV3|undefined):ReviewEvidenceV1|null{return item?{source:item.source,path:item.path,coordinateUnit:item.coordinateUnit,start:item.start,end:item.end,quote:item.quote}:null;}

export function deriveSemanticReviewV3(raw:unknown,input:SemanticReviewInputV1,metadata:{reviewId:string;reviewerIdentity:string;modelId:string;startedAt:string;finishedAt:string;sourceMetadata:Record<string,unknown>}):DerivedSemanticReviewV3{
 const parsed=semanticReviewWireSchemaV3.safeParse(raw);
 if(!parsed.success)return {version:SEMANTIC_REVIEW_WIRE_VERSION_V3,status:'failed',errors:parsed.error.issues.map(issue=>`${issue.path.join('.')}: ${issue.message}`),ruleResults:[],contradictions:[],extraClaims:[],unverifiableItems:[],reviewCompletionStatus:'invalid',compatibilityReview:null};
 const wire=parsed.data,errors:string[]=[],expected=new Map(input.applicableRules.map(rule=>[rule.ruleId,rule])),seen=new Set<string>();
 const ruleResults:DerivedRuleResultV3[]=wire.ruleResults.map((item,index)=>{
  if(seen.has(item.ruleId))errors.push(`ruleResults[${index}]: duplicate ruleId ${item.ruleId}`);seen.add(item.ruleId);
  const rule=expected.get(item.ruleId);if(!rule)errors.push(`ruleResults[${index}]: unknown or inapplicable ruleId ${item.ruleId}`);
  const evidence=locateAll(input,item.evidence,`ruleResults[${index}]`,errors);
  if(rule?.expectation==='required'&&item.status==='passed'&&item.evidence.length===0)errors.push(`ruleResults[${index}]: required passed rule ${item.ruleId} needs exact evidence`);
  if(rule?.expectation==='prohibited'&&item.status==='failed'&&item.evidence.length===0)errors.push(`ruleResults[${index}]: prohibited failed rule ${item.ruleId} needs exact violating evidence`);
  return {...item,evidence};
 });
 for(const ruleId of expected.keys())if(!seen.has(ruleId))errors.push(`Missing applicable ruleId ${ruleId}`);
 const observations=(items:SemanticReviewWireV3['contradictions']|SemanticReviewWireV3['unverifiableItems'],group:string,needsEvidence:boolean)=>items.map((item,index)=>{const evidence=locateAll(input,item.evidence,`${group}[${index}]`,errors);if(needsEvidence&&item.evidence.length===0)errors.push(`${group}[${index}]: explicit contradiction needs exact evidence`);return {...item,evidence};});
 const contradictions=observations(wire.contradictions,'contradictions',true),unverifiableItems=observations(wire.unverifiableItems,'unverifiableItems',false);
 const extraClaims:DerivedExtraClaimV3[]=wire.extraClaims.map((item,index)=>{const evidence=locateAll(input,item.evidence,`extraClaims[${index}]`,errors);if(item.status==='failed'&&item.evidence.length===0)errors.push(`extraClaims[${index}]: failed extra claim needs exact evidence`);return {...item,evidence};});
 if(wire.reviewCompletionStatus!=='completed')errors.push(`Review completion is ${wire.reviewCompletionStatus}`);
 const payload={
  reviewId:metadata.reviewId,reviewSchemaVersion:REVIEW_RESULT_VERSION,reviewerType:'model_review' as const,reviewerIdentity:metadata.reviewerIdentity,modelId:metadata.modelId,reviewPromptVersion:REVIEW_PROMPT_VERSION,
  policyVersion:input.policy.version,policyHash:input.policy.hash,contractVersion:input.contract.version,contractHash:input.contract.hash,factsVersion:input.facts.version,factsHash:input.facts.hash,originalResponseHash:input.originalResponseHash,caseId:input.caseId,runId:input.runId,responseId:input.responseId,startedAt:metadata.startedAt,finishedAt:metadata.finishedAt,
  ruleResults:ruleResults.map(item=>({ruleId:item.ruleId,status:item.status,reason:item.reason,evidence:firstCompatibilityEvidence(item.evidence[0]),...(item.evidence.length===0?{missingReason:item.reason}:{})})),
  contradictions:contradictions.map(item=>({description:item.reason,evidence:firstCompatibilityEvidence(item.evidence[0]),...(item.evidence.length===0?{missingReason:item.reason}:{})})),
  extraClaims:extraClaims.map(item=>({description:item.reason,status:item.status,evidence:firstCompatibilityEvidence(item.evidence[0]),...(item.evidence.length===0?{missingReason:item.reason}:{})})),
  unverifiableItems:unverifiableItems.map(item=>({description:item.reason,evidence:firstCompatibilityEvidence(item.evidence[0]),...(item.evidence.length===0?{missingReason:item.reason}:{})})),
  reviewCompletionStatus:wire.reviewCompletionStatus,sourceMetadata:{...metadata.sourceMetadata,wireVersion:SEMANTIC_REVIEW_WIRE_VERSION_V3,compatibilityMissingReasonDerivedFromReason:true,allEvidencePreserved:true},
 };
 const compatibility=semanticReviewResultSchemaV1.safeParse(payload);if(!compatibility.success)errors.push(...compatibility.error.issues.map(issue=>`compatibilityReview.${issue.path.join('.')}: ${issue.message}`));
 return {version:SEMANTIC_REVIEW_WIRE_VERSION_V3,status:errors.length?'failed':'passed',errors,ruleResults,contradictions,extraClaims,unverifiableItems,reviewCompletionStatus:wire.reviewCompletionStatus,compatibilityReview:errors.length||!compatibility.success?null:compatibility.data};
}

export type LegacyMissingReasonMetadataV3={path:string;value:string;evidenceCount:number};
export type LegacyCompatibilityDiagnosisV3={
 version:'semantic-review-wire-v2-to-v3-diagnosis';candidateWire:SemanticReviewWireV3;legacyMissingReasonMetadata:LegacyMissingReasonMetadataV3[];
 contentConflicts:{path:string;code:'LEGACY_MISSING_REASON_WITH_EVIDENCE';detail:string}[];separateMissingExplanations:{path:string;detail:string}[];
 candidateDerivation:DerivedSemanticReviewV3;counts:{legacyMissingReasonValues:number;contentConflicts:number;separateMissingExplanations:number};
};

/** Diagnostic adapter only. It never overwrites the v2 raw record or changes a historical score. */
export function diagnoseLegacyWireV2ForV3(raw:unknown,input:SemanticReviewInputV1,metadata:{reviewId:string;reviewerIdentity:string;modelId:string;startedAt:string;finishedAt:string;sourceMetadata:Record<string,unknown>}):LegacyCompatibilityDiagnosisV3{
 const legacy=semanticReviewWireSchemaV2.parse(raw),legacyMissingReasonMetadata:LegacyMissingReasonMetadataV3[]=[],contentConflicts:LegacyCompatibilityDiagnosisV3['contentConflicts']=[],separateMissingExplanations:LegacyCompatibilityDiagnosisV3['separateMissingExplanations']=[];
 const preserve=(path:string,item:{evidenceFragments:{path:string;quote:string}[];missingReason:string|null})=>{if(item.missingReason===null)return;legacyMissingReasonMetadata.push({path,value:item.missingReason,evidenceCount:item.evidenceFragments.length});if(item.evidenceFragments.length>0)contentConflicts.push({path,code:'LEGACY_MISSING_REASON_WITH_EVIDENCE',detail:'Legacy output supplied both exact evidence and a separate missingReason.'});else separateMissingExplanations.push({path,detail:'Legacy missingReason is preserved as compatibility metadata; it is not deleted or represented as a new-model reason.'});};
 legacy.ruleResults.forEach((item,index)=>preserve(`ruleResults[${index}].missingReason`,item));legacy.contradictions.forEach((item,index)=>preserve(`contradictions[${index}].missingReason`,item));legacy.extraClaims.forEach((item,index)=>preserve(`extraClaims[${index}].missingReason`,item));legacy.unverifiableItems.forEach((item,index)=>preserve(`unverifiableItems[${index}].missingReason`,item));
 const mapObservation=(item:SemanticReviewWireV2['contradictions'][number])=>({reason:item.description,evidence:item.evidenceFragments});
 const candidateWire:SemanticReviewWireV3={ruleResults:legacy.ruleResults.map(item=>({ruleId:item.ruleId,status:item.status,reason:item.reason,evidence:item.evidenceFragments})),contradictions:legacy.contradictions.map(mapObservation),extraClaims:legacy.extraClaims.map(item=>({status:item.status,...mapObservation(item)})),unverifiableItems:legacy.unverifiableItems.map(mapObservation),reviewCompletionStatus:legacy.reviewCompletionStatus};
 const candidateDerivation=deriveSemanticReviewV3(candidateWire,input,{...metadata,sourceMetadata:{...metadata.sourceMetadata,compatibilityDiagnosisOnly:true,legacyMissingReasonMetadata,contentConflicts,separateMissingExplanations}});
 return {version:'semantic-review-wire-v2-to-v3-diagnosis',candidateWire,legacyMissingReasonMetadata,contentConflicts,separateMissingExplanations,candidateDerivation,counts:{legacyMissingReasonValues:legacyMissingReasonMetadata.length,contentConflicts:contentConflicts.length,separateMissingExplanations:separateMissingExplanations.length}};
}
