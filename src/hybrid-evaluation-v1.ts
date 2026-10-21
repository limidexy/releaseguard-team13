import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {ReturnDecision,ReturnFacts} from './returns-decision-v1.js';
import type {ResponseContractV17} from './response-contract-v17.js';

export const HYBRID_EVALUATION_VERSION='hybrid-evaluation-v1' as const;
export const REVIEW_INPUT_VERSION='semantic-review-input-v1' as const;
export const REVIEW_RESULT_VERSION='semantic-review-result-v1' as const;
export const REVIEW_PROMPT_VERSION='semantic-review-prompt-v1' as const;

export type ReviewStatusV1='passed'|'failed'|'unverifiable';
export type ReviewerTypeV1='project_reference_annotation'|'verified_human_review'|'model_review'|'mock';

function canonical(value:unknown):string{
 if(value===null)return 'null';
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(typeof value==='object')return '{'+Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>JSON.stringify(key)+':'+canonical(item)).join(',')+'}';
 const encoded=JSON.stringify(value);if(encoded===undefined)throw new Error('Unsupported value in canonical hash input');return encoded;
}
export const sha256=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
export const objectSha256=(value:unknown)=>sha256(canonical(value));

const shaSchema=z.string().regex(/^[a-f0-9]{64}$/);
const idSchema=z.string().min(1).max(160).regex(/^[a-zA-Z0-9._:/-]+$/);
const isoSchema=z.string().datetime({offset:true});

export const reviewEvidenceSchemaV1=z.object({
 source:z.enum(['plain','json_field','raw_response']),
 path:z.enum(['$','$.reason','$.nextStep']),
 coordinateUnit:z.literal('utf16-code-unit'),
 start:z.number().int().min(0),end:z.number().int().min(0),quote:z.string().min(1).max(10000),
}).strict().refine(v=>v.end>v.start,{message:'Evidence end must be greater than start'});
export type ReviewEvidenceV1=z.infer<typeof reviewEvidenceSchemaV1>;

export const applicableRuleSchemaV1=z.object({
 ruleId:idSchema,meaning:z.string().min(1).max(1000),critical:z.boolean(),expectation:z.enum(['required','prohibited']),
}).strict();

export const semanticReviewInputSchemaV1=z.object({
 reviewSchemaVersion:z.literal(REVIEW_INPUT_VERSION),evaluationVersion:z.literal(HYBRID_EVALUATION_VERSION),
 caseId:idSchema,runId:idSchema,responseId:idSchema,responseMode:z.enum(['plain','json']),reviewPromptVersion:z.literal(REVIEW_PROMPT_VERSION),
 policy:z.object({version:idSchema,hash:shaSchema,text:z.string().min(1).max(20000)}).strict(),
 facts:z.object({version:idSchema,hash:shaSchema,value:z.record(z.unknown()),sourceId:idSchema}).strict(),
 decision:z.object({version:idSchema,hash:shaSchema,value:z.record(z.unknown())}).strict(),
 contract:z.object({version:idSchema,hash:shaSchema,value:z.record(z.unknown())}).strict(),
 originalQuestion:z.string().min(1).max(5000),originalResponse:z.string().min(1).max(10000),originalResponseHash:shaSchema,
 applicableRules:z.array(applicableRuleSchemaV1).min(1).max(100),
}).strict().superRefine((value,ctx)=>{
  const ids=value.applicableRules.map(rule=>rule.ruleId);
  if(new Set(ids).size!==ids.length)ctx.addIssue({code:'custom',path:['applicableRules'],message:'Duplicate applicable rule IDs'});
});
export type SemanticReviewInputV1=z.infer<typeof semanticReviewInputSchemaV1>;

const reviewRuleResultSchemaV1=z.object({
 ruleId:idSchema,status:z.enum(['passed','failed','unverifiable']),reason:z.string().min(1).max(1000),
 evidence:reviewEvidenceSchemaV1.nullable(),missingReason:z.string().min(1).max(500).optional(),
}).strict().superRefine((value,ctx)=>{
 if(value.evidence===null&&!value.missingReason)ctx.addIssue({code:'custom',path:['missingReason'],message:'Null evidence requires missingReason'});
 if(value.evidence!==null&&value.missingReason)ctx.addIssue({code:'custom',path:['missingReason'],message:'missingReason is only valid when evidence is null'});
});

