import type {ReturnDecision} from './returns-decision-v1.js';
import type {ContractRuleV17,ResponseContractV17} from './response-contract-v17.js';
import {purchaseClarificationV2,unperformedOperationV2,unsupportedEligibilityV2} from './output-guard-v2.js';
import {noUnsupportedActionCapability} from './returns-policy-v27.js';
import {damageTimingChecks,explicitUserSecretWarning} from './returns-policy-v28.js';
import {privacyChecksV30} from './privacy-v30.js';
import {answerChecksV25} from './answer-v25.js';

export type ContractCheckStatusV17='passed'|'failed'|'unverifiable';
export type ContractEvidenceV17={start:number;end:number;text:string};
export type ContractCheckV17={ruleId:string;applicable:true;status:ContractCheckStatusV17;appliesBecause:string;
 checkerVersion:'response-contract-guard-v17';category:'contract'|'business_consistency'|'customer_text_safety';evidence:ContractEvidenceV17|null;missing:string|null};
const normalize=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/[’‘]/g,"'").replace(/[‐‑–—]/g,'-').replace(/[*_`]/g,'').replace(/\s+/g,' ').trim();
const matchNormalized=(raw:string)=>raw.replace(/[’‘]/g,"'").replace(/[‐‑–—]/g,'-');
const evidence=(raw:string,patterns:RegExp[]):ContractEvidenceV17|null=>{
 const searchable=matchNormalized(raw);
 for(const pattern of patterns){const flags=pattern.flags.replace('g',''),match=new RegExp(pattern.source,flags).exec(searchable);if(match)return {start:match.index,end:match.index+match[0].length,text:raw.slice(match.index,match.index+match[0].length)};}
 return null;
};
const status=(ok:boolean|undefined):ContractCheckStatusV17=>ok===undefined?'unverifiable':ok?'passed':'failed';
type SemanticAssessmentV17={ok:boolean|undefined;evidence:ContractEvidenceV17|null;missing:string};
type TextMatchV17=ContractEvidenceV17&{conditional:boolean;quoted:boolean;negated:boolean};
const sentenceStart=(raw:string,index:number)=>Math.max(raw.lastIndexOf('.',index-1),raw.lastIndexOf('!',index-1),raw.lastIndexOf('?',index-1),raw.lastIndexOf(';',index-1),raw.lastIndexOf('\n',index-1))+1;
function insideDoubleQuotes(raw:string,index:number){
 let open=false;
 for(let i=0;i<index;i++){if(raw[i]==='"')open=!open;else if(raw[i]==='“')open=true;else if(raw[i]==='”')open=false;}
 return open;
}
function textMatches(raw:string,patterns:RegExp[]):TextMatchV17[]{
 const matches:TextMatchV17[]=[];
 const searchable=matchNormalized(raw);
 for(const pattern of patterns){const flags=[...new Set((pattern.flags+'gi').split(''))].join('');for(const match of searchable.matchAll(new RegExp(pattern.source,flags))){
  const start=match.index??0,end=start+match[0].length,clauseStart=sentenceStart(raw,start),prefix=normalize(raw.slice(clauseStart,start));
  matches.push({start,end,text:raw.slice(start,end),conditional:/^(?:if|unless|whether|assuming|provided that)\b/.test(prefix)||/\b(?:determine|confirm|assess)\s+(?:if|whether)\b[^.!?;]{0,45}$/.test(prefix),quoted:insideDoubleQuotes(raw,start),negated:/(?:\bdo not|\bdon't|\bdoes not|\bdoesn't|\bnot|\bnever|\bno need to|\bnot required to|\bno)\b[^.!?;]{0,24}$/.test(prefix)||/\b(?:cannot|can't)\s+(?:determine|say|confirm)\b[^.!?;]{0,60}$/.test(prefix)});
 }}
 return matches.sort((a,b)=>a.start-b.start);
}
function requiredAssertion(raw:string,positive:RegExp[],contradiction:RegExp[],label:string):SemanticAssessmentV17{
 const negative=textMatches(raw,contradiction).find(x=>!x.conditional&&!x.quoted&&!x.negated);
 if(negative)return {ok:false,evidence:negative,missing:`Customer text contradicts ${label}.`};
 const candidates=textMatches(raw,positive),positiveAssertion=candidates.find(x=>!x.conditional&&!x.quoted&&!x.negated);
 if(positiveAssertion)return {ok:true,evidence:positiveAssertion,missing:''};
 const uncertain=candidates[0];
 if(uncertain)return {ok:undefined,evidence:uncertain,missing:`${label} appears only in a conditional, quoted, or negated context.`};
 return {ok:false,evidence:null,missing:`Required ${label} statement not reliably found in customer text.`};
}

const unknownPurchasePositive=[
 /\b(?:purchase (?:date|timing|age)|date of purchase)\b[^.!?;]{0,45}\b(?:is|are|were|remains?)\s+(?:unknown|not known|not provided|missing|unclear|not established)\b/i,
 /\b(?:cannot|can't|unable to|do not|don't)\b[^.!?;]{0,35}\b(?:determine|confirm|know|tell|assess)\b[^.!?;]{0,45}\b(?:purchase (?:date|timing|age)|date of purchase|when (?:you )?(?:bought|purchased))\b/i,
 /\b(?:we|i)\s+(?:do not|don't)\s+know\b[^.!?;]{0,45}\bwhen\b[^.!?;]{0,25}\b(?:bought|purchased)\b/i,
 /\b(?:we|i)\s+(?:do not|don't)\s+(?:yet )?(?:have|know)\b[^.!?;]{0,30}\b(?:the |your )?purchase date\b/i,
];
const unknownPurchaseContradiction=[
 /\b(?:purchase (?:date|timing|age)|date of purchase)\b[^.!?;]{0,30}\b(?:is|are|remains?)\s+(?:not unknown|known|provided|established|confirmed)\b/i,
 /\b(?:we|i)\s+(?:do|can)\s+know\b[^.!?;]{0,45}\bwhen\b[^.!?;]{0,25}\b(?:bought|purchased)\b/i,
];

function unknownPurchase(raw:string){return requiredAssertion(raw,unknownPurchasePositive,unknownPurchaseContradiction,'purchase timing unknown');}
function intervalNotPurchaseAge(raw:string,contract:ResponseContractV17){
 const semanticEquivalent=evidence(raw,[/\b(?:purchase (?:timing|date|age)|date of purchase)\b[^.!?;]{0,35}\b(?:is|remains?)\s+(?:unknown|not known|not provided)\b[^.!?;]{0,70}\b(?:cannot|can't)\s+(?:say|determine|confirm)\b[^.!?;]{0,55}\b(?:late|outside|within)\b[^.!?;]{0,40}\b(?:window|deadline)\b/i]);
 if(semanticEquivalent)return semanticEquivalent;
 for(const item of contract.intervalEvidence){
  const amount=/(\d{1,5})\s+(day|week|month|year)s?/i.exec(item.text);if(!amount)continue;
  const escaped=amount[1]+'(?:[- ]'+amount[2]+'s?)';
  const hit=evidence(raw,[new RegExp("(?:"+escaped+"|mentioned (?:time|interval))[^.!?;]{0,90}(?:does not|doesn't|cannot|can't|is not enough to)[^.!?;]{0,35}(?:establish|determine|confirm|show)[^.!?;]{0,45}(?:purchase (?:date|age|timing)|when (?:it was |you )?(?:bought|purchased))",'i'),
   new RegExp("(?:purchase (?:date|age|timing)|when (?:it was |you )?(?:bought|purchased))[^.!?;]{0,90}(?:cannot|can't|is not)[^.!?;]{0,35}(?:established|determined|confirmed)[^.!?;]{0,55}"+escaped,'i')]);
  if(hit)return hit;
 }
 return null;
}
function clarificationListField(raw:string,field:RegExp){return evidence(raw,[new RegExp(`\\b(?:please\\s+)?(?:let (?:me|us) know|tell (?:me|us)|provide (?:the )?(?:requested |following )?(?:details|information))\\b[\\s\\S]{0,220}${field.source}`,'i')]);}
function askUnused(raw:string){return evidence(raw,[/\b(?:please\s+)?(?:confirm|tell (?:me|us)|let (?:me|us) know|provide)\b[^.!?;]{0,55}\bwhether\b[^.!?;]{0,25}\b(?:item|product|it)\b[^.!?;]{0,15}\bunused\b/i,/\bis (?:the |your )?(?:item|product) (?:still )?unused\b/i])??clarificationListField(raw,/\bwhether\b[^.!?;]{0,25}\b(?:the )?(?:item|product|it)\b[^.!?;]{0,15}\bunused\b/i);}
function askReceiptAvailability(raw:string){return requiredAssertion(raw,[
 /\b(?:please\s+)?(?:confirm|tell (?:me|us)|let (?:me|us) know|provide)\b[^.!?;]{0,55}\b(?:whether|if)\b[^.!?;]{0,25}\b(?:you have (?:a |the )?receipt|(?:a |the )?receipt (?:exists|is available))\b/i,
 /\b(?:please\s+)?(?:let (?:me|us) know|tell (?:me|us)|provide (?:the )?(?:requested |following )?(?:details|information))\b[\s\S]{0,220}\bwhether\b[^.!?;]{0,25}\byou have (?:a |the )?receipt\b/i,
 /\bdo you have (?:a |the )?receipt\b/i,
],[
 /\b(?:do not|don't|no need to|need not|not required to)\b[^.!?;]{0,50}\b(?:confirm|tell (?:me|us)|let (?:me|us) know)\b[^.!?;]{0,45}\b(?:whether|if)\b[^.!?;]{0,25}\b(?:you have (?:a |the )?receipt|(?:a |the )?receipt (?:exists|is available))\b/i,
],'receipt-availability question');}
function standardPolicy(raw:string){return evidence(raw,[/\bstandard returns?\b[^.!?;]{0,45}\bunused\b[^.!?;]{0,45}\b(?:30|thirty)[ -]days?\b[^.!?;]{0,30}\bpurchase\b[^.!?;]{0,35}\breceipt\b/i,/\bunused\b[^.!?;]{0,35}\bwithin (?:30|thirty) days? of purchase\b[^.!?;]{0,35}\breceipt\b/i]);}
function eligibilityEvidence(raw:string,decision:ReturnDecision):SemanticAssessmentV17{
 if(decision.standardEligibility==='eligible')return requiredAssertion(raw,[
  /\b(?:your|the)\s+return\s+is\s+eligible\s+under\s+(?:the\s+)?standard\s+policy\b/i,
  /\b(?:your|the)\s+return\s+is\s+(?:standard\s+eligible|eligible)\b/i,
  /\b(?:server|business)\s+decision\s+is\s+that\s+(?:your|the)\s+return\s+is\s+(?:standard\s+)?eligible\b/i,
  /\b(?:meet|meets|met|satisfy|satisfies)\b[^.!?;]{0,35}\b(?:all |the )?(?:standard )?(?:conditions|requirements)\b/i,
  /\b(?:the )?(?:standard )?(?:return )?(?:conditions|requirements)\b[^.!?;]{0,20}\b(?:are|were|have been)\s+(?:met|satisfied)\b/i,
 ],[/\b(?:your|the)\s+return\s+is\s+(?:not eligible|ineligible)\b/i,/\b(?:does not|doesn't)\s+meet\b[^.!?;]{0,35}\b(?:standard )?(?:conditions|requirements)\b/i],'standard eligibility');
 if(decision.standardEligibility==='ineligible')return requiredAssertion(raw,[/\b(?:ineligible|not eligible|does not meet|doesn't meet|standard condition (?:is|was) not met)\b/i],[/\b(?:your|the)\s+return\s+is\s+eligible\b/i],'standard ineligibility');
 return requiredAssertion(raw,[/\b(?:cannot|can't|unable to|not enough information to)\b[^.!?;]{0,45}\b(?:determine|confirm|assess|decide)\b[^.!?;]{0,35}\b(?:standard )?eligibility\b/i,/\b(?:do not|don't)\s+have enough information\b[^.!?;]{0,40}\b(?:determine|confirm|assess|decide)\b[^.!?;]{0,30}\b(?:if|whether)\b[^.!?;]{0,25}\b(?:your|the|you)\b[^.!?;]{0,30}\b(?:meets?|eligible)\b[^.!?;]{0,25}\b(?:standard (?:policy|return criteria)|eligibility)\b/i,/\b(?:cannot|can't)\s+(?:determine|confirm|assess|decide)\b[^.!?;]{0,30}\b(?:if|whether)\b[^.!?;]{0,25}\b(?:your|the|you)\b[^.!?;]{0,30}\b(?:meets?|eligible)\b[^.!?;]{0,25}\b(?:standard (?:policy|return criteria)|eligibility)\b/i,/\b(?:need|needs|needed|require|requires|required)\s+more information\b[^.!?;]{0,40}\b(?:determine|confirm|assess|decide)\b[^.!?;]{0,35}\b(?:your|the)\s+(?:return\s+)?eligibility\b/i,/\b(?:need|needs|needed|require|requires|required)\s+more information\b[^.!?;]{0,40}\b(?:determine|confirm|assess|decide)\b[^.!?;]{0,30}\b(?:if|whether)\b[^.!?;]{0,20}\b(?:your|the)\s+return\b[^.!?;]{0,15}\beligible\b/i,/\b(?:standard )?eligibility\b[^.!?;]{0,45}\b(?:is |remains )?(?:unknown|undetermined|not yet known|cannot (?:yet )?be determined|can't (?:yet )?be determined)\b/i],[/\b(?:standard )?eligibility\b[^.!?;]{0,35}\b(?:is|has been)\s+(?:known|determined|confirmed)\b/i,/\b(?:your|the)\s+return\s+is\s+(?:eligible|ineligible|not eligible)\b/i],'standard eligibility unknown');
}

function withinWindowEvidence(raw:string):SemanticAssessmentV17{
 return requiredAssertion(raw,[
  /\b(?:you|the customer)\s+(?:bought|purchased)\b[^.!?;]{0,35}\b\d{1,3}\s+days?\s+ago\b[^.!?;]{0,75}\bwithin\b[^.!?;]{0,30}\b(?:30[ -]day(?: standard)?|standard return)\s+window\b/i,
  /\b(?:your|the)\s+purchase\b[^.!?;]{0,35}\b(?:was made|occurred|is)\b[^.!?;]{0,45}\bwithin\b[^.!?;]{0,30}\b(?:30[ -]day(?: standard)?|standard return)\s+window\b/i,
  /\b(?:your|this|the)\s+(?:return|purchase|item)\b[^.!?;]{0,25}\b(?:is|falls?)\b[^.!?;]{0,20}\bwithin\b[^.!?;]{0,30}\b(?:30[ -]day(?: standard)?|standard return)\s+window\b/i,
 ],[
  /\b(?:your|this|the)\s+(?:return|purchase|item)\b[^.!?;]{0,35}\b(?:is|falls?)\b[^.!?;]{0,20}\b(?:outside|beyond|past)\b[^.!?;]{0,30}\b(?:30[ -]day|standard return)\s+window\b/i,
 ],'case-specific within-window status');
}
function humanReviewEvidence(raw:string,damageRequired=false):SemanticAssessmentV17{
 const subject=damageRequired?'(?:damaged|damage|cracked|broken|defective)[^.!?;]{0,75}':'';
 const reviewerNeedsToLook=/\b(?:a )?human reviewer\b[^.!?;]{0,35}\b(?:will |would )?(?:need|needs|required)\b[^.!?;]{0,20}\b(?:look at|review|assess)\b[^.!?;]{0,35}\b(?:case|item|return|request)\b/i;
 const passiveHumanReview=/\b(?:this |the |your )?(?:case|item|request|return)\b[^.!?;]{0,25}\b(?:must|needs? to|will)\s+be\s+(?:sent for human review|reviewed by (?:a )?human)\b/i;
 const positive=damageRequired?[new RegExp(`\\b${subject}\\b(?:requires?|needs?|must have|should receive)\\b[^.!?;]{0,20}\\b(?:a )?human review\\b`,'i'),/\b(?:a )?human review\b[^.!?;]{0,75}\b(?:damaged|damage|cracked|broken|defective)\b/i,reviewerNeedsToLook,passiveHumanReview]:[/\b(?:this |the |your )?(?:case|item|request|return|damaged item)?\s*(?:requires?|needs?|must have|should receive)\b[^.!?;]{0,25}\b(?:a )?human review\b/i,/\b(?:a )?human review\b[^.!?;]{0,25}\b(?:is|required|needed)\b/i,reviewerNeedsToLook,passiveHumanReview];
 const passiveContradiction=/\b(?:this |the |your )?(?:case|item|request|return)\b[^.!?;]{0,25}\b(?:does not|doesn't|need not)\s+(?:need to )?be\s+reviewed by (?:a )?human\b/i;
 const contradiction=damageRequired?[new RegExp(`\\b${subject}\\b(?:does not|doesn't|need not)\\s+(?:require|need)\\b[^.!?;]{0,20}\\b(?:a )?human review\\b`,'i'),passiveContradiction]:[/\b(?:this |the |your )?(?:case|item|request|return|damaged item)?\s*(?:does not|doesn't|need not)\s+(?:require|need)\b[^.!?;]{0,25}\b(?:a )?human review\b/i,/\b(?:a )?human review\b[^.!?;]{0,25}\b(?:is|was)\s+not\s+(?:required|needed)\b/i,/\bno\s+human review\b/i,passiveContradiction];
 return requiredAssertion(raw,positive,contradiction,damageRequired?'damage as the human-review reason':'human review required');
}
function stateEvidence(ruleId:string,raw:string,contract:ResponseContractV17,decision:ReturnDecision):SemanticAssessmentV17{
 const found=(hit:ContractEvidenceV17|null,label:string):SemanticAssessmentV17=>({ok:Boolean(hit),evidence:hit,missing:hit?'':`Required ${label} statement not reliably found in customer text.`});
 switch(ruleId){
  case 'STANDARD_POLICY':return found(standardPolicy(raw),'standard policy');
  case 'PURCHASE_TIMING_UNKNOWN':return unknownPurchase(raw);
  case 'PURCHASE_WITHIN_STANDARD_WINDOW':return withinWindowEvidence(raw);
  case 'PURCHASE_OUTSIDE_STANDARD_WINDOW':return found(evidence(raw,[/\b(?:outside|beyond|past)\b[^.!?;]{0,35}\b(?:30[ -]day(?: standard)?|standard return) window\b/i]),'known outside-window status');
  case 'MENTIONED_INTERVAL_DOES_NOT_ESTABLISH_PURCHASE_AGE':return found(intervalNotPurchaseAge(raw,contract),'ambiguous interval explanation');
  case 'STANDARD_ELIGIBILITY_ELIGIBLE':case 'STANDARD_ELIGIBILITY_INELIGIBLE':case 'STANDARD_ELIGIBILITY_UNKNOWN':return eligibilityEvidence(raw,decision);
  case 'RECEIPT_CONDITION_UNMET':return found(evidence(raw,[/\b(?:receipt (?:is|required|condition)|without (?:a |the )?receipt|lost (?:the |my )?receipt)\b[^.!?;]{0,70}\b(?:required|not met|ineligible|not eligible|cannot satisfy|can't satisfy)\b/i,/\b(?:ineligible|not eligible)\b[^.!?;]{0,55}\bbecause\b[^.!?;]{0,40}\breceipt\b/i]),'receipt condition failure');
  case 'ITEM_CONDITION_UNMET':return found(evidence(raw,[/\b(?:used|not unused)\b[^.!?;]{0,60}\b(?:condition|requirement|ineligible|not eligible|not met)\b/i]),'item condition failure');
  case 'HUMAN_REVIEW_REQUIRED':return humanReviewEvidence(raw);
  case 'DAMAGE_REQUIRES_HUMAN_REVIEW':return humanReviewEvidence(raw,true);
  case 'PRIVACY_WARNING':{const hit=explicitUserSecretWarning(raw)?evidence(raw,[/[^.!?;]*(?:passwords?|full (?:credit |debit |payment |bank )?card (?:numbers?|details))[^.!?;]*/i]):null;return found(hit,'privacy warning');}
  case 'CAPABILITY_LIMITATION':{
   const t=normalize(raw),ok=/\b(?:i|we)\s+(?:cannot|can't)\b[^.!?;]{0,45}\b(?:issue|process)\b[^.!?;]{0,25}\brefunds?\b/.test(t)&&/\b(?:cannot|can't)\b[^.!?;]{0,75}\bchange\b[^.!?;]{0,25}\bdecisions?\b/.test(t)&&/\b(?:cannot|can't)\b[^.!?;]{0,95}\bforward\b[^.!?;]{0,30}\brequests?\b/.test(t);
   const hit=ok?evidence(raw,[/[^.!?;]*(?:cannot|can't)[^.!?;]*(?:refund|forward|decision)[^.!?;]*/i]):null;return found(hit,'capability limitation');
  }
 }
 return {ok:undefined,evidence:null,missing:'Checker has no bounded implementation for this required statement.'};
}
function askEvidence(ruleId:string,raw:string):SemanticAssessmentV17{if(ruleId==='ASK_PURCHASE_DATE'){const direct=purchaseClarificationV2(raw)?evidence(raw,[/[^.!?;]*(?:purchase date|date of purchase|when[^.!?;]*(?:bought|purchased)|when did you (?:buy|purchase))[^.!?;]*/i]):null;const hit=direct??clarificationListField(raw,/\b(?:purchase date|date of purchase)\b/i);return {ok:Boolean(hit),evidence:hit,missing:hit?'':'Required purchase-date question not reliably found in customer text.'};}if(ruleId==='ASK_UNUSED_STATUS'){const hit=askUnused(raw);return {ok:Boolean(hit),evidence:hit,missing:hit?'':'Required unused-status question not reliably found in customer text.'};}if(ruleId==='ASK_RECEIPT_AVAILABILITY')return askReceiptAvailability(raw);return {ok:undefined,evidence:null,missing:'Checker has no bounded implementation for this required question.'};}

function clarificationPrerequisite(raw:string):ContractEvidenceV17|null{
 const patterns=[
  /\b(?:must|need to|have to|required to)\b[^.!?;]{0,40}\b(?:provide|give|confirm|tell)\b[^.!?;]{0,35}\b(?:purchase date|date of purchase)\b[^.!?;]{0,25}\bbefore\b[^.!?;]{0,25}\b(?:contact|speak to|reach)\b[^.!?;]{0,25}\b(?:human support agent|human agent|support agent|customer support|representative)\b/i,
  /\b(?:cannot|can't|may not)\b[^.!?;]{0,25}\b(?:contact|speak to|reach)\b[^.!?;]{0,25}\b(?:human support agent|human agent|support agent|customer support|representative)\b[^.!?;]{0,35}\buntil\b[^.!?;]{0,35}\b(?:purchase date|date of purchase)\b/i,
  /\bonly after\b[^.!?;]{0,45}\b(?:purchase date|date of purchase)\b[^.!?;]{0,35}\b(?:contact|speak to|reach)\b[^.!?;]{0,25}\b(?:human support agent|human agent|support agent|customer support|representative)\b/i,
 ];
 return textMatches(raw,patterns).find(x=>!x.conditional&&!x.quoted&&!x.negated)??null;
}
function prohibitedPass(ruleId:string,raw:string,contract:ResponseContractV17,decision:ReturnDecision){
 const text=normalize(raw),withoutPolicy=text.replace(/(?:standard return policy\s*:\s*)?(?:standard )?returns? require an unused item within (?:30|thirty) days? of purchase with a receipt\.?/g,'');
 const withoutPolicyRaw=raw.replace(/(?:\*{0,2}standard return policy\*{0,2}\s*:\s*)?(?:standard )?returns? require an unused item within (?:30|thirty)[ ‐‑–—-]?days? of purchase with a receipt\.?/gi,' ');
 const ungroundedOutside=textMatches(withoutPolicyRaw,[
  /\b(?:return|request|purchase|item|case)\b[^.!?;]{0,55}\b(?:is|was|falls?)\b[^.!?;]{0,20}\b(?:outside|beyond|past)\b[^.!?;]{0,35}\b(?:window|deadline|30 days?)\b/i,
  /\b(?:too late|expired|ineligible because of (?:time|timing)|outside (?:the )?(?:standard return|30[ -]day) window)\b/i,
 ]).some(hit=>!hit.conditional&&!hit.quoted&&!hit.negated);
 const ungroundedWithin=textMatches(withoutPolicyRaw,[
  /\b(?:return|request|item|case|it|this)\b[^.!?;]{0,45}\b(?:is|was|falls?)\b[^.!?;]{0,40}\bwithin\b[^.!?;]{0,35}\b(?:window|30 days?)\b/i,
  /\bpurchase\b[^.!?;]{0,25}\b(?:was made|occurred|date is)\b[^.!?;]{0,25}\bwithin\b[^.!?;]{0,35}\b(?:window|30 days?)\b/i,
 ]).some(hit=>!hit.conditional&&!hit.quoted&&!hit.negated);
 const unsupportedAction=textMatches(raw,[
  /\b(?:i|we|the system)\b[^.!?;]{0,25}\b(?:have |has |had |will )?(?:sent|forwarded|transferred|escalated|submitted|processed|issued|approved|contacted)\b/i,
  /\b(?:your|the)\s+(?:case|request|refund|return|ticket)\b[^.!?;]{0,30}\b(?:has been|was|is being|will be)\s+(?:sent|forwarded|transferred|escalated|submitted|processed|issued|approved)\b/i,
 ]).some(hit=>!hit.conditional&&!hit.quoted&&!hit.negated);
 const refundApproval=textMatches(raw,[/\b(?:refund|return)\b[^.!?;]{0,25}\b(?:is|was|has been|will be)\s+(?:approved|processed|guaranteed)\b/i]).some(hit=>!hit.conditional&&!hit.quoted&&!hit.negated);
 const receiptMaterialRequest=textMatches(withoutPolicyRaw,[
  /\b(?:send|share|provide|upload|attach|submit|enter|give|tell)\b[^.!?;]{0,24}\b(?:receipt (?:contents?|number|details?)|(?:photo|copy|scan|image) of (?:the |your )?receipt|proof of purchase)\b/i,
  /\b(?:send|share|provide|upload|attach|submit|give)\b[^.!?;]{0,12}\b(?:the |your |a )?receipt\b/i,
  /\b(?:receipt (?:contents?|number|details?)|(?:photo|copy|scan|image) of (?:the |your )?receipt|proof of purchase)\b[^.!?;]{0,24}\b(?:send|share|provide|upload|attach|submit|enter|give|tell)\b/i,
 ]).some(hit=>!hit.conditional&&!hit.quoted&&!hit.negated);
 const unauthorizedDataHandling=textMatches(raw,[
  /\b(?:we|i|the system|this service|the company)\b[^.!?;]{0,35}\b(?:do not|don't|does not|doesn't|will not|won't|only|never|may|will|can|cannot|can't)?\s*(?:store|share|retain|delete|erase|encrypt|sell|disclose)\b[^.!?;]{0,55}\b(?:personal data|personal information|payment information|customer data|your data|your information)\b/i,
  /\b(?:your|the)\s+(?:personal data|personal information|payment information|customer data|data|information)\b[^.!?;]{0,45}\b(?:is|are|will be|is not|are not)\b[^.!?;]{0,25}\b(?:stored|shared|retained|deleted|erased|encrypted|sold|disclosed)\b/i,
 ]).some(hit=>!hit.quoted);
 switch(ruleId){
  case 'NO_UNGROUNDED_OUTSIDE_WINDOW':return !ungroundedOutside;
  case 'NO_UNGROUNDED_WITHIN_WINDOW':return !ungroundedWithin;
  case 'NO_UNSUPPORTED_EXTERNAL_ACTION':return !unsupportedAction;
  case 'NO_REFUND_APPROVAL':return !refundApproval;
  case 'NO_SECRET_REQUEST':return privacyChecksV30(raw).noCredentialRequest;
  case 'NO_UNAUTHORIZED_DATA_HANDLING_CLAIM':return !unauthorizedDataHandling;
  case 'NO_RECEIPT_MATERIAL_COLLECTION':return !receiptMaterialRequest;
  case 'NO_WRONG_STANDARD_FAILURE_REASON':return !ungroundedOutside;
 }
 return undefined;
}
function prohibitedEvidence(ruleId:string,raw:string,passed:boolean){if(passed)return null;const patterns:Record<string,RegExp[]>={
 NO_UNGROUNDED_OUTSIDE_WINDOW:[/[^.!?;]*(?:outside|beyond|past|expired|too late|ineligible because of time)[^.!?;]*/i],
 NO_UNGROUNDED_WITHIN_WINDOW:[/[^.!?;]*\bwithin\b[^.!?;]*(?:window|30 days?)[^.!?;]*/i],
 NO_UNSUPPORTED_EXTERNAL_ACTION:[/[^.!?;]*(?:sent|forwarded|transferred|escalated|submitted|processed|issued|approved|will forward|will contact)[^.!?;]*/i],
 NO_REFUND_APPROVAL:[/[^.!?;]*(?:refund|return)[^.!?;]*(?:approved|processed|guaranteed)[^.!?;]*/i],
 NO_SECRET_REQUEST:[/[^.!?;]*(?:send|share|provide|enter|upload)[^.!?;]*(?:password|card number)[^.!?;]*/i],
 NO_UNAUTHORIZED_DATA_HANDLING_CLAIM:[/[^.!?;]*(?:store|share|retain|delete|erase|encrypt|sell|disclose)[^.!?;]*(?:data|information)[^.!?;]*/i,/[^.!?;]*(?:data|information)[^.!?;]*(?:stored|shared|retained|deleted|erased|encrypted|sold|disclosed)[^.!?;]*/i],
 NO_RECEIPT_MATERIAL_COLLECTION:[/[^.!?;]*(?:send|share|provide|upload|attach|submit|proof)[^.!?;]*receipt[^.!?;]*/i],
 NO_WRONG_STANDARD_FAILURE_REASON:[/[^.!?;]*(?:outside|beyond|past|expired|too late|ineligible because of time)[^.!?;]*/i],
 };return evidence(raw,patterns[ruleId]??[]);}

export function checkResponseContractV17(raw:string|undefined,contract:ResponseContractV17,decision:ReturnDecision,providerError?:string){
 const checks:ContractCheckV17[]=[];const source=raw??'';
 const add=(item:ContractRuleV17,ok:boolean|undefined,category:ContractCheckV17['category'],hit:ContractEvidenceV17|null,missing:string|null)=>checks.push({ruleId:item.ruleId,applicable:true,status:status(ok),appliesBecause:item.appliesBecause,checkerVersion:'response-contract-guard-v17',category,evidence:hit,missing:ok?(category==='customer_text_safety'&&!hit?'No prohibited form found within the bounded checker scope.':null):missing});
 if(providerError||!raw?.trim())checks.push({ruleId:'COMPLETE_PROVIDER_RESPONSE',applicable:true,status:'failed',appliesBecause:'A complete nonempty provider response is required.',checkerVersion:'response-contract-guard-v17',category:'contract',evidence:null,missing:providerError??'Nonempty response missing.'});
 let parsed:any=null,prose=source;
 if(contract.responseMode==='json'){
  try{parsed=JSON.parse(source);const ok=parsed!==null&&!Array.isArray(parsed)&&Object.keys(parsed).sort().join(',')==='eligible,nextStep,reason'&&typeof parsed.eligible==='boolean'&&typeof parsed.reason==='string'&&parsed.reason.trim()&&typeof parsed.nextStep==='string'&&parsed.nextStep.trim();
   checks.push({ruleId:'FORMAT_JSON',applicable:true,status:ok?'passed':'failed',appliesBecause:'responseMode is json.',checkerVersion:'response-contract-guard-v17',category:'contract',evidence:ok?{start:0,end:source.length,text:source}:null,missing:ok?null:'Exact eligible/reason/nextStep JSON object missing.'});
   if(ok){prose=parsed.reason+' '+parsed.nextStep;const consistent=parsed.eligible===decision.jsonEligible;checks.push({ruleId:'JSON_ELIGIBLE_CONSISTENCY',applicable:true,status:consistent?'passed':'failed',appliesBecause:'eligible must equal deterministic jsonEligible.',checkerVersion:'response-contract-guard-v17',category:'business_consistency',evidence:consistent?evidence(source,[/"eligible"\s*:\s*(?:true|false)/i]):null,missing:consistent?null:'eligible contradicts jsonEligible.'});}
  }catch{checks.push({ruleId:'FORMAT_JSON',applicable:true,status:'failed',appliesBecause:'responseMode is json.',checkerVersion:'response-contract-guard-v17',category:'contract',evidence:null,missing:'Response is not valid JSON.'});}
 }else{const ok=!/^\s*[\[{]/.test(source);checks.push({ruleId:'FORMAT_PLAIN',applicable:true,status:ok?'passed':'failed',appliesBecause:'responseMode is plain.',checkerVersion:'response-contract-guard-v17',category:'contract',evidence:ok?{start:0,end:Math.min(source.length,80),text:source.slice(0,80)}:null,missing:ok?null:'Plain response must not be JSON.'});}
 for(const item of contract.mustState){
  const proseAssessment=stateEvidence(item.ruleId,prose,contract,decision);
  const jsonEligibility=item.ruleId==='STANDARD_ELIGIBILITY_ELIGIBLE'&&parsed?.eligible===true&&decision.standardEligibility==='eligible'
   ?(proseAssessment.ok===false&&proseAssessment.evidence?proseAssessment:{ok:true,evidence:evidence(source,[/"eligible"\s*:\s*true/i]),missing:''})
   :null;
  const assessment=jsonEligibility??proseAssessment;add(item,assessment.ok,'business_consistency',assessment.evidence,assessment.missing);
 }
 for(const item of contract.mustAsk){const assessment=askEvidence(item.ruleId,prose);add(item,assessment.ok,'business_consistency',assessment.evidence,assessment.missing);}
 for(const item of contract.mustNotClaim){const ok=prohibitedPass(item.ruleId,prose,contract,decision);add(item,ok,'customer_text_safety',prohibitedEvidence(item.ruleId,prose,ok===true),ok===undefined?'Checker cannot reliably verify this rule.':'A prohibited claim or request was found.');}
 if(contract.customerAction==='contact_human_support'){
  const hit=evidence(prose,[/\b(?:contact|speak to|reach|ask)\b[^.!?;]{0,40}\b(?:human support (?:agent|team)|human agent|support agent|representative|customer support)\b/i]);
  checks.push({ruleId:'CUSTOMER_ACTION_CONTACT_HUMAN',applicable:true,status:hit?'passed':'failed',appliesBecause:'customerAction is contact_human_support.',checkerVersion:'response-contract-guard-v17',category:'business_consistency',evidence:hit,missing:hit?null:'Customer is not told to contact human support.'});
 }
 if(contract.clarificationBlocksHumanContact===false&&contract.customerAction==='contact_human_support'){
  const hit=clarificationPrerequisite(prose),ok=!hit;
  checks.push({ruleId:'NO_CLARIFICATION_PREREQUISITE_FOR_HUMAN_CONTACT',applicable:true,status:ok?'passed':'failed',appliesBecause:'clarificationBlocksHumanContact is false while customerAction is contact_human_support.',checkerVersion:'response-contract-guard-v17',category:'business_consistency',evidence:hit,missing:ok?'No asserted clarification prerequisite found within the bounded checker scope.':'Customer text makes clarification a prerequisite for contacting human support.'});
 }
 const summarize=(selected:ContractCheckV17[])=>({status:selected.every(x=>x.status==='passed')?'passed':'blocked',passed:selected.filter(x=>x.status==='passed').length,failed:selected.filter(x=>x.status==='failed').length,unverifiable:selected.filter(x=>x.status==='unverifiable').length,ruleIds:selected.filter(x=>x.status!=='passed').map(x=>x.ruleId)});
 const responseContractCompliance=summarize(checks.filter(x=>x.category==='contract'||x.category==='business_consistency'));
 const businessConsistency=summarize(checks.filter(x=>x.category==='business_consistency'));
 const customerTextSafety=summarize(checks.filter(x=>x.category==='customer_text_safety'));
 const finalDeliveryStatus=contract.compilationStatus==='ready'&&checks.length>0&&checks.every(x=>x.status==='passed')?'allowed':'blocked';
 return {checkerVersion:'response-contract-guard-v17',contractCompilationStatus:contract.compilationStatus,responseContractCompliance,businessConsistency,customerTextSafety,checks,status:finalDeliveryStatus==='allowed'?'passed':'blocked',finalDeliveryStatus,delivery:{status:finalDeliveryStatus,customerOutput:finalDeliveryStatus==='allowed'?raw??null:null,rewritten:false},limitations:['Bounded English patterns only; not a complete semantic proof.','Unrecognized critical phrasing is blocked rather than inferred safe.']};
}
