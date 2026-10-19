import {z} from 'zod';
import {
 REVIEW_PROMPT_VERSION,REVIEW_RESULT_VERSION,semanticReviewResultSchemaV1,
 type ReviewEvidenceV1,type SemanticReviewInputV1,type SemanticReviewResultV1,
} from './hybrid-evaluation-v1.js';

export const SEMANTIC_REVIEW_WIRE_VERSION_V2='semantic-review-wire-v2' as const;
export const SEMANTIC_REVIEW_WIRE_SCHEMA_NAME_V2='releaseguard_semantic_review_wire_v2' as const;

export const semanticReviewWireDefinitionV2={
 paths:['$','$.reason','$.nextStep'] as const,
 ruleStatuses:['passed','failed','unverifiable'] as const,
 claimStatuses:['allowed','failed','unverifiable'] as const,
 completionStatuses:['completed','timeout','provider_error','truncated','invalid'] as const,
};

const evidenceFragmentSchema=z.object({
 path:z.enum(semanticReviewWireDefinitionV2.paths),
 quote:z.string().min(1).max(10000),
}).strict();

const ruleResultSchema=z.object({
 ruleId:z.string().min(1).max(160),
 status:z.enum(semanticReviewWireDefinitionV2.ruleStatuses),
 reason:z.string().min(1).max(1000),
 evidenceFragments:z.array(evidenceFragmentSchema).max(12),
 missingReason:z.string().min(1).max(500).nullable(),
}).strict();

const observationSchema=z.object({
 description:z.string().min(1).max(1000),
 evidenceFragments:z.array(evidenceFragmentSchema).max(12),
 missingReason:z.string().min(1).max(500).nullable(),
}).strict();

const extraClaimSchema=observationSchema.extend({
 status:z.enum(semanticReviewWireDefinitionV2.claimStatuses),
}).strict();

export const semanticReviewWireSchemaV2=z.object({
 ruleResults:z.array(ruleResultSchema).min(1).max(100),
 contradictions:z.array(observationSchema).max(100),
 extraClaims:z.array(extraClaimSchema).max(100),
 unverifiableItems:z.array(observationSchema).max(100),
 reviewCompletionStatus:z.enum(semanticReviewWireDefinitionV2.completionStatuses),
}).strict();
export type SemanticReviewWireV2=z.infer<typeof semanticReviewWireSchemaV2>;

const stringSchema=(description:string,maxLength:number)=>({type:'string',minLength:1,maxLength,description} as const);
const fragmentJsonSchema={
 type:'object',additionalProperties:false,
 properties:{
  path:{type:'string',enum:[...semanticReviewWireDefinitionV2.paths],description:'Exact original response field containing the quote.'},
  quote:stringSchema('Exact verbatim substring copied from the selected original response field.',10000),
 },
 required:['path','quote'],
} as const;
const fragmentArrayJsonSchema={type:'array',items:fragmentJsonSchema,maxItems:12} as const;
const missingReasonJsonSchema={type:['string','null'],minLength:1,maxLength:500,description:'For missing required content, explain what is absent. Otherwise use null; a prohibited passed rule may rely on its explicit reason.'} as const;
const observationProperties={
 description:stringSchema('Short business-level observation.',1000),
 evidenceFragments:fragmentArrayJsonSchema,
 missingReason:missingReasonJsonSchema,
} as const;

/** The provider schema and the local Zod schema above are generated from the same enums and field definition. */
export const SEMANTIC_REVIEW_WIRE_JSON_SCHEMA_V2={
 type:'object',additionalProperties:false,
 properties:{
  ruleResults:{type:'array',minItems:1,maxItems:100,items:{
   type:'object',additionalProperties:false,
   properties:{
    ruleId:stringSchema('One supplied applicable rule identifier, copied exactly.',160),
    status:{type:'string',enum:[...semanticReviewWireDefinitionV2.ruleStatuses]},
    reason:stringSchema('Short business reason for the judgment.',1000),
    evidenceFragments:fragmentArrayJsonSchema,
    missingReason:missingReasonJsonSchema,
   },
   required:['ruleId','status','reason','evidenceFragments','missingReason'],
  }},
  contradictions:{type:'array',maxItems:100,items:{type:'object',additionalProperties:false,properties:observationProperties,required:['description','evidenceFragments','missingReason']}},
  extraClaims:{type:'array',maxItems:100,items:{
   type:'object',additionalProperties:false,
   properties:{...observationProperties,status:{type:'string',enum:[...semanticReviewWireDefinitionV2.claimStatuses]}},
   required:['description','evidenceFragments','missingReason','status'],
  }},
  unverifiableItems:{type:'array',maxItems:100,items:{type:'object',additionalProperties:false,properties:observationProperties,required:['description','evidenceFragments','missingReason']}},
  reviewCompletionStatus:{type:'string',enum:[...semanticReviewWireDefinitionV2.completionStatuses]},
 },
 required:['ruleResults','contradictions','extraClaims','unverifiableItems','reviewCompletionStatus'],
} as const;

