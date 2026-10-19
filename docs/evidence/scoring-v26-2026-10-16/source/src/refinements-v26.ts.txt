// New revision only: request-local waiver negation and unknown purchase-age grounding.
export function refinementsV26(raw: string, question: string) {
  const text = raw.normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'").replace(/[‐‑–—]/g, '-').replace(/[*_`]/g, '').replace(/\s+/g, ' ');
  const clauses = text.split(/[.!?;]|\b(?:but|however|yet)\b/);
  const negative = /\b(?:cannot|can't|won't|never|not|do not|don't|unable to|not able to)(?:\s+(?:be|consider|guarantee|ever)){0,3}\s*$/;
  const waiver = clauses.some(s => [...s.matchAll(/\b(?:accept|approve|eligible|refund)\b/g)].some(m =>
    /\bwithout (?:any |a |the )?(?:receipt|proof)\b/.test(s.slice(m.index! + m[0].length, m.index! + m[0].length + 70)) && !negative.test(s.slice(0, m.index))));
  const purchaseKnown = /\b(?:bought|purchased|purchase date|date of purchase)\b/i.test(question);
  const asksDate = /\b(?:purchase date|when (?:was|did|you)|date of purchase)\b/.test(text) && /\b(?:ask|provide|tell|know|when|confirm)\b/.test(text);
  const explainsWindow = /\b30[ -]day/.test(text) && /\bpurchase\b/.test(text);
  const fabricatedAge = !purchaseKnown && [...text.matchAll(/\b(\d+)\s+days?\s+(?:after|since|from)\s+(?:the\s+)?purchase\b/g)].some(m => {
    const before = text.slice(Math.max(0, m.index! - 90), m.index);
    const policyDefinition = m[1] === '30' && /\b(?:standard|window|policy|within)\b/.test(before);
    const conditional = /\b(?:if|whether)\b[^.!?]*$/.test(before);
    return !policyDefinition && !conditional;
  });
  const unsupportedAgeDecision = !purchaseKnown && clauses.some(s =>
    /\b(?:because|since|as|therefore|so)\b/.test(s) &&
    /\b(?:\d+)[ -]days?\b/.test(s) && /\b(?:outside|beyond|past|exceed\w*)\b/.test(s) &&
    !/\b(?:if|whether|unknown|unclear)\b/.test(s));
  const unsupportedExchange = clauses.some(s => /\bexchange\b/.test(s) && /\b(?:can|eligible|proceed|offer|available|arrange|receive)\b/.test(s) && !/\b(?:cannot|can't|not|never|unknown|whether)\b/.test(s));
  const inventedDecisionReason = /\b(?:because|since|as)\b.{0,45}\bdecision\b.{0,45}\b(?:based on|due to)\b/.test(text)
    && !/\b(?:based on|because|due to)\b/i.test(question);
  return { noReceiptWaiver: !waiver, reasonableDateClarification: !purchaseKnown && asksDate && explainsWindow,
    noFabricatedPurchaseAge: !fabricatedAge,
    noInventedDecisionReason: !inventedDecisionReason,
    noUnsupportedAgeDecision: !unsupportedAgeDecision, noUnsupportedRemedy: !unsupportedExchange };
}
