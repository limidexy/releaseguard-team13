import type {ReturnDecision} from './returns-decision-v1.js';
import {noUnsupportedActionCapability} from './returns-policy-v27.js';
import {explicitUserSecretWarning,damageTimingChecks} from './returns-policy-v28.js';
import {answerChecksV25} from './answer-v25.js';

// Scope each claim independently. A conditional or denial elsewhere cannot
// excuse a separate assertion. These bounded English checks are not a semantic proof.
const normalizeV2=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/[’‘]/g,"'").replace(/[‐‑–—]/g,'-').replace(/[*_\x60]/g,'').replace(/\s+/g,' ');
export function unperformedOperationV2(raw:string){
 const text=normalizeV2(raw);
 const verbs='(?:sent|forwarded|transferred|escalated|submitted|processed|issued|approved|opened|overturned|changed)';
 for(const sentence of text.split(/[.!?;]/)){
  const pieces=sentence.split(/\b(?:but|however|yet)\b/);
  for(const part of pieces){
   const rx=new RegExp('\\b(?:(?:the|your|this)\\s+(?:case|request|ticket|refund|return|concern|message|decision)|it|i|we)\\b(?:\'s|\'ve)?[^.!?;]{0,70}?\\b'+verbs+'\\b','g');
   for(const match of part.matchAll(rx)){
    const verb=new RegExp('\\b'+verbs+'\\b').exec(match[0])!;
    const prefix=match[0].slice(0,verb.index);
    const denied=/\b(?:not|never|n't)\s+(?:(?:yet|already|currently|being|been|ever|now)\s+)*$/.test(prefix)
      ||/\b(?:hasn't|haven't|wasn't|weren't|isn't|aren't|won't|can't|cannot)\s+(?:(?:be|been|being|ever|yet)\s+)*$/.test(prefix);
    // Past/ongoing/passive assertions, not instructions for the customer.
    const assertion=/^(?:i|we)\b/.test(match[0])||/\b(?:is|are|was|were|be|been|being|has|have|will)\b|'s\b/.test(prefix);
    if(assertion&&!denied)return true;
   }
  }
 }
 return false;
}
export function unsupportedEligibilityV2(raw:string){
 const text=normalizeV2(raw).replace(/\byou're\b/g,'you are');
 const claim=/\b(?:you are|(?:your|the) item is)\s+(?:now\s+)?eligible\b|\byou meet all (?:three )?(?:requirements|conditions)\b|\b(?:you qualify|(?:your|the) item qualifies) for (?:a |the )?return\b|\b(?:you|the customer) can return\b/g;
 for(const clause of text.split(/[.!?;]|\b(?:but|however|yet)\b/)){
  for(const m of clause.matchAll(claim)){
   const before=clause.slice(0,m.index),after=clause.slice(m.index!+m[0].length);
   const query=/\b(?:if|whether)\s*$/.test(before);
   const allConditions=/\bunused\b/.test(clause)&&/\b30[ -]days?\b/.test(clause)&&/\bpurchase\b/.test(clause)&&/\breceipt\b/.test(clause);
   const onlyIf=/^[^,]{0,45}\bonly if\b/.test(after)&&allConditions;
   const conditionalBefore=/^\s*if\b[^,]*,\s*$/.test(before)&&allConditions;
   if(!query&&!onlyIf&&!conditionalBefore)return true;
  }
 }
 return false;
}
export function purchaseClarificationV2(raw:string){
 const text=normalizeV2(raw);
 const date='(?:purchase date|date of purchase|when (?:you |it was )?(?:bought|purchased|buy)|how many days ago (?:you )?(?:bought|purchased))';
 for(const clause of text.split(/[.!?;]|\b(?:but|however|yet)\b/)){
  const ask=new RegExp('\\b(?:let (?:me|us) know|provide|tell (?:me|us)|confirm|what is|when did you|need)\\b.{0,75}\\b'+date+'\\b').exec(clause);
  if(ask&&!/\b(?:do not|don't|no need to|not need to|never|cannot|can't)\s*$/.test(clause.slice(0,ask.index)))return true;
  if(/\bwhen did you (?:buy|purchase)\b/.test(clause))return true;
 }
 return false;
}
// Separate from the frozen score: conservative, versioned delivery validation.
// Never edits an answer. Unknown semantic forms may still require human review.
export function checkExplanationV2(raw:string|undefined,decision:ReturnDecision,mode:'plain'|'json',providerError?:string) {
  const failures:string[]=[];const fail=(id:string,ok:boolean)=>{if(!ok)failures.push(id);};
  fail('complete_provider_response',!providerError&&typeof raw==='string'&&raw.trim().length>0);
  const text=(raw??'').normalize('NFKC').toLowerCase().replace(/[’‘]/g,"'").replace(/[‐‑–—]/g,'-').replace(/[*_`]/g,'').replace(/\s+/g,' ');
  let prose=text;
  if(mode==='json'){
    try {const x=JSON.parse(raw??'');
      fail('exact_json_contract',x!==null&&!Array.isArray(x)&&Object.keys(x).sort().join(',')==='eligible,nextStep,reason'&&typeof x.eligible==='boolean'&&typeof x.reason==='string'&&x.reason.trim().length>0&&typeof x.nextStep==='string'&&x.nextStep.trim().length>0);
      fail('decision_eligible_consistency',x.eligible===decision.jsonEligible);
      prose=[x.reason,x.nextStep].filter(v=>typeof v==='string').join(' ').toLowerCase().replace(/[’‘]/g,"'");
    }catch{fail('exact_json_contract',false);}
  }else fail('plain_language_contract',!/^\s*[\[{]/.test(raw??''));
  fail('no_unsupported_action',noUnsupportedActionCapability(prose)&&answerChecksV25(prose,'').noInventedAction&&!unperformedOperationV2(prose));
  // Closed policy vocabulary: reject unsolicited remedies/mechanisms even when
  // wrapped in a disclaimer. This may overblock; it is not a completeness claim.
  fail('no_policy_additions',! /\b(?:exchange|replacement|store credit|packaging|tags|store location|store desk|in.store|original receipt|proof (?:that|of) (?:the )?(?:item|product)|proof of purchase|alternative (?:proof|evidence)|other (?:proof|evidence)|documentation|original condition)\b/.test(prose));
  fail('no_invented_channel',answerChecksV25(prose,'').noInventedChannel&&!/https?:\/\/|www\.|\b(?:website|portal|phone|email|store|app)\b/.test(prose));
  if(decision.facts.privacy){
    fail('explicit_user_privacy_warning',explicitUserSecretWarning(prose));
    const exception=prose.split(/[.!?;]|\b(?:but|however|yet)\b/).some(clause=>{
      const request=/\b(?:provide|send|share|enter|disclose)\s+(?:(?:your|the|those|that)\s+)?(?:it|them|information|details|passwords?|full (?:credit )?card numbers?)\b/.exec(clause);
      if(!request)return false;
      const before=clause.slice(0,request.index);
      const prohibited=/\b(?:do not|don't|never|should not|shouldn't|must not|mustn't|not safe to)\s*$/.test(before);
      return !prohibited&&/\b(?:only|instead|secure|official|channel|required|privately|through|via)\b/.test(clause);
    });
    fail('no_privacy_channel_exception',!exception);
  }
  if(decision.requiresHumanReview)fail('customer_human_handoff',answerChecksV25(prose,'').handoff);
  if(decision.facts.purchaseDaysAgo===null){
    const question='Purchase timing is unknown.';
    const deadlineText=decision.standardEligibility==='ineligible'?prose.replace(/\b(?:ineligible|not eligible)\b/g,'standard condition unmet'):prose;
    fail('no_unknown_deadline_decision',damageTimingChecks(deadlineText,question).noUngroundedDeadline);
    fail('unknown_purchase_date_clarified',purchaseClarificationV2(prose)||decision.facts.privacy||decision.facts.dispute||decision.facts.actionRequested);
  }
  if(decision.outsideStandardWindow)fail('known_expiry_explained',/\b(?:outside|beyond|past)\b/.test(prose)&&/\b30[ -]days?\b/.test(text));
  if(!decision.jsonEligible)fail('no_unsupported_eligibility',!unsupportedEligibilityV2(prose));
  const policyExplanation=!decision.facts.privacy&&!decision.facts.dispute&&!decision.facts.actionRequested;
  if(policyExplanation)fail('all_standard_conditions',/\bunused\b/.test(text)&&/\b30[ -]days?\b/.test(text)&&/\bpurchase\b/.test(text)&&/\breceipt\b/.test(text));
  fail('no_refund_approval',! /\b(?:refund|return)\s+(?:is|was|has been)\s+(?:approved|processed|guaranteed)\b/.test(prose));
  return {version:'explanation-guard-v2',passed:failures.length===0,failures,delivery:{status:failures.length?'blocked':'allowed',customerOutput:failures.length?null:raw??null,rewritten:false}};
}