const locatedObservationBaseSchemaV1=z.object({
 description:z.string().min(1).max(1000),evidence:reviewEvidenceSchemaV1.nullable(),missingReason:z.string().min(1).max(500).optional(),
}).strict();
const locatedObservationSchemaV1=locatedObservationBaseSchemaV1.superRefine((value,ctx)=>{
 if(value.evidence===null&&!value.missingReason)ctx.addIssue({code:'custom',path:['missingReason'],message:'Null evidence requires missingReason'});
});
const extraClaimSchemaV1=locatedObservationBaseSchemaV1.extend({status:z.enum(['allowed','failed','unverifiable'])}).strict().superRefine((value,ctx)=>{
 if(value.evidence===null&&!value.missingReason)ctx.addIssue({code:'custom',path:['missingReason'],message:'Null evidence requires missingReason'});
});

export const semanticReviewResultSchemaV1=z.object({
 reviewId:idSchema,reviewSchemaVersion:z.literal(REVIEW_RESULT_VERSION),reviewerType:z.enum(['project_reference_annotation','verified_human_review','model_review','mock']),
 reviewerIdentity:idSchema,modelId:idSchema.nullable(),reviewPromptVersion:z.literal(REVIEW_PROMPT_VERSION),
 policyVersion:idSchema,policyHash:shaSchema,contractVersion:idSchema,contractHash:shaSchema,factsVersion:idSchema,factsHash:shaSchema,
 originalResponseHash:shaSchema,caseId:idSchema,runId:idSchema,responseId:idSchema,
 startedAt:isoSchema,finishedAt:isoSchema,
 ruleResults:z.array(reviewRuleResultSchemaV1).min(1).max(100),
 contradictions:z.array(locatedObservationSchemaV1).max(100),extraClaims:z.array(extraClaimSchemaV1).max(100),
 unverifiableItems:z.array(locatedObservationSchemaV1).max(100),
 reviewCompletionStatus:z.enum(['completed','timeout','provider_error','truncated','invalid']),
 sourceMetadata:z.record(z.unknown()),
}).strict();
export type SemanticReviewResultV1=z.infer<typeof semanticReviewResultSchemaV1>;

export type HybridEnvelopeV1={
 caseId:string;runId:string;responseId:string;question:string;originalResponse?:string;responseComplete:boolean;providerError?:string;
 responseMode:'plain'|'json';policy:{version:string;text:string};facts:{version:string;sourceId:string;value:ReturnFacts};decision:ReturnDecision;contract:ResponseContractV17;
};

const extraSemanticRules:Record<string,{meaning:string;expectation:'required'|'prohibited'}>={
 CUSTOMER_ACTION_CONTACT_HUMAN:{meaning:'Determine whether the answer tells the customer to initiate human contact when required.',expectation:'required'},
 NO_CLARIFICATION_PREREQUISITE:{meaning:'Determine whether clarification is improperly made a prerequisite for human contact.',expectation:'prohibited'},
 JSON_TEXT_CONSISTENCY:{meaning:'Determine whether customer-visible JSON strings contradict the eligible field or each other.',expectation:'prohibited'},
 NO_INTERNAL_ENUM:{meaning:'Determine whether internal implementation labels are exposed.',expectation:'prohibited'},
 NO_UNSUPPORTED_CHANNEL_OR_PROCESS:{meaning:'Determine whether the answer invents a channel, process, timeline or follow-up.',expectation:'prohibited'},
 EXTRA_CLAIMS_AUTHORIZED:{meaning:'Classify additional customer-facing claims and reject unsupported or unverifiable critical claims.',expectation:'prohibited'},
};

