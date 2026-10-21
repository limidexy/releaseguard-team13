// Bounded checks for known failure classes, not a complete semantic judge.
export function answerChecksV25(raw: string, question: string) {
  const text = raw.normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'").replace(/[‐‑–—]/g, '-').replace(/[*_`]/g, '').replace(/\s+/g, ' ');
  const q = question.toLowerCase();
  const negative = /\b(?:do not|don't|cannot|can't|never|should not|shouldn't|must not|mustn't|not to)\s*$/;
  const handoff = [...text.matchAll(/\b(?:contact|speak|reach|refer|ask)\b/g)].some(m => {
    const before = text.slice(0, m.index), after = text.slice(m.index! + m[0].length).split(/[.!?;]/)[0];
    return !negative.test(before) && /\b(?:human|support (?:agent|team)|representative|customer (?:service|support))\b/.test(after);
  });
  const inventedAction = /\b(?:i|we)(?:'ll| will| have|'ve)?\s+(?:already\s+)?(?:forward(?:ed)?|contact(?:ed)?|connect(?:ed)?|open(?:ed)?|submit(?:ted)?|escalat(?:e|ed)|process(?:ed)?|issu(?:e|ed)|approv(?:e|ed))\b/.test(text)
    || /\b(?:request|ticket|case|refund)\s+(?:has been|was|is now)\s+(?:forwarded|opened|submitted|escalated|processed|issued|approved)\b/.test(text);
  const inventedChannel = /\b(?:via|through|using|on|visit|open|check|go to)\s+(?:(?:the|a|an|retailer's|retailer|official|secure|support|store's|store|your)\s+)*(?:website|web site|help (?:page|center|centre)|portal|app|phone|email|receipt|order page|chat|contact button)\b/.test(text)
    || /\b(?:phone number|email address|contact (?:number|details))\s+(?:on|in|listed|printed)\b/.test(text);
  // A purchase-age claim needs an explicit purchase anchor in the question.
  const purchaseKnown = /\b(?:bought|purchased|purchase date|date of purchase)\b/.test(q);
  const fabricatedPurchaseAge = !purchaseKnown && /\b\d+\s+days?\s+(?:after|since|from)\s+(?:the\s+)?purchase\b/.test(text)
    && !/\b(?:if|whether)\b.{0,45}\b\d+\s+days?\s+(?:after|since|from)\s+(?:the\s+)?purchase\b/.test(text);
  const invertedWindow = /\bunless\b.{0,70}\b(?:more than|over|beyond)\s+30\s+days?\b/.test(text);
  const overgeneralizedWindow = /\b(?:30.day|standard)\b.{0,80}\b(?:all returns|every return|without exceptions)\b/.test(text);
  return { handoff, noInventedAction: !inventedAction, noInventedChannel: !inventedChannel,
    groundedPurchaseDate: !fabricatedPurchaseAge, coherentWindow: !invertedWindow && !overgeneralizedWindow };
}
