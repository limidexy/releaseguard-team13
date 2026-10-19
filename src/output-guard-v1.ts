import type {ReturnDecision} from './returns-decision-v1.js';
import {noUnsupportedActionCapability} from './returns-policy-v27.js';
import {explicitUserSecretWarning,damageTimingChecks} from './returns-policy-v28.js';
import {answerChecksV25} from './answer-v25.js';
// Separate from the frozen score: conservative, versioned delivery validation.
// Never edits an answer. Unknown semantic forms may still require human review.
export function checkExplanationV1(raw:string|undefined,decision:ReturnDecision,mode:'plain'|'json',providerError?:string) {
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
  fail('no_unsupported_action',noUnsupportedActionCapability(prose)&&answerChecksV25(prose,'').noInventedAction);
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
    fail('unknown_purchase_date_clarified',damageTimingChecks(prose,question).dateClarified||decision.facts.privacy||decision.facts.dispute||decision.facts.actionRequested);
  }
  if(decision.outsideStandardWindow)fail('known_expiry_explained',/\b(?:outside|beyond|past)\b/.test(prose)&&/\b30[ -]days?\b/.test(text));
  if(!decision.jsonEligible)fail('no_unsupported_eligibility',! /\b(?:you are|(?:your|the) item is)\s+(?:now\s+)?eligible\b|\byou meet all (?:three )?(?:requirements|conditions)\b|\b(?:you qualify|(?:your|the) item qualifies) for (?:a |the )?return\b|\b(?:you|the customer) can return\b/.test(prose));
  const policyExplanation=!decision.facts.privacy&&!decision.facts.dispute&&!decision.facts.actionRequested;
  if(policyExplanation)fail('all_standard_conditions',/\bunused\b/.test(text)&&/\b30[ -]days?\b/.test(text)&&/\bpurchase\b/.test(text)&&/\breceipt\b/.test(text));
  fail('no_refund_approval',! /\b(?:refund|return)\s+(?:is|was|has been)\s+(?:approved|processed|guaranteed)\b/.test(prose));
  return {version:'explanation-guard-v1',passed:failures.length===0,failures,delivery:{status:failures.length?'blocked':'allowed',customerOutput:failures.length?null:raw??null,rewritten:false}};
}