export type LocatedEvidenceFragmentV2=ReviewEvidenceV1&{matchCount:1};
export type DerivedRuleResultV2=Omit<SemanticReviewWireV2['ruleResults'][number],'evidenceFragments'>&{evidenceFragments:LocatedEvidenceFragmentV2[]};
export type DerivedObservationV2={description:string;evidenceFragments:LocatedEvidenceFragmentV2[];missingReason:string|null};
export type DerivedExtraClaimV2=DerivedObservationV2&{status:'allowed'|'failed'|'unverifiable'};
export type DerivedSemanticReviewV2={
 version:'derived-semantic-review-v2';status:'passed'|'failed';errors:string[];
 ruleResults:DerivedRuleResultV2[];contradictions:DerivedObservationV2[];extraClaims:DerivedExtraClaimV2[];unverifiableItems:DerivedObservationV2[];
 reviewCompletionStatus:SemanticReviewWireV2['reviewCompletionStatus'];compatibilityReview:SemanticReviewResultV1|null;
};

function textAtPath(input:SemanticReviewInputV1,path:SemanticReviewWireV2['ruleResults'][number]['evidenceFragments'][number]['path']){
 if(path==='$')return input.originalResponse;
 try{const value=JSON.parse(input.originalResponse),key=path.slice(2);return typeof value?.[key]==='string'?value[key]:null;}catch{return null;}
}

function locateFragment(input:SemanticReviewInputV1,fragment:z.infer<typeof evidenceFragmentSchema>,label:string,errors:string[]):LocatedEvidenceFragmentV2|null{
 const sourceText=textAtPath(input,fragment.path);
 if(sourceText===null){errors.push(`${label}: field ${fragment.path} is unavailable for exact evidence lookup`);return null;}
 const offsets:number[]=[];let cursor=0;
 while(cursor<=sourceText.length){const found=sourceText.indexOf(fragment.quote,cursor);if(found<0)break;offsets.push(found);cursor=found+1;}
 if(offsets.length===0){errors.push(`${label}: quote not found exactly in ${fragment.path}`);return null;}
 if(offsets.length>1){errors.push(`${label}: quote is ambiguous in ${fragment.path} (${offsets.length} exact matches)`);return null;}
 const start=offsets[0];
 return {source:fragment.path==='$'?(input.responseMode==='plain'?'plain':'raw_response'):'json_field',path:fragment.path,coordinateUnit:'utf16-code-unit',start,end:start+fragment.quote.length,quote:fragment.quote,matchCount:1};
}

function locateAll(input:SemanticReviewInputV1,fragments:z.infer<typeof evidenceFragmentSchema>[],label:string,errors:string[]){
 const located:LocatedEvidenceFragmentV2[]=[];
 for(let index=0;index<fragments.length;index++){const item=locateFragment(input,fragments[index],`${label}.evidenceFragments[${index}]`,errors);if(item)located.push(item);}
 return located;
}

