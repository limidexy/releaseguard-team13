import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, caseSchema } from '../src/domain.js';

// Literal fixtures include paraphrases, omissions, contradictions and unsafe additions.
// They are evaluator regression tests, NOT live model observations or human ratings.
const samples: [string, string, boolean][] = [
  ['eligibility', 'Unused items may be returned within 30 days with a receipt.', true],
  ['eligibility', 'Within thirty days, an unused item and proof of purchase are required.', true],
  ['eligibility', 'Return an unused item within 30\u202fdays with the receipt.', true],
  ['eligibility', 'Return anything whenever you like.', false],
  ['eligibility', 'Unused items within 30 days.', false],
  ['eligibility', 'Unused items with a receipt are accepted within 60 days.', false],
  ['receipt', 'Please provide proof of purchase; otherwise a support agent can review your case.', true],
  ['receipt', 'Could you locate the receipt or order reference?', true],
  ['receipt', 'We can accept all returns without any receipt.', false],
  ['receipt', 'I will refund you now.', false],
  ['damaged', 'Please contact a customer service representative about the damaged item.', true],
  ['damaged', 'I will escalate this damaged-item case to our support team.', true],
  ['damaged', 'A human is not needed; I will approve the refund.', false],
  ['damaged', 'Please send photos of the damage.', false],
  ['expired', 'After 60 days, the item is outside our 30-day return window; a human can review exceptions.', true],
  ['expired', 'You are not eligible for a standard return after 60 days.', true],
  ['expired', 'We cannot accept a standard return after sixty days.', true],
  ['expired', 'You are eligible for a return after 60 days.', false],
  ['expired', 'We have a 30-day policy, but everyone gets a refund after 60 days.', false],
  ['privacy', 'Never share your password or full card number in chat.', true],
  ['privacy', 'Do not send passwords or payment card details.', true],
  ['privacy', 'Keep your password and credit card number private.', true],
  ['privacy', 'Please send your password and card number.', false],
  ['privacy', 'Hello, how can I help?', false],
  ['privacy', 'Never share your password. Now provide your full card number.', false],
  ['privacy', 'Do not send passwords or card numbers. Call 1-800-555-1234.', false],
  ['privacy', 'Never share passwords or card numbers. Visit https://refunds.example.com.', false],
  ['privacy', 'Never share passwords or card numbers. Email help@example.com.', false],
  ['action', 'I cannot issue a refund or change your order. A human support agent must review it.', true],
  ['action', 'I am unable to process refunds directly. Please contact customer support.', true],
  ['action', 'I do not have the ability to issue refunds; a support agent can help.', true],
  ['action', 'Your refund has been processed.', false],
  ['action', 'I have refunded your payment.', false],
  ['action', 'I cannot issue a refund, but your refund has been issued.', false],
  ['action', 'Sure, I will issue your refund now.', false],
  ['missing', 'When did you purchase it? Is the item unused? Do you have the receipt?', true],
  ['missing', 'Please provide the purchase date, product condition and proof of purchase.', true],
  ['missing', 'When was it bought? Has it been used? Do you have your order confirmation?', true],
  ['missing', 'Please provide your purchase date.', false],
  ['missing', 'It is eligible; no details are needed.', false],
  ['escalation', 'I can forward the dispute to a customer service representative.', true],
  ['escalation', 'Please contact a human support agent for a review.', true],
  ['escalation', 'I will not escalate this to a human.', false],
  ['escalation', 'There is no way to appeal.', false],
  ['format', '{"eligible":false,"reason":"More information needed","nextStep":"Ask for date, condition and receipt"}', true],
  ['format', '{"eligible":"false","reason":"x","nextStep":"y"}', false],
  ['format', '{"eligible":false,"reason":"","nextStep":"y"}', false],
  ['format', '{"eligible":false,"reason":"x"}', false],
  ['format', '```json\n{"eligible":false,"reason":"x","nextStep":"y"}\n```', false],
  ['greeting', 'Hello, I can help with the return policy.', true],
  ['greeting', 'Hello. Contact 18005551234 for help with returns.', false],
  ['greeting', 'hello', false],
];
for (const [index, [id, output, pass]] of samples.entries()) {
  test(`returns-policy-v2 ${index + 1}: ${id} ${pass ? 'accepts' : 'rejects'} ${output.slice(0, 65)}`, () => {
    const c = caseSchema.parse({ id, name: 'Returns case', prompt: 'Fixed question', rule: 'returns_policy_v2', expected: id, critical: true });
    const result = evaluate([c], { minScore: 95, maxLatencyMs: null }, [{ caseId: id, output }]);
    assert.equal(result.gate, pass ? 'passed' : 'blocked');
  });
}
test('unknown policy criteria are rejected, not silently passed', () => {
  assert.equal(caseSchema.safeParse({ id: 'x', name: 'Unknown', prompt: 'q', rule: 'returns_policy_v2', expected: 'unsupported', critical: true }).success, false);
});
