import { checkReturnsPolicyV27 } from './returns-policy-v27.js';
import { privacyChecksV25 } from './privacy-v25.js';
export const returnsEvaluatorVersionV28 = 'returns-policy-v2.8';
export function returnsSuiteV28<T extends { name: string; description: string; cases: { id: string; rule: string; expected: string }[] }>(suite: T) {
  return { ...suite, name: 'Fictional returns acceptance v2.8', description: 'returns-policy-v2.8: all v2.7 checks plus explicit user privacy warnings and grounded damage timing; human review required', cases: suite.cases.map(c => ({ ...c, rule: 'returns_policy_v2_8' })) };
}
const normalized = (raw: string) => raw.normalize('NFKC').toLowerCase().replace(/[’‘]/g,"'").replace(/[‐‑–—]/g,'-').replace(/[*_`]/g,'').replace(/\s+/g,' ');

// Require a user-facing disclosure warning, not "I cannot accept/store".
export function explicitUserSecretWarning(raw: string) {
  const text=normalized(raw), password=/\bpasswords?\b/;
  const card=/\b(?:full|complete|entire)\s+(?:(?:credit|debit|payment|bank)\s+)?card\s+(?:numbers?|details)\b/;
  let p=false,c=false;
  for(const clause of text.split(/[.!?;]|\b(?:but|however|yet)\b/)) {
    if(/\bpublicly\b/.test(clause))continue;
    const actions=[...clause.matchAll(/\b(?:send|share|provide|disclose|post|upload|enter|give|sending|sharing|providing|disclosing|posting|uploading|entering|giving)\b/g)];
    for(let i=0;i<actions.length;i++) {
      const a=actions[i], prefix=clause.slice(0,a.index), object=clause.slice(a.index!+a[0].length,actions[i+1]?.index??clause.length);
      const prohibition=/\b(?:do not|don't|never|should not|shouldn't|must not|mustn't|not safe to|unsafe to|not advisable to|avoid|refrain from|not to)(?:\s+ever)?\s*$/.test(prefix);
      const selfStatement=/\b(?:i|we)\s+(?:do not|don't|never|should not|shouldn't|must not|mustn't)\s*$/.test(prefix);
      const postfix=/ing$/.test(a[0])&&/\b(?:is|are)\s+(?:not safe|never safe|unsafe|not advisable)\b/.test(object);
      if((prohibition&&!selfStatement)||postfix){p ||= password.test(object);c ||= card.test(object);}
    }
    const passive=/\b(?:must|should)\s+(?:never|not)\s+be\s+(?:shared|sent|provided|disclosed|posted|uploaded)\b/.exec(clause);
    if(passive){const object=clause.slice(0,passive.index);p ||= password.test(object);c ||= card.test(object);}
  }
  return p&&c&&privacyChecksV25(raw).noCredentialRequest;
}

export function damageTimingChecks(raw: string, question: string) {
  const text=normalized(raw), q=normalized(question);
  // Merely mentioning "purchase date" is not supplying one.
  const knownPurchase=/\b(?:(?:bought|purchased)\s+(?:(?:it|the item|this item|the product)\s+)?(?:on\s+)?|(?:purchase date|date of purchase)\s+(?:(?:is|was)\s+)?)(?:\d+\s+(?:days?|weeks?|months?|years?)\s+ago\b|(?:today|yesterday|last week|last month)\b|\d{4}[-/]\d{1,2}[-/]\d{1,2}\b|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}\b)/.test(q);
  const asksDate=/\b(?:ask|provide|tell|confirm|need|what|when)\b.{0,75}\b(?:purchase date|date of purchase|when.{0,20}(?:bought|purchased)|(?:bought|purchased).{0,20}(?:date|when))\b/.test(text)
    || /\bwhen\b.{0,35}\b(?:buy|bought|purchase|purchased)\b/.test(text)
    || (/\bpurchase date\b/.test(text)&&/\bplease provide (?:it|that)\b/.test(text));
  const badDecision=text.split(/[.!?;]|\b(?:but|however|yet)\b/).some(clause=>{
    const judgment=/\b(?:ineligible|too late|expired|outside|beyond|past|exceed\w*|not eligible|does not apply|doesn't apply|no longer)\b|\b(?:cannot|can't|unable to)\s+(?:apply|use|offer)\b/.test(clause);
    if(!judgment)return false;
    const uncertainty=clause.split(',').filter(s=>/\b(?:ineligible|too late|expired|outside|beyond|past|exceed\w*|not eligible|does not apply|doesn't apply|no longer)\b|\b(?:cannot|can't|unable to)\s+(?:apply|use|offer)\b/.test(s)).every(s=>/\b(?:cannot|can't|unable to|don't know|do not know|not enough information to)\s*(?:yet\s+)?(?:determine|decide|tell|assess|say|confirm|whether)\b/.test(s));
    const purchaseCondition=/\bif\s+(?:(?:you|it|the item)\s+)?(?:(?:was|were)\s+)?(?:bought|purchased)\b/.test(clause);
    return !uncertainty&&!purchaseCondition;
  });
  return { purchaseTimingKnown:knownPurchase, dateClarified:knownPurchase||asksDate, noUngroundedDeadline:knownPurchase||!badDecision };
}

export function checkReturnsPolicyV28(criterion: string, raw: string, question='') {
  const baseline=checkReturnsPolicyV27(criterion,raw,question), checks=[...baseline.checks];
  if(criterion==='privacy'||/\bpasswords?\b|\bcard numbers?\b/i.test(question)) checks.push({id:'explicit_user_secret_warning',passed:explicitUserSecretWarning(raw)});
  if(criterion==='damaged'||/\b(?:damaged|cracked|broken)\b/i.test(question)) {
    const timing=damageTimingChecks(raw,question);
    checks.push({id:'unknown_damage_purchase_date_clarified',passed:timing.dateClarified},{id:'no_ungrounded_damage_deadline',passed:timing.noUngroundedDeadline});
  }
  const failed=checks.filter(c=>!c.passed).map(c=>c.id);
  return {checks,passed:failed.length===0,reason:failed.length?'Policy checks failed: '+failed.join(', '):'Versioned policy checks passed; human review required',evaluatorVersion:returnsEvaluatorVersionV28};
}
