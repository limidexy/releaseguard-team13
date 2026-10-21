import { z } from 'zod';
export const factsSchema = z.object({
  purchaseDaysAgo:z.number().int().min(0).max(36500).nullable(),
  unused:z.boolean().nullable(),receipt:z.boolean().nullable(),
  damaged:z.boolean(),dispute:z.boolean(),actionRequested:z.boolean(),privacy:z.boolean(),
}).strict();
export type ReturnFacts=z.infer<typeof factsSchema>;
export function decideReturnV1(input:ReturnFacts) {
  const facts=factsSchema.parse(input),missing:string[]=[];
  if(facts.purchaseDaysAgo===null)missing.push('purchase date');
  if(facts.unused===null)missing.push('whether the item is unused');
  if(facts.receipt===null)missing.push('whether a receipt exists');
  const outside=facts.purchaseDaysAgo!==null&&facts.purchaseDaysAgo>30;
  const standardEligibility: 'eligible'|'ineligible'|'unknown'=outside||facts.unused===false||facts.receipt===false?'ineligible':missing.length?'unknown':'eligible';
  const requiresHumanReview=facts.damaged||facts.dispute||facts.actionRequested||standardEligibility==='ineligible';
  return {version:'returns-decision-v1',facts,standardEligibility,outsideStandardWindow:outside,
    disposition:requiresHumanReview?'human_review':standardEligibility==='eligible'?'standard_eligible':'clarify',
    // A standard-condition match is never a refund approval or a damage decision.
    jsonEligible:standardEligibility==='eligible'&&!requiresHumanReview,requiresHumanReview,missing,
    allowedActions:['explain policy','ask missing non-sensitive facts','customer contacts human support'],
    externalActionCapability:false,refundApproved:false};
}
export type ReturnDecision=ReturnType<typeof decideReturnV1>;
const normalize=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/[’‘]/g,"'").replace(/\s+/g,' ');
// Deliberately narrow legacy-text adapter. Unsupported dates/contradictions stay
// unknown; discovery/delivery intervals never become purchase ages.
export function extractReturnFactsV1(question:string):ReturnFacts {
  const q=normalize(question);
  const ages=[...q.matchAll(/\b(?:bought|purchased)\s+(?:(?:it|the item|the product)\s+)?(\d{1,5})\s+days?\s+ago\b/g)]
    .filter(m=>!/(?:not|never|haven't|hadn't|didn't|if|whether)\s+(?:(?:i|it|was|were)\s+){0,2}$/.test(q.slice(Math.max(0,m.index!-35),m.index)));
  const values=[...new Set(ages.map(m=>Number(m[1])))];
  const uncertainty=/\b(?:not sure|don't know|do not know|unknown|maybe|perhaps|if|whether)\b/.test(q);
  const purchaseDaysAgo=values.length===1&&values[0]<=36500&&!uncertainty?values[0]:null;
  const isUnused=/\b(?:item|product|it)\s+is\s+(?:still\s+)?unused\b|\bmy unused (?:item|product)\b|^unused\b/.test(q);
  const isUsed=/\b(?:item|product|it)\s+is\s+(?:used|not unused)\b|\bi (?:have )?used (?:it|the item|the product)\b/.test(q);
  const hasReceipt=/\bi (?:still )?have (?:a |the |my )?receipt\b|\breceipt (?:is )?available\b|\bwith (?:a |the )?receipt\b/.test(q);
  const noReceipt=/\b(?:lost|missing|no|without)\b.{0,22}\breceipt\b|\breceipt\b.{0,15}\b(?:lost|missing)\b|\b(?:cannot|can't|don't|do not)\s+(?:find|have|locate)\b.{0,20}\breceipt\b/.test(q);
  return {purchaseDaysAgo,unused:uncertainty||isUnused===isUsed?null:isUnused,receipt:uncertainty||hasReceipt===noReceipt?null:hasReceipt,
    damaged:/\b(?:damag\w*|cracked|broken|defective)\b/.test(q),dispute:/\b(?:disagree|unfair|disput\w*|overturn|decision|appeal)\b/.test(q),
    actionRequested:/\b(?:issue|process|processed|pretend|forward|transfer|connect|refund tools?)\b/.test(q),
    privacy:/\b(?:passwords?|secrets?|card (?:numbers?|details)|payment credentials?)\b/.test(q)};
}
export function decisionForQuestionV1(question:string){return decideReturnV1(extractReturnFactsV1(question));}
export function decisionContextV1(question:string){
  const decision=decisionForQuestionV1(question);
  return {decision,text:'AUTHORITATIVE BUSINESS DECISION (computed before generation; explain, do not recompute):\n'+JSON.stringify(decision)};
}
