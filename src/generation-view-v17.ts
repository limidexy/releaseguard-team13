import type {ReturnDecision} from './returns-decision-v1.js';
import type {ResponseContractV17,ResponseModeV17} from './response-contract-v17.js';

export type GenerationViewV17R3={
 viewVersion:'generation-view-v17-r3';
 facts:{purchaseDaysAgo:number|null;unused:boolean|null;receipt:boolean|null;damaged:boolean;dispute:boolean;actionRequested:boolean;privacy:boolean};
 businessConclusion:{standardEligibility:'eligible'|'ineligible'|'unknown';timeWindow:'within'|'outside'|'unknown';standardFailureReasons:string[];requiresHumanReview:boolean;humanReviewReasons:string[];jsonEligible:boolean};
 requiredExpressionOrder:string[];
 requiredClarifications:string[];
 applicableBoundaries:string[];
 responseMode:ResponseModeV17;
};

const POLICY='State the standard policy: an unused item, within 30 days of purchase, with a receipt.';

export function compileGenerationViewV17R3(decision:ReturnDecision,contract:ResponseContractV17):GenerationViewV17R3{
 const requiredExpressionOrder=[POLICY];
 if(decision.facts.privacy)requiredExpressionOrder.push('Warn the customer not to share passwords or full card numbers.');
 if(contract.timeWindowStatus==='unknown')requiredExpressionOrder.push('State that the purchase date or purchase age is unknown.');
 if(contract.timeWindowStatus==='within')requiredExpressionOrder.push('State that this known purchase is within the 30-day standard window.');
 if(contract.timeWindowStatus==='outside')requiredExpressionOrder.push('State that this known purchase is outside the 30-day standard window.');
 if(contract.intervalEvidence.some(x=>x.kind==='arrival_or_discovery_interval'))requiredExpressionOrder.push('Explain that the mentioned arrival or damage-discovery interval does not establish purchase age.');
 else if(contract.intervalEvidence.some(x=>x.kind==='bare_interval'))requiredExpressionOrder.push('Explain that the mentioned interval has no supplied start point and does not establish purchase age.');
 if(decision.standardEligibility==='eligible')requiredExpressionOrder.push('State that the supplied facts meet the standard return conditions; do not approve a refund.');
 if(decision.standardEligibility==='ineligible')requiredExpressionOrder.push('State that the standard return is ineligible and name only the supplied failed condition.');
 if(decision.standardEligibility==='unknown')requiredExpressionOrder.push('State that standard eligibility cannot yet be determined.');
 if(decision.facts.receipt===false)requiredExpressionOrder.push('State that the receipt condition for a standard return is not met.');
 if(decision.facts.unused===false)requiredExpressionOrder.push('State that the unused-item condition for a standard return is not met.');
 if(decision.requiresHumanReview)requiredExpressionOrder.push('State that the case requires human review.');
 if(decision.facts.damaged)requiredExpressionOrder.push('State that the damaged item is the reason human review is required.');
 if(decision.facts.actionRequested||decision.facts.dispute)requiredExpressionOrder.push('State that this assistant cannot issue refunds, change decisions, forward requests, or contact people.');

 const requiredClarifications:string[]=[];
 if(contract.mustAsk.some(x=>x.ruleId==='ASK_PURCHASE_DATE'))requiredClarifications.push('Ask for the purchase date.');
 if(contract.mustAsk.some(x=>x.ruleId==='ASK_UNUSED_STATUS'))requiredClarifications.push('Ask whether the item is unused.');
 if(contract.mustAsk.some(x=>x.ruleId==='ASK_RECEIPT_AVAILABILITY'))requiredClarifications.push('Ask only whether a receipt exists.');

 const applicableBoundaries=[
  'Use only the supplied facts and business conclusion; do not recompute or add policy.',
  'Eligibility guidance is not refund approval or execution.',
  'Do not claim that any refund, transfer, escalation, ticket, contact, or other external action was or will be performed.',
  'Do not invent channels, remedies, packaging rules, processing times, data storage or data sharing practices.',
  'Do not request passwords, full card numbers, receipt contents, copies, photos, scans, numbers, proof, or uploads.',
  'Unknown purchase timing stays unknown and cannot support an inside-window or outside-window conclusion.',
  'Ask every listed required clarification. A human-review next step does not replace any required clarification, and the questions do not prevent the customer from contacting human support immediately.',
 ];
 if(decision.requiresHumanReview)applicableBoundaries.push('The customer action is to contact a human support agent for review; the assistant does not perform the handoff.');
 else if(requiredClarifications.length)applicableBoundaries.push('The next action is for the customer to provide only the listed non-sensitive clarifications.');
 else applicableBoundaries.push('The next action is policy explanation only.');

 return {viewVersion:'generation-view-v17-r3',facts:{...decision.facts},businessConclusion:{standardEligibility:decision.standardEligibility,timeWindow:contract.timeWindowStatus,standardFailureReasons:[...contract.standardFailureReasons],requiresHumanReview:decision.requiresHumanReview,humanReviewReasons:[...contract.humanReviewReasons],jsonEligible:decision.jsonEligible},requiredExpressionOrder,requiredClarifications,applicableBoundaries,responseMode:contract.responseMode};
}

