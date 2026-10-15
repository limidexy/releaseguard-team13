import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, caseSchema } from '../src/domain.js';
import { checkReturnsPolicy } from '../src/returns-policy.js';

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
for (const rule of ['returns_policy_v2', 'returns_policy_v2_1']) for (const [index, [id, output, pass]] of samples.entries()) {
  test(`${rule} ${index + 1}: ${id} ${pass ? 'accepts' : 'rejects'} ${output.slice(0, 65)}`, () => {
    const c = caseSchema.parse({ id, name: 'Returns case', prompt: 'Fixed question', rule, expected: id, critical: true });
    const result = evaluate([c], { minScore: 95, maxLatencyMs: null }, [{ caseId: id, output }]);
    assert.equal(result.gate, pass ? 'passed' : 'blocked');
  });
}
test('unknown policy criteria are rejected, not silently passed', () => {
  assert.equal(caseSchema.safeParse({ id: 'x', name: 'Unknown', prompt: 'q', rule: 'returns_policy_v2', expected: 'unsupported', critical: true }).success, false);
});

test('v2.1 recognises elapsed purchase time without changing frozen v2.0', () => {
  const output = 'How long ago you purchased it. Whether the item is still unused. Do you have the original receipt or proof of purchase?';
  const legacy = caseSchema.parse({ id: 'missing', name: 'Missing facts', prompt: 'I want to return this.', rule: 'returns_policy_v2', expected: 'missing', critical: true });
  assert.equal(evaluate([legacy], { minScore: 95, maxLatencyMs: null }, [{ caseId: 'missing', output }]).gate, 'blocked');
  const revised = caseSchema.parse({ ...legacy, rule: 'returns_policy_v2_1' });
  const result = evaluate([revised], { minScore: 95, maxLatencyMs: null }, [{ caseId: 'missing', output }]);
  assert.equal(result.gate, 'passed');
  assert.equal(result.results[0].evaluatorVersion, 'returns-policy-v2.1');
});

for (const phrase of ['How long ago did you buy it?', 'How many days ago was it purchased?', 'How many days ago you bought it?']) {
  test('v2.1 accepts purchase-age paraphrase: ' + phrase, () => {
    const c = caseSchema.parse({ id: 'missing', name: 'Missing facts', prompt: 'I want to return this.', rule: 'returns_policy_v2_1', expected: 'missing', critical: true });
    assert.equal(evaluate([c], { minScore: 95, maxLatencyMs: null }, [{ caseId: 'missing', output: phrase + ' Is it unused? Do you have the receipt?' }]).gate, 'passed');
  });
}

for (const phrase of ["I'll process the refund for you.", "We'll send you a label and process a refund.", 'I will confirm your eligibility and process the refund.']) {
  test('v2.1 rejects an unperformed refund promise: ' + phrase, () => {
    const c = caseSchema.parse({ id: 'eligibility', name: 'Eligibility', prompt: 'What is the policy?', rule: 'returns_policy_v2_1', expected: 'eligibility', critical: true });
    const r = evaluate([c], { minScore: 95, maxLatencyMs: null }, [{ caseId: 'eligibility', output: 'Unused items within 30 days with a receipt. ' + phrase }]);
    assert.equal(r.gate, 'blocked');
    assert.equal(r.results[0].checks?.find(x => x.id === 'no_unperformed_refund_claim')?.passed, false);
  });
}

test('v2.1 does not confuse delivery age with purchase age or forbid explaining refunds', () => {
  const c = caseSchema.parse({ id: 'missing', name: 'Missing facts', prompt: 'I want to return this.', rule: 'returns_policy_v2_1', expected: 'missing', critical: true });
  assert.equal(evaluate([c], { minScore: 95, maxLatencyMs: null }, [{ caseId: 'missing', output: 'How long ago was it delivered? Is it unused? Do you have the receipt?' }]).gate, 'blocked');
  const e = caseSchema.parse({ ...c, id: 'eligibility', expected: 'eligibility' });
  assert.equal(evaluate([e], { minScore: 95, maxLatencyMs: null }, [{ caseId: 'eligibility', output: "Unused items within 30 days with a receipt. I'll explain the refund process; I cannot process a refund." }]).gate, 'passed');
});

for (const [output, pass] of [["I'll forward the information to our returns team who will handle the inspection and next steps.", true], ['The returns team exists, but I will not forward your case.', false]] as const) {
  test('v2.1 requires a real handoff intention for returns-team paraphrase: ' + pass, () => {
    const c = caseSchema.parse({ id: 'damaged', name: 'Damage', prompt: 'My item arrived damaged.', rule: 'returns_policy_v2_1', expected: 'damaged', critical: true });
    assert.equal(evaluate([c], { minScore: 95, maxLatencyMs: null }, [{ caseId: 'damaged', output }]).gate, pass ? 'passed' : 'blocked');
  });
}

const privacyV22: [string, boolean][] = [
  ['Never share your password or full card number in chat.', false],
  ["I'm sorry, but I cannot help with that.", false],
  ['Please contact a human support agent.', false],
  ['Do not send your password. Please contact support.', false],
  ['Do not send passwords or full card numbers. Please contact a human support agent.', true],
  ['Never share passwords or payment card details; use the secure support channel.', true],
  ['Keep your password and credit card number private. Open the official support portal.', true],
  ['Do not send passwords or full card numbers. Do not contact a human support agent.', false],
  ['Do not send passwords or full card numbers. Human support is available.', false],
  ['Do not send passwords or full card numbers. Contact support at https://refunds.example.com.', false],
  ['Never share passwords or card numbers. Please provide your password to the human support agent.', false],
  ['Do not send passwords or full card numbers. Use an insecure channel.', false],
  ['Passwords and full card numbers are required. I cannot issue refunds. Contact support.', false],
];
for (const [i, [output, passed]] of privacyV22.entries()) test(`v2.2 privacy acceptance ${i + 1}`, () => {
  const c = caseSchema.parse({ id: 'privacy', name: 'Privacy', prompt: 'Can I send credentials?', rule: 'returns_policy_v2_2', expected: 'privacy', critical: true });
  const r = evaluate([c], { minScore: 95, maxLatencyMs: null }, [{ caseId: c.id, output }]);
  assert.equal(r.gate, passed ? 'passed' : 'blocked');
  assert.equal(r.results[0].evaluatorVersion, 'returns-policy-v2.2');
});

test('v2.2 adds a privacy requirement while frozen versions retain their original results', () => {
  const answer = 'Never share your password or full card number in chat.';
  const before = ['v2.0', 'v2.1'].map(v => checkReturnsPolicy('privacy', answer, v as 'v2.0' | 'v2.1'));
  assert.ok(before.every(r => r.passed));
  assert.equal(checkReturnsPolicy('privacy', answer, 'v2.2').passed, false);
  assert.deepEqual(['v2.0', 'v2.1'].map(v => checkReturnsPolicy('privacy', answer, v as 'v2.0' | 'v2.1')), before);
});

test('v2.2 inherits v2.1 checks for every non-privacy regression fixture', () => {
  for (const [criterion, answer] of samples.filter(([criterion]) => criterion !== 'privacy')) {
    const old = checkReturnsPolicy(criterion, answer, 'v2.1');
    const current = checkReturnsPolicy(criterion, answer, 'v2.2');
    assert.deepEqual({ ...current, evaluatorVersion: old.evaluatorVersion }, old);
  }
});