export function applicableSemanticRulesV1(contract:ResponseContractV17){
 const rows=[...contract.mustState.map(rule=>({...rule,expectation:'required' as const})),...contract.mustAsk.map(rule=>({...rule,expectation:'required' as const})),...contract.mustNotClaim.map(rule=>({...rule,expectation:'prohibited' as const}))];
 if(contract.responseMode==='json')rows.push({ruleId:'JSON_TEXT_CONSISTENCY',meaning:extraSemanticRules.JSON_TEXT_CONSISTENCY.meaning,appliesBecause:'JSON visible text requires semantic consistency review.',expectation:'prohibited'});
 if(contract.customerAction==='contact_human_support')rows.push({ruleId:'CUSTOMER_ACTION_CONTACT_HUMAN',meaning:extraSemanticRules.CUSTOMER_ACTION_CONTACT_HUMAN.meaning,appliesBecause:'The deterministic customer action is contact_human_support.',expectation:'required'});
 if(contract.clarificationBlocksHumanContact===false&&contract.customerAction==='contact_human_support')rows.push({ruleId:'NO_CLARIFICATION_PREREQUISITE',meaning:extraSemanticRules.NO_CLARIFICATION_PREREQUISITE.meaning,appliesBecause:'Clarification must not block human contact.',expectation:'prohibited'});
 for(const ruleId of ['NO_INTERNAL_ENUM','NO_UNSUPPORTED_CHANNEL_OR_PROCESS','EXTRA_CLAIMS_AUTHORIZED'])rows.push({ruleId,meaning:extraSemanticRules[ruleId].meaning,appliesBecause:'Always applicable customer-text safety rule.',expectation:'prohibited'});
 return rows.filter((row,index,all)=>all.findIndex(other=>other.ruleId===row.ruleId)===index).map(row=>({ruleId:row.ruleId,meaning:row.meaning,critical:true,expectation:row.expectation}));
}

export function buildSemanticReviewInputV1(envelope:HybridEnvelopeV1):SemanticReviewInputV1{
 if(!envelope.originalResponse?.trim())throw new Error('Original response is required before semantic review');
 const value={
  reviewSchemaVersion:REVIEW_INPUT_VERSION,evaluationVersion:HYBRID_EVALUATION_VERSION,
  caseId:envelope.caseId,runId:envelope.runId,responseId:envelope.responseId,responseMode:envelope.responseMode,reviewPromptVersion:REVIEW_PROMPT_VERSION,
  policy:{version:envelope.policy.version,hash:sha256(envelope.policy.text),text:envelope.policy.text},
  facts:{version:envelope.facts.version,hash:objectSha256(envelope.facts.value),value:envelope.facts.value,sourceId:envelope.facts.sourceId},
  decision:{version:envelope.decision.version,hash:objectSha256(envelope.decision),value:envelope.decision},
  contract:{version:envelope.contract.contractVersion,hash:objectSha256(envelope.contract),value:envelope.contract},
  originalQuestion:envelope.question,originalResponse:envelope.originalResponse,originalResponseHash:sha256(envelope.originalResponse),
  applicableRules:applicableSemanticRulesV1(envelope.contract),
 };
 return semanticReviewInputSchemaV1.parse(value);
}

export type DeterministicCheckV1={checkId:string;status:'passed'|'failed';reason:string};
export type DeterministicChecksV1={version:'deterministic-checks-v1';status:'passed'|'failed';checks:DeterministicCheckV1[]};
function duplicateJsonKeys(raw:string){const keys:string[]=[];for(const match of raw.matchAll(/"((?:\\.|[^"\\])*)"\s*:/g)){try{keys.push(JSON.parse('"'+match[1]+'"'));}catch{}}return keys.some((key,index)=>keys.indexOf(key)!==index);}
function check(checkId:string,ok:boolean,reason:string):DeterministicCheckV1{return {checkId,status:ok?'passed':'failed',reason};}