export function deriveSemanticReviewV2(raw:unknown,input:SemanticReviewInputV1,metadata:{
 reviewId:string;reviewerIdentity:string;modelId:string;startedAt:string;finishedAt:string;sourceMetadata:Record<string,unknown>;
}):DerivedSemanticReviewV2{
 const parsed=semanticReviewWireSchemaV2.safeParse(raw);
 if(!parsed.success)return {version:'derived-semantic-review-v2',status:'failed',errors:parsed.error.issues.map(issue=>`${issue.path.join('.')}: ${issue.message}`),ruleResults:[],contradictions:[],extraClaims:[],unverifiableItems:[],reviewCompletionStatus:'invalid',compatibilityReview:null};
 const wire=parsed.data,errors:string[]=[];
 const expected=new Map(input.applicableRules.map(rule=>[rule.ruleId,rule])),seen=new Set<string>();
 const ruleResults:DerivedRuleResultV2[]=wire.ruleResults.map((item,index)=>{
  if(seen.has(item.ruleId))errors.push(`ruleResults[${index}]: duplicate ruleId ${item.ruleId}`);seen.add(item.ruleId);
  const rule=expected.get(item.ruleId);if(!rule)errors.push(`ruleResults[${index}]: unknown or inapplicable ruleId ${item.ruleId}`);
  const evidenceFragments=locateAll(input,item.evidenceFragments,`ruleResults[${index}]`,errors);
  if(item.evidenceFragments.length===0&&item.missingReason===null&&!(rule?.expectation==='prohibited'&&item.status==='passed'))errors.push(`ruleResults[${index}]: empty evidence requires missingReason unless a prohibited rule passed with an explicit reason`);
  if(item.evidenceFragments.length>0&&item.missingReason!==null)errors.push(`ruleResults[${index}]: missingReason must be null when evidence is supplied`);
  if(rule?.expectation==='required'&&item.status==='passed'&&item.evidenceFragments.length===0)errors.push(`ruleResults[${index}]: required passed rule ${item.ruleId} needs exact evidence`);
  if(rule?.expectation==='prohibited'&&item.status==='failed'&&item.evidenceFragments.length===0)errors.push(`ruleResults[${index}]: prohibited failed rule ${item.ruleId} needs exact violating evidence`);
  return {...item,evidenceFragments};
 });
 for(const ruleId of expected.keys())if(!seen.has(ruleId))errors.push(`Missing applicable ruleId ${ruleId}`);
 const locateObservations=(items:SemanticReviewWireV2['contradictions'],group:string)=>items.map((item,index)=>{
  const evidenceFragments=locateAll(input,item.evidenceFragments,`${group}[${index}]`,errors);
  if(item.evidenceFragments.length===0&&item.missingReason===null)errors.push(`${group}[${index}]: empty evidence requires missingReason`);
  if(item.evidenceFragments.length>0&&item.missingReason!==null)errors.push(`${group}[${index}]: missingReason must be null when evidence is supplied`);
  return {...item,evidenceFragments};
 });
 const contradictions=locateObservations(wire.contradictions,'contradictions');
 const unverifiableItems=locateObservations(wire.unverifiableItems,'unverifiableItems');
 const extraClaims=wire.extraClaims.map((item,index)=>{
  const evidenceFragments=locateAll(input,item.evidenceFragments,`extraClaims[${index}]`,errors);
  if(item.evidenceFragments.length===0&&item.missingReason===null)errors.push(`extraClaims[${index}]: empty evidence requires missingReason`);
  if(item.evidenceFragments.length>0&&item.missingReason!==null)errors.push(`extraClaims[${index}]: missingReason must be null when evidence is supplied`);
  if(item.status==='failed'&&item.evidenceFragments.length===0)errors.push(`extraClaims[${index}]: failed extra claim needs exact evidence`);
  return {...item,evidenceFragments};
 });
 if(wire.reviewCompletionStatus!=='completed')errors.push(`Review completion is ${wire.reviewCompletionStatus}`);
 const compatibilityEvidence=(item:LocatedEvidenceFragmentV2|undefined):ReviewEvidenceV1|null=>item?{source:item.source,path:item.path,coordinateUnit:item.coordinateUnit,start:item.start,end:item.end,quote:item.quote}:null;
 const compatibilityPayload={
  reviewId:metadata.reviewId,reviewSchemaVersion:REVIEW_RESULT_VERSION,reviewerType:'model_review' as const,reviewerIdentity:metadata.reviewerIdentity,modelId:metadata.modelId,reviewPromptVersion:REVIEW_PROMPT_VERSION,
  policyVersion:input.policy.version,policyHash:input.policy.hash,contractVersion:input.contract.version,contractHash:input.contract.hash,factsVersion:input.facts.version,factsHash:input.facts.hash,
  originalResponseHash:input.originalResponseHash,caseId:input.caseId,runId:input.runId,responseId:input.responseId,startedAt:metadata.startedAt,finishedAt:metadata.finishedAt,
  ruleResults:ruleResults.map(item=>({ruleId:item.ruleId,status:item.status,reason:item.reason,evidence:compatibilityEvidence(item.evidenceFragments[0]),...(item.evidenceFragments.length===0?{missingReason:item.missingReason??'No exact evidence was supplied.'}:{})})),
  contradictions:contradictions.map(item=>({description:item.description,evidence:compatibilityEvidence(item.evidenceFragments[0]),...(item.evidenceFragments.length===0?{missingReason:item.missingReason??'No exact evidence was supplied.'}:{})})),
  extraClaims:extraClaims.map(item=>({description:item.description,status:item.status,evidence:compatibilityEvidence(item.evidenceFragments[0]),...(item.evidenceFragments.length===0?{missingReason:item.missingReason??'No exact evidence was supplied.'}:{})})),
  unverifiableItems:unverifiableItems.map(item=>({description:item.description,evidence:compatibilityEvidence(item.evidenceFragments[0]),...(item.evidenceFragments.length===0?{missingReason:item.missingReason??'No exact evidence was supplied.'}:{})})),
  reviewCompletionStatus:wire.reviewCompletionStatus,sourceMetadata:{...metadata.sourceMetadata,wireVersion:SEMANTIC_REVIEW_WIRE_VERSION_V2,allEvidenceFragmentsPreserved:true},
 };
 const compatibility=semanticReviewResultSchemaV1.safeParse(compatibilityPayload);
 if(!compatibility.success)errors.push(...compatibility.error.issues.map(issue=>`compatibilityReview.${issue.path.join('.')}: ${issue.message}`));
 return {version:'derived-semantic-review-v2',status:errors.length?'failed':'passed',errors,ruleResults,contradictions,extraClaims,unverifiableItems,reviewCompletionStatus:wire.reviewCompletionStatus,compatibilityReview:errors.length||!compatibility.success?null:compatibility.data};
}
