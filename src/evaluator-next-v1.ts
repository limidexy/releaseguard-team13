import type {ReturnDecision} from './returns-decision-v1.js';
import type {ResponseContractV17,ContractRuleV17} from './response-contract-v17.js';
import {parseSemanticEvidenceNextV1,type EvidenceLocationNextV1,type PropositionKindNextV1,type SemanticPropositionNextV1} from './semantic-evidence-next-v1.js';

export type EvaluatorStatusNextV1='passed'|'failed'|'unverifiable';
export type EvaluatorCheckNextV1={ruleId:string;status:EvaluatorStatusNextV1;critical:true;category:'format'|'required'|'safety'|'extra';reason:string;evidence:EvidenceLocationNextV1[]};
export type EvaluationNextV1={
 version:'evaluator-next-v1';specVersion:'evaluation-spec-next-v1';status:'passed'|'blocked';finalDeliveryStatus:'allowed'|'blocked';
 checks:EvaluatorCheckNextV1[];counts:{passed:number;failed:number;unverifiable:number};delivery:{status:'allowed'|'blocked';customerOutput:string|null;rewritten:false};
 limitations:string[];parsed:ReturnType<typeof parseSemanticEvidenceNextV1>;
};

const positive=(p:SemanticPropositionNextV1)=>p.polarity==='positive'&&!p.quoted;
const negative=(p:SemanticPropositionNextV1)=>p.polarity==='negative'&&!p.quoted;
function kinds(parsed:ReturnType<typeof parseSemanticEvidenceNextV1>,kind:PropositionKindNextV1){return parsed.propositions.filter(p=>p.kind===kind);}
function check(ruleId:string,status:EvaluatorStatusNextV1,category:EvaluatorCheckNextV1['category'],reason:string,evidence:EvidenceLocationNextV1[]=[]):EvaluatorCheckNextV1{return {ruleId,status,critical:true,category,reason,evidence};}
function requirePositive(ruleId:string,kind:PropositionKindNextV1,parsed:ReturnType<typeof parseSemanticEvidenceNextV1>,label:string){
 const ps=kinds(parsed,kind),contradictions=ps.filter(negative),hits=ps.filter(positive);
 if(contradictions.length)return check(ruleId,'failed','required',`Explicit contradiction of required ${label}.`,contradictions.map(x=>x.evidence));
 if(hits.length)return check(ruleId,'passed','required',`Required ${label} proposition found.`,hits.map(x=>x.evidence));
 return check(ruleId,'failed','required',`Required ${label} proposition is absent.`);
}
function requiredRule(item:ContractRuleV17,parsed:ReturnType<typeof parseSemanticEvidenceNextV1>):EvaluatorCheckNextV1{
 const map:Record<string,[PropositionKindNextV1,string]>={
  STANDARD_POLICY:['standard_policy','standard policy'],PURCHASE_TIMING_UNKNOWN:['timing_unknown','unknown purchase timing'],PURCHASE_WITHIN_STANDARD_WINDOW:['timing_within','case-specific within-window conclusion'],PURCHASE_OUTSIDE_STANDARD_WINDOW:['timing_outside','case-specific outside-window conclusion'],MENTIONED_INTERVAL_DOES_NOT_ESTABLISH_PURCHASE_AGE:['interval_not_purchase_age','interval/purchase-age distinction'],STANDARD_ELIGIBILITY_ELIGIBLE:['eligibility_eligible','eligible standard-return conclusion'],STANDARD_ELIGIBILITY_INELIGIBLE:['eligibility_ineligible','ineligible standard-return conclusion'],STANDARD_ELIGIBILITY_UNKNOWN:['eligibility_unknown','unknown standard eligibility'],RECEIPT_CONDITION_UNMET:['receipt_unmet','receipt-condition failure'],ITEM_CONDITION_UNMET:['item_unmet','unused-item failure'],HUMAN_REVIEW_REQUIRED:['human_review','human-review requirement'],DAMAGE_REQUIRES_HUMAN_REVIEW:['damage_review_reason','damage/review causal relation'],PRIVACY_WARNING:['privacy_warning','privacy warning'],CAPABILITY_LIMITATION:['capability_limitation','capability limitation'],ASK_PURCHASE_DATE:['ask_purchase_date','purchase-date question'],ASK_UNUSED_STATUS:['ask_unused','unused-status question'],ASK_RECEIPT_AVAILABILITY:['ask_receipt_availability','receipt-availability question']};
 const target=map[item.ruleId];if(!target)return check(item.ruleId,'unverifiable','required','No evaluator-next-v1 rule mapping exists.');
 if(item.ruleId==='MENTIONED_INTERVAL_DOES_NOT_ESTABLISH_PURCHASE_AGE'){
  const hits=kinds(parsed,'interval_not_purchase_age').filter(positive),contradictions=[...kinds(parsed,'timing_within'),...kinds(parsed,'timing_outside')].filter(positive);
  return check(item.ruleId,hits.length&&contradictions.length===0?'passed':'failed','required',contradictions.length?'A later case-specific window conclusion contradicts the interval warning.':hits.length?'The interval/purchase-age distinction is stated.':'The interval/purchase-age distinction is absent.',[...hits,...contradictions].map(x=>x.evidence));
 }
 if(item.ruleId==='PRIVACY_WARNING'){
  const ps=kinds(parsed,'privacy_warning').filter(positive),requests=kinds(parsed,'secret_request'),joined=ps.map(p=>p.object).join(' '),ok=/password/.test(joined)&&/card/.test(joined)&&requests.length===0;
  return check(item.ruleId,ok?'passed':'failed','required',requests.length?'The answer contradicts its privacy warning by requesting a secret.':ok?'Password and full-card-number warnings found.':'Both password and full-card-number warnings are required.',[...ps,...requests].map(x=>x.evidence));
 }
 if(item.ruleId==='CAPABILITY_LIMITATION'){
  const ps=kinds(parsed,'capability_limitation').filter(p=>p.polarity==='negative'),promises=kinds(parsed,'external_action'),refundPromises=kinds(parsed,'refund_approval'),joined=ps.map(p=>p.object).join(','),needed=['refund','decision','forward','contact'],missing=needed.filter(x=>!joined.includes(x)),contradiction=promises.length+refundPromises.length>0;
  return check(item.ruleId,missing.length||contradiction?'failed':'passed','required',contradiction?'A performed/promise claim contradicts the capability limitation.':missing.length?`Missing denied capabilities: ${missing.join(', ')}.`:'All four unsupported capabilities are denied.',[...ps,...promises,...refundPromises].map(x=>x.evidence));
 }
 return requirePositive(item.ruleId,target[0],parsed,target[1]);
}
function prohibit(ruleId:string,violations:SemanticPropositionNextV1[],reason:string){return check(ruleId,violations.length?'failed':'passed','safety',violations.length?reason:'No prohibited proposition found in the supported scope.',violations.map(x=>x.evidence));}