export const generationPromptV17R3=`Write one customer-facing answer from the concise generation view below. Follow the required expression order, ask every required clarification, and obey every applicable boundary. A human-review next step never replaces a required clarification. One sentence may satisfy multiple compatible requirements. Do not add facts, policies, remedies, channels, actions, or data-handling promises. Do not mention the generation view, internal reasoning, or validation. Return only the requested plain or JSON format.`;

export function generationViewContextV17R3(decision:ReturnDecision,contract:ResponseContractV17){
 const view=compileGenerationViewV17R3(decision,contract);
 return {view,text:'GENERATION VIEW (authoritative and concise):\n'+JSON.stringify(view)};
}

export function generationViewCoverageV17R3(contract:ResponseContractV17){
 const stateMap:Record<string,string>={
  STANDARD_POLICY:'requiredExpressionOrder[policy]',PURCHASE_TIMING_UNKNOWN:'requiredExpressionOrder[timing]',PURCHASE_WITHIN_STANDARD_WINDOW:'requiredExpressionOrder[timing]',PURCHASE_OUTSIDE_STANDARD_WINDOW:'requiredExpressionOrder[timing]',MENTIONED_INTERVAL_DOES_NOT_ESTABLISH_PURCHASE_AGE:'requiredExpressionOrder[interval]',STANDARD_ELIGIBILITY_ELIGIBLE:'requiredExpressionOrder[eligibility]',STANDARD_ELIGIBILITY_INELIGIBLE:'requiredExpressionOrder[eligibility]',STANDARD_ELIGIBILITY_UNKNOWN:'requiredExpressionOrder[eligibility]',RECEIPT_CONDITION_UNMET:'requiredExpressionOrder[failed condition]',ITEM_CONDITION_UNMET:'requiredExpressionOrder[failed condition]',HUMAN_REVIEW_REQUIRED:'requiredExpressionOrder[review]',DAMAGE_REQUIRES_HUMAN_REVIEW:'requiredExpressionOrder[review reason]',PRIVACY_WARNING:'requiredExpressionOrder[privacy warning]',CAPABILITY_LIMITATION:'requiredExpressionOrder[capability]',
 };
 const askMap:Record<string,string>={ASK_PURCHASE_DATE:'requiredClarifications[purchase date]',ASK_UNUSED_STATUS:'requiredClarifications[unused]',ASK_RECEIPT_AVAILABILITY:'requiredClarifications[receipt availability]'};
 const boundaryMap:Record<string,string>={NO_UNGROUNDED_OUTSIDE_WINDOW:'applicableBoundaries[unknown timing]',NO_UNGROUNDED_WITHIN_WINDOW:'applicableBoundaries[unknown timing]',NO_UNSUPPORTED_EXTERNAL_ACTION:'applicableBoundaries[no external action]',NO_REFUND_APPROVAL:'applicableBoundaries[eligibility is not approval]',NO_SECRET_REQUEST:'applicableBoundaries[no secrets]',NO_UNAUTHORIZED_DATA_HANDLING_CLAIM:'applicableBoundaries[no data-practice invention]',NO_RECEIPT_MATERIAL_COLLECTION:'applicableBoundaries[receipt availability only]',NO_WRONG_STANDARD_FAILURE_REASON:'businessConclusion[standardFailureReasons]'};
 const entries=[...contract.mustState.map(x=>[x.ruleId,stateMap[x.ruleId]]),...contract.mustAsk.map(x=>[x.ruleId,askMap[x.ruleId]]),...contract.mustNotClaim.map(x=>[x.ruleId,boundaryMap[x.ruleId]])];
 return entries.map(([ruleId,target])=>({ruleId,target:target??null,covered:Boolean(target)}));
}
