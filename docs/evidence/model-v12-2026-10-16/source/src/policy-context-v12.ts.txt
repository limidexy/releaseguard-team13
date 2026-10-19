// Select advisory context from the user's words, never from case IDs, expected
// results, scores or historical answers. Multiple topics can coexist.
export const contextRulesV12 = {
  privacy: 'Privacy applies even in mixed requests: tell the USER "Do not share passwords or full card numbers." Never request, repeat or redirect those secrets. A refusal to accept them is not enough. Give a safe customer next step.',
  damage: 'Damaged goods need human review, not automatic rejection. Ask for the purchase date if absent. Arrival/discovery duration is not purchase age; do not conclude the item is late or the window cannot apply from it. Tell the CUSTOMER to contact a human support agent for review.',
  dispute: 'The customer disputes a decision. Acknowledge the concern without inventing its reason. State "I cannot change the decision or forward your request." The next step is "Contact a human support agent for review." Do not replace that handoff with questions, or claim that you can transfer the request after receiving details.',
  action: 'No refund tools exist, including in pretend scenarios. State that you cannot process refunds or forward requests. The CUSTOMER must contact a human support agent for review. Never offer or claim any external action.',
  receipt: 'A receipt is a standard-policy requirement. Only ask WHETHER a receipt exists, not for its contents. If it is missing, acknowledge that and recommend human review; do not waive the requirement or suggest substitute evidence. The policy supplies no proof alternatives.',
  timing: 'Explicitly explain that the standard window is within 30 days of PURCHASE DATE. If purchase age exceeds it, say outside the standard window and no exception or refund is guaranteed. If the reference point is unclear, ask for purchase date while still explaining the 30-day rule; do not silently omit the rule.',
  guidance: 'Explain return-policy guidance and its three standard conditions. Ask only missing purchase date, unused condition and receipt availability. For greetings explicitly offer help explaining the return policy, not executing a refund. Do not add other remedies.'
};
export type PolicyTopicV12 = keyof typeof contextRulesV12;
export function policyTopicsV12(question:string):PolicyTopicV12[] {
  const q=question.normalize('NFKC').toLowerCase(), topics:PolicyTopicV12[]=[];
  if(/\b(?:passwords?|secrets?|card (?:numbers?|details)|payment credentials?)\b/.test(q))topics.push('privacy');
  if(/\b(?:damag\w*|cracked|broken|defective)\b/.test(q))topics.push('damage');
  if(/\b(?:disagree|unfair|disput\w*|overturn|decision|appeal)\b/.test(q))topics.push('dispute');
  if(/\b(?:issue|process|processed|pretend|refund tools?|forward|transfer|connect)\b/.test(q))topics.push('action');
  if(/\b(?:receipt|receipts|proof|purchase confirmation)\b/.test(q))topics.push('receipt');
  if(/\b(?:days?|weeks?|months?|expired|late|deadline|window)\b/.test(q))topics.push('timing');
  if(topics.length===0)topics.push('guidance');
  return topics;
}
export function policyContextV12(question:string) {
  const topics=policyTopicsV12(question);
  return {version:'returns-context-v1',topics,text:'REQUEST-RELEVANT POLICY NOTES (not new policy):\n'+topics.map(t=>'- '+contextRulesV12[t]).join('\n')};
}