export function runDeterministicChecksV1(envelope:HybridEnvelopeV1,input:SemanticReviewInputV1):DeterministicChecksV1{
 const checks:DeterministicCheckV1[]=[];let parsedJson:any=null;let jsonValid=false;
 const raw=envelope.originalResponse??'';
 checks.push(check('IDENTIFIERS_BOUND',input.caseId===envelope.caseId&&input.runId===envelope.runId&&input.responseId===envelope.responseId,'Case, run and response identifiers must match.'));
 checks.push(check('RESPONSE_MODE_BOUND',input.responseMode===envelope.responseMode,'Review input response mode must match the frozen envelope.'));
 checks.push(check('ORIGINAL_RESPONSE_PRESENT',raw.trim().length>0,'A non-empty original response is required.'));
 checks.push(check('RESPONSE_COMPLETE',envelope.responseComplete&&!envelope.providerError,'Provider completion must be complete and error-free.'));
 checks.push(check('ORIGINAL_RESPONSE_HASH',input.originalResponse===raw&&input.originalResponseHash===sha256(raw),'Review input must contain the byte-identical original response and hash.'));
 checks.push(check('POLICY_BINDING',input.policy.version===envelope.policy.version&&input.policy.text===envelope.policy.text&&input.policy.hash===sha256(envelope.policy.text),'Policy version, text and hash must match.'));
 checks.push(check('FACTS_BINDING',input.facts.version===envelope.facts.version&&input.facts.sourceId===envelope.facts.sourceId&&input.facts.hash===objectSha256(envelope.facts.value),'Facts version, source and hash must match.'));
 checks.push(check('DECISION_BINDING',input.decision.version===envelope.decision.version&&input.decision.hash===objectSha256(envelope.decision),'Deterministic decision version and hash must match.'));
 checks.push(check('CONTRACT_BINDING',input.contract.version===envelope.contract.contractVersion&&input.contract.hash===objectSha256(envelope.contract),'Contract version and hash must match.'));
 checks.push(check('CONTRACT_READY',envelope.contract.compilationStatus==='ready','A conflicting response contract cannot be reviewed for delivery.'));
 checks.push(check('RULE_SET_BOUND',objectSha256(input.applicableRules)===objectSha256(applicableSemanticRulesV1(envelope.contract)),'Applicable semantic rules must match the frozen contract-derived set.'));
 if(envelope.responseMode==='json'){
  try{parsedJson=JSON.parse(raw);jsonValid=Boolean(parsedJson)&&typeof parsedJson==='object'&&!Array.isArray(parsedJson);}catch{}
  const keys=jsonValid?Object.keys(parsedJson).sort():[];
  const exact=jsonValid&&!duplicateJsonKeys(raw)&&JSON.stringify(keys)===JSON.stringify(['eligible','nextStep','reason'])&&typeof parsedJson.eligible==='boolean'&&typeof parsedJson.reason==='string'&&parsedJson.reason.trim().length>0&&typeof parsedJson.nextStep==='string'&&parsedJson.nextStep.trim().length>0;
  checks.push(check('OUTPUT_FORMAT_JSON_EXACT',exact,'JSON mode requires a bare exact object with unique keys and exact field types.'));
  checks.push(check('JSON_ELIGIBLE_FIELD',exact&&parsedJson.eligible===envelope.decision.jsonEligible,'The eligible field must match deterministic jsonEligible.'));
 }else{
  let looksJson=false;try{const value=JSON.parse(raw);looksJson=Boolean(value)&&typeof value==='object';}catch{}
  checks.push(check('OUTPUT_FORMAT_PLAIN',!looksJson,'Plain mode must not contain a top-level JSON object.'));
 }
 return {version:'deterministic-checks-v1',status:checks.every(item=>item.status==='passed')?'passed':'failed',checks};
}

export type ReviewerTrustRegistryV1={
 verifiedHumanRecords:Record<string,{reviewerIdentity:string;originalResponseHash:string;contractHash:string;verifiedAt:string;qualifiedForUse:boolean}>;
 calibratedModelReviewers:Record<string,{modelId:string;reviewPromptVersion:string;policyVersion:string;qualifiedForUse:boolean}>;
};
export const emptyReviewerTrustRegistryV1=():ReviewerTrustRegistryV1=>({verifiedHumanRecords:{},calibratedModelReviewers:{}});

export type ReviewValidationV1={
 version:'semantic-review-validation-v1';status:'passed'|'failed';reviewerValidationStatus:'qualified'|'mock_only'|'reference_only'|'source_unverified'|'calibration_pending';
 errors:string[];review:SemanticReviewResultV1|null;
};

