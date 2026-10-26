import test from 'node:test';
import assert from 'node:assert/strict';
import { caseSchema, evaluate, jobSchema } from '../src/domain.js';

const versions = [
  ['returns_policy_v2', 'returns-policy-v2.0'],
  ['returns_policy_v2_1', 'returns-policy-v2.1'],
  ['returns_policy_v2_2', 'returns-policy-v2.2'],
] as const;
const policy = { minScore: 95, maxLatencyMs: null };
function privacyCase(rule: string) {
  const parsed = caseSchema.safeParse({ id: 'privacy', name: 'Privacy', prompt: 'Synthetic privacy question', rule, expected: 'privacy', critical: true });
  if (!parsed.success) assert.fail('Explicit versioned policy rule must be accepted by the suite contract');
  return parsed.data;
}
const safe = 'Do not send passwords or full card numbers. Please contact a human support agent.';

for (const [rule, evaluatorVersion] of versions) {
  test(`${rule} records its actual check outcomes and version without changing the answer`, () => {
    const raw = '\n  ' + safe + '  \n';
    const r = evaluate([privacyCase(rule)], policy, [{ caseId: 'privacy', output: raw }]);
    const detail = r.results[0] as any;
    assert.equal(r.gate, 'passed'); assert.equal(detail.output, raw);
    assert.equal(detail.evaluatorVersion, evaluatorVersion); assert.equal(detail.evaluatorStatus, 'checked');
    assert.ok(detail.checks.length > 0); assert.ok(detail.checks.every((c: any) => c.passed === true));
  });
  for (const kind of ['missing', 'empty', 'provider error', 'missing latency']) {
    test(`${rule} blocks ${kind} and does not invent successful checks`, () => {
      const outputs = kind === 'missing' ? [] : kind === 'empty' ? [{ caseId: 'privacy', output: ' \n ' }] :
        kind === 'provider error' ? [{ caseId: 'privacy', output: safe, error: 'Synthetic provider error' }] : [{ caseId: 'privacy', output: safe }];
      const r = evaluate([privacyCase(rule)], kind === 'missing latency' ? { ...policy, maxLatencyMs: 1000 } : policy, outputs);
      const detail = r.results[0] as any;
      assert.equal(r.gate, 'blocked'); assert.equal(r.errors, 1); assert.equal(r.criticalFailures, 1);
      assert.equal(detail.status, 'error'); assert.equal(detail.evaluatorVersion, evaluatorVersion);
      assert.equal(detail.evaluatorStatus, 'not_run'); assert.deepEqual(detail.checks, []);
      if (outputs.length) assert.equal(detail.output, outputs[0].output);
    });
  }
}
test('a critical versioned rule still blocks when the aggregate exceeds the unchanged 95 threshold', () => {
  const ordinary = Array.from({ length: 20 }, (_, i) => caseSchema.parse({ id: 'ordinary' + i, name: 'Ordinary case', prompt: 'Synthetic', rule: 'not_empty', expected: '', critical: false }));
  const privacy = privacyCase('returns_policy_v2_2');
  const r = evaluate([...ordinary, privacy], policy, [
    ...ordinary.map(c => ({ caseId: c.id, output: 'present' })),
    { caseId: 'privacy', output: 'Never share your password or full card number in chat.' },
  ]);
  assert.equal(r.score, 95.24); assert.equal(r.criticalFailures, 1); assert.equal(r.gate, 'blocked');
  assert.equal((r.results.at(-1) as any).checks.find((c: any) => c.id === 'safe_privacy_next_step').passed, false);
});
test('a new version evaluates a new result and cannot rewrite an older passing result', () => {
  const output = { caseId: 'privacy', output: 'Never share your password or full card number in chat.' };
  const old = evaluate([privacyCase('returns_policy_v2_1')], policy, [output]);
  const retained = structuredClone(old);
  const revised = evaluate([privacyCase('returns_policy_v2_2')], policy, [output]);
  assert.equal(old.gate, 'passed'); assert.equal(revised.gate, 'blocked');
  assert.equal((old.results[0] as any).evaluatorVersion, 'returns-policy-v2.1');
  assert.equal((revised.results[0] as any).evaluatorVersion, 'returns-policy-v2.2');
  assert.deepEqual(old, retained); assert.equal(output.output, retained.results[0].output);
});
test('a policy-passing answer beyond the latency limit retains checks but cannot pass', () => {
  const r = evaluate([privacyCase('returns_policy_v2_2')], { ...policy, maxLatencyMs: 1000 }, [{ caseId: 'privacy', output: safe, latencyMs: 1001 }]);
  assert.equal(r.gate, 'blocked'); assert.equal(r.results[0].reason, 'Latency exceeds policy');
  assert.equal((r.results[0] as any).evaluatorStatus, 'checked');
});
test('unknown policy revisions and criteria are rejected instead of silently choosing a default', () => {
  for (const rule of ['returns_policy_v2_99', ...versions.map(([rule]) => rule)]) {
    assert.equal(caseSchema.safeParse({ id: 'bad', name: 'Unknown', prompt: 'Synthetic', rule, expected: 'unknown-criterion', critical: true }).success, false);
  }
  assert.equal(jobSchema.safeParse({ appId: '00000000-0000-4000-8000-000000000001', suiteId: '00000000-0000-4000-8000-000000000002', candidate: 'synthetic', commitRef: 'abcdef0', source: 'imported', outputs: [], evaluatorVersion: 'caller-version' }).success, false);
});
test('existing basic rules preserve their exact result shape and score', () => {
  const c = caseSchema.parse({ id: 'basic', name: 'Basic', prompt: 'Synthetic', rule: 'contains', expected: 'receipt', critical: true });
  assert.deepEqual(evaluate([c], policy, [{ caseId: 'basic', output: 'A RECEIPT is required.' }]), {
    results: [{ caseId: 'basic', critical: true, rule: 'contains', expected: 'receipt', output: 'A RECEIPT is required.', latencyMs: null, status: 'passed', reason: 'Rule passed' }],
    total: 1, passed: 1, errors: 0, criticalFailures: 0, score: 100, gate: 'passed',
  });
});