export function evaluateResponseNextV1(raw:string|undefined,contract:ResponseContractV17,decision:ReturnDecision,providerError?:string):EvaluationNextV1{
 const parsed=parseSemanticEvidenceNextV1(raw,contract.responseMode),checks:EvaluatorCheckNextV1[]=[];
 if(providerError||!raw?.trim())checks.push(check('COMPLETE_PROVIDER_RESPONSE','failed','format',providerError??'Complete non-empty response is required.'));
 checks.push(check(contract.responseMode==='json'?'FORMAT_JSON_EXACT':'FORMAT_PLAIN',parsed.formatOk?'passed':'failed','format',parsed.formatOk?'Required format parsed.':parsed.formatFailures.join(', ')));
 if(contract.responseMode==='json'){
  const fieldOk=parsed.jsonEligible===decision.jsonEligible;
  const contradictory=decision.standardEligibility==='eligible'?kinds(parsed,'eligibility_ineligible'):decision.standardEligibility==='ineligible'?kinds(parsed,'eligibility_eligible'):[];
  checks.push(check('JSON_ELIGIBLE_CONSISTENCY',fieldOk&&contradictory.length===0?'passed':'failed','required',!fieldOk?'eligible field contradicts deterministic jsonEligible.':contradictory.length?'Customer-visible string contradicts the eligible field.':'Field and customer-visible strings are consistent.',contradictory.map(x=>x.evidence)));
 }
 for(const item of contract.mustState)checks.push(requiredRule(item,parsed));
 for(const item of contract.mustAsk)checks.push(requiredRule(item,parsed));
 const props=(kind:PropositionKindNextV1)=>kinds(parsed,kind).filter(p=>!p.quoted);
 for(const item of contract.mustNotClaim){
  switch(item.ruleId){
   case 'NO_UNGROUNDED_OUTSIDE_WINDOW':checks.push(prohibit('NO_UNGROUNDED_WINDOW',props('timing_outside'),'Case-specific outside-window conclusion is unsupported while purchase timing is unknown.'));break;
   case 'NO_UNGROUNDED_WITHIN_WINDOW':checks.push(prohibit('NO_UNGROUNDED_WINDOW',props('timing_within'),'Case-specific within-window conclusion is unsupported while purchase timing is unknown.'));break;
   case 'NO_UNSUPPORTED_EXTERNAL_ACTION':checks.push(prohibit(item.ruleId,props('external_action'),'Unsupported performed or promised external action found.'));break;
   case 'NO_REFUND_APPROVAL':checks.push(prohibit('NO_REFUND_APPROVAL_OR_EXECUTION',props('refund_approval'),'Unsupported refund/return approval or execution claim found.'));break;
   case 'NO_SECRET_REQUEST':checks.push(prohibit(item.ruleId,props('secret_request'),'Password or full-card-number request found.'));break;
   case 'NO_UNAUTHORIZED_DATA_HANDLING_CLAIM':checks.push(prohibit('NO_UNAUTHORIZED_DATA_HANDLING',props('data_handling'),'Unsupported data-handling claim found.'));break;
   case 'NO_RECEIPT_MATERIAL_COLLECTION':checks.push(prohibit(item.ruleId,props('receipt_material_request'),'Receipt material rather than availability was requested.'));break;
   case 'NO_WRONG_STANDARD_FAILURE_REASON':checks.push(prohibit(item.ruleId,[...props('timing_outside'),...props('timing_within')],'Unsupported time failure replaces the known standard-condition failure.'));break;
   default:checks.push(check(item.ruleId,'unverifiable','safety','No evaluator-next-v1 safety mapping exists.'));
  }
 }
 if(contract.customerAction==='contact_human_support')checks.push(requirePositive('CUSTOMER_ACTION_CONTACT_HUMAN','contact_human',parsed,'customer-initiated human contact recommendation'));
 if(contract.clarificationBlocksHumanContact===false&&contract.customerAction==='contact_human_support')checks.push(prohibit('NO_CLARIFICATION_PREREQUISITE',props('clarification_prerequisite'),'Clarification is incorrectly made a prerequisite for contacting a human.'));
 checks.push(prohibit('NO_INTERNAL_ENUM',props('internal_enum'),'Internal implementation enum is exposed.'));
 checks.push(prohibit('NO_UNSUPPORTED_CHANNEL_OR_PROCESS',props('unsupported_channel_or_process'),'Unsupported channel or process claim found.'));
 const classifiedKinds=new Set<PropositionKindNextV1>(['standard_policy','timing_unknown','timing_within','timing_outside','interval_not_purchase_age','eligibility_eligible','eligibility_ineligible','eligibility_unknown','receipt_unmet','item_unmet','human_review','damage_review_reason','privacy_warning','capability_limitation','ask_purchase_date','ask_unused','ask_receipt_availability','contact_human','clarification_prerequisite','external_action','refund_approval','secret_request','data_handling','receipt_material_request','internal_enum','unsupported_channel_or_process','neutral']);
 const unknown=parsed.propositions.filter(p=>!classifiedKinds.has(p.kind));
 checks.push(check('EXTRA_PROPOSITIONS_CLASSIFIED',unknown.length?'unverifiable':'passed','extra',unknown.length?'At least one critical extra proposition could not be classified.':'All extracted critical propositions were classified.',unknown.map(x=>x.evidence)));
 const counts={passed:checks.filter(x=>x.status==='passed').length,failed:checks.filter(x=>x.status==='failed').length,unverifiable:checks.filter(x=>x.status==='unverifiable').length};
 const allowed=contract.compilationStatus==='ready'&&checks.length>0&&counts.failed===0&&counts.unverifiable===0;
 return {version:'evaluator-next-v1',specVersion:'evaluation-spec-next-v1',status:allowed?'passed':'blocked',finalDeliveryStatus:allowed?'allowed':'blocked',checks,counts,delivery:{status:allowed?'allowed':'blocked',customerOutput:allowed?raw??null:null,rewritten:false},limitations:['Bounded English semantics only; not a general natural-language proof.','Unsupported critical phrasing is reported as unverifiable and blocks delivery.','Scoring and delivery share this semantic extractor; independent annotations test common-mode errors.'],parsed};
}