function sourceTextForEvidence(input:SemanticReviewInputV1,evidence:ReviewEvidenceV1):string|null{
 if(evidence.source==='plain'&&evidence.path==='$'&&input.responseMode==='plain')return input.originalResponse;
 if(evidence.source==='raw_response'&&evidence.path==='$')return input.originalResponse;
 if(evidence.source!=='json_field'||evidence.path==='$')return null;
 try{const parsed=JSON.parse(input.originalResponse);const key=evidence.path.slice(2);return typeof parsed?.[key]==='string'?parsed[key]:null;}catch{return null;}
}

export function validateSemanticReviewV1(raw:unknown,input:SemanticReviewInputV1,registry:ReviewerTrustRegistryV1=emptyReviewerTrustRegistryV1()):ReviewValidationV1{
 const parsed=semanticReviewResultSchemaV1.safeParse(raw);if(!parsed.success)return {version:'semantic-review-validation-v1',status:'failed',reviewerValidationStatus:'source_unverified',errors:parsed.error.issues.map(issue=>`${issue.path.join('.')}: ${issue.message}`),review:null};
 const review=parsed.data,errors:string[]=[];
 const same=(label:string,a:unknown,b:unknown)=>{if(a!==b)errors.push(`${label} mismatch`);};
 same('reviewPromptVersion',review.reviewPromptVersion,input.reviewPromptVersion);same('policyVersion',review.policyVersion,input.policy.version);same('policyHash',review.policyHash,input.policy.hash);
 same('contractVersion',review.contractVersion,input.contract.version);same('contractHash',review.contractHash,input.contract.hash);same('factsVersion',review.factsVersion,input.facts.version);same('factsHash',review.factsHash,input.facts.hash);
 same('originalResponseHash',review.originalResponseHash,input.originalResponseHash);same('caseId',review.caseId,input.caseId);same('runId',review.runId,input.runId);same('responseId',review.responseId,input.responseId);
 if(Date.parse(review.finishedAt)<Date.parse(review.startedAt))errors.push('finishedAt precedes startedAt');
 const expected=new Map(input.applicableRules.map(rule=>[rule.ruleId,rule]));const seen=new Set<string>();
 for(const result of review.ruleResults){
  if(seen.has(result.ruleId))errors.push(`Duplicate ruleId ${result.ruleId}`);seen.add(result.ruleId);
  const rule=expected.get(result.ruleId);if(!rule){errors.push(`Unknown or inapplicable ruleId ${result.ruleId}`);continue;}
  if(result.status==='passed'&&rule.expectation==='required'&&result.evidence===null)errors.push(`Required passed rule ${result.ruleId} needs evidence`);
 }
 for(const ruleId of expected.keys())if(!seen.has(ruleId))errors.push(`Missing applicable ruleId ${ruleId}`);
 const evidence=[...review.ruleResults.map(item=>item.evidence),...review.contradictions.map(item=>item.evidence),...review.extraClaims.map(item=>item.evidence),...review.unverifiableItems.map(item=>item.evidence)].filter((item):item is ReviewEvidenceV1=>item!==null);
 for(const item of evidence){const source=sourceTextForEvidence(input,item);if(source===null||item.end>source.length||source.slice(item.start,item.end)!==item.quote)errors.push(`Evidence quote mismatch at ${item.path}:${item.start}-${item.end}`);}
 if(review.reviewCompletionStatus!=='completed')errors.push(`Review completion is ${review.reviewCompletionStatus}`);
 let reviewerValidationStatus:ReviewValidationV1['reviewerValidationStatus']='source_unverified';
 if(review.reviewerType==='mock')reviewerValidationStatus='mock_only';
 if(review.reviewerType==='project_reference_annotation')reviewerValidationStatus='reference_only';
 if(review.reviewerType==='model_review'&&!review.modelId)errors.push('model_review requires modelId');
 if(review.reviewerType!=='model_review'&&review.modelId!==null)errors.push('Only model_review may contain modelId');
 if(review.reviewerType==='mock'&&review.sourceMetadata.executionMode!=='mock')errors.push('Mock review requires explicit mock execution metadata');
 if(review.reviewerType==='verified_human_review'){
  const recordId=String(review.sourceMetadata.sourceRecordId??''),record=registry.verifiedHumanRecords[recordId];
  if(record&&record.reviewerIdentity===review.reviewerIdentity&&record.originalResponseHash===input.originalResponseHash&&record.contractHash===input.contract.hash&&record.qualifiedForUse)reviewerValidationStatus='qualified';
  else errors.push('Verified-human source record is absent, mismatched or not qualified');
 }
 if(review.reviewerType==='model_review'){
  const key=`${review.modelId??''}:${review.reviewPromptVersion}:${review.policyVersion}`,record=registry.calibratedModelReviewers[key];
  if(record&&record.modelId===review.modelId&&record.reviewPromptVersion===review.reviewPromptVersion&&record.policyVersion===review.policyVersion&&record.qualifiedForUse)reviewerValidationStatus='qualified';
  else reviewerValidationStatus='calibration_pending';
 }
 return {version:'semantic-review-validation-v1',status:errors.length?'failed':'passed',reviewerValidationStatus,errors,review};
}

