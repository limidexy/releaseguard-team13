import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, suiteSchema } from '../src/domain.js';
import { checkReturnsPolicy } from '../src/returns-policy.js';
const q = 'I disagree with the return policy decision.';
const next = ' Contact a human support agent for review.';
const result = (answer: string, criterion = 'escalation') => evaluate([{ id: 'case', name: 'Case', prompt: q, rule: 'returns_policy_v2_7', expected: criterion, critical: true }] as any, { minScore: 95, maxLatencyMs: null }, [{ caseId: 'case', output: answer }]);
const bad = [
  'I can forward your concern for a human review.',
  'I could forward your case.', 'We can contact staff for you.',
  "I'm able to open a ticket.", 'We are able to connect you to support.',
  'I have the ability to escalate your case.', 'I can help you contact support.',
  'Let me forward the request.', 'I cannot issue refunds, but can forward your concern.',
  'I can explain the policy and forward your case.',
  'I cannot change the decision. However, I can submit your appeal.',
];
for (const answer of bad) test('v2.7 blocks unsupported capability: ' + answer, () => {
  const r = result(answer + next);
  assert.equal(r.gate, 'blocked');
  assert.equal(r.results[0].checks?.find(c => c.id === 'no_unsupported_action_capability')?.passed, false);
});
for (const answer of [
  'I cannot forward your concern.', "I can't contact staff or open tickets.",
  'I am not able to forward your case.', 'I can explain the return policy.',
  'You can contact a human support agent.', 'A human support agent can review your case.',
  'I cannot forward your case, but you can contact support.',
  'I can explain why I cannot forward requests.',
]) test('v2.7 retains safe guidance: ' + answer, () => assert.equal(result(answer + next).gate, 'passed'));
test('v2.7 adds checks without turning any v2.6 failed check into a pass', () => {
  for (const answer of [...bad, 'Unused item purchased 12 days ago with receipt.', 'Unused item within 30 days of purchase with a receipt. You can proceed with an exchange.']) {
    const old = checkReturnsPolicy('eligibility', answer + next, 'v2.6', q);
    const current = result(answer + next, 'eligibility').results[0];
    assert.deepEqual(current.checks?.slice(0, old.checks.length), old.checks);
    if (!old.passed) assert.equal(current.status, 'failed');
  }
});
test('v2.7 retains explicit thirty-day rule and versioned schema', () => {
  assert.equal(result('Unused item purchased 12 days ago with a receipt.' + next, 'eligibility').gate, 'blocked');
  assert.equal(result('Unused item within 30 days of purchase with a receipt.' + next, 'eligibility').gate, 'passed');
  assert.equal(suiteSchema.safeParse({name:'New suite',description:'New version only',cases:[{id:'one',name:'One',prompt:q,rule:'returns_policy_v2_7',expected:'escalation',critical:true}],policy:{minScore:95,maxLatencyMs:null}}).success,true);
});
test('v2.6 historical capability false negative remains reproducible', () => {
  assert.equal(checkReturnsPolicy('escalation', bad[0] + next, 'v2.6', q).passed, true);
});