export type HybridEvaluationV1={
 version:typeof HYBRID_EVALUATION_VERSION;shadowOnly:true;deterministicCheckStatus:'passed'|'failed';semanticReviewStatus:'passed'|'failed'|'unverifiable'|'missing';
 semanticRuleResults:SemanticReviewResultV1['ruleResults'];candidatePolicyCompliance:'passed'|'blocked';candidateDeliveryStatus:'allowed'|'blocked';
 reviewerValidationStatus:ReviewValidationV1['reviewerValidationStatus'];customerOutput:string|null;originalResponseHash:string;rewritten:false;reasons:string[];
 historicalPath:{modified:false;activation:'unchanged'};
};

export function aggregateHybridEvaluationV1(envelope:HybridEnvelopeV1,deterministic:DeterministicChecksV1,validation:ReviewValidationV1):HybridEvaluationV1{
 const review=validation.review,ruleResults=review?.ruleResults??[],reasons:string[]=[];
 if(deterministic.status!=='passed')reasons.push('deterministic_checks_failed');
 if(validation.status!=='passed')reasons.push('semantic_review_invalid');
 const failed=ruleResults.filter(item=>item.status==='failed'),unverifiable=ruleResults.filter(item=>item.status==='unverifiable');
 if(failed.length)reasons.push('critical_rule_failed');if(unverifiable.length)reasons.push('critical_rule_unverifiable');
 if(review?.contradictions.length)reasons.push('unresolved_contradiction');
 if(review?.extraClaims.some(item=>item.status!=='allowed'))reasons.push('unauthorized_or_unverifiable_extra_claim');
 if(review?.unverifiableItems.length)reasons.push('unverifiable_item_present');
 if(validation.reviewerValidationStatus!=='qualified')reasons.push('reviewer_not_qualified_for_delivery');
 const semanticReviewStatus=!review?'missing':unverifiable.length||review.unverifiableItems.length?'unverifiable':failed.length||review.contradictions.length||review.extraClaims.some(item=>item.status!=='allowed')?'failed':'passed';
 const policyPassed=validation.status==='passed'&&semanticReviewStatus==='passed';
 const allowed=deterministic.status==='passed'&&policyPassed&&validation.reviewerValidationStatus==='qualified';
 const raw=envelope.originalResponse??'';
 return {version:HYBRID_EVALUATION_VERSION,shadowOnly:true,deterministicCheckStatus:deterministic.status,semanticReviewStatus,semanticRuleResults:ruleResults,
  candidatePolicyCompliance:policyPassed?'passed':'blocked',candidateDeliveryStatus:allowed?'allowed':'blocked',reviewerValidationStatus:validation.reviewerValidationStatus,
  customerOutput:allowed?raw:null,originalResponseHash:sha256(raw),rewritten:false,reasons,historicalPath:{modified:false,activation:'unchanged'}};
}
