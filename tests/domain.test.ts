import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, suiteSchema, jobSchema, releaseRequestSchema, reviewAllowed } from '../src/domain.js';
const c = { id: 'one', name: 'One case', prompt: 'Question', rule: 'contains' as const, expected: 'receipt', critical: true };
const policy = { minScore: 95, maxLatencyMs: 3000 };
test('missing required output or latency blocks a release', () => { assert.equal(evaluate([c], policy, []).gate, 'blocked'); assert.equal(evaluate([c], policy, [{ caseId: 'one', output: 'receipt' }]).gate, 'blocked'); });
test('critical failures override aggregate score', () => assert.equal(evaluate([c], { ...policy, minScore: 0 }, [{ caseId: 'one', output: 'no', latencyMs: 2 }]).gate, 'blocked'));
test('provider errors cannot pass even when noncritical', () => assert.equal(evaluate([{ ...c, critical: false }], { ...policy, minScore: 0 }, [{ caseId: 'one', error: 'Provider HTTP 429' }]).gate, 'blocked'));
test('latency threshold inclusive and case-insensitive substring', () => { assert.equal(evaluate([c], policy, [{ caseId: 'one', output: 'RECEIPT', latencyMs: 3000 }]).gate, 'passed'); assert.equal(evaluate([c], policy, [{ caseId: 'one', output: 'receipt', latencyMs: 3001 }]).gate, 'blocked'); });
test('duplicate and unknown output IDs rejected', () => { const o = { caseId: 'one', output: 'receipt', latencyMs: 1 }; assert.throws(() => evaluate([c], policy, [o, o])); assert.throws(() => evaluate([c], policy, [{ ...o, caseId: 'other' }])); });
test('JSON checks own keys and rejects arrays and null', () => { const json = { ...c, rule: 'json_keys' as const, expected: 'reason' }; for (const v of ['null', '[]', '{}', '{"other":1}']) assert.equal(evaluate([json], policy, [{ caseId: 'one', output: v, latencyMs: 1 }]).gate, 'blocked'); assert.equal(evaluate([json], policy, [{ caseId: 'one', output: '{"reason":"x"}', latencyMs: 1 }]).gate, 'passed'); });
test('suite rejects duplicate cases and empty expected JSON keys', () => { assert.equal(suiteSchema.safeParse({ name: 'suite', description: 'A suite', cases: [c, c], policy }).success, false); assert.equal(suiteSchema.safeParse({ name: 'suite', description: 'A suite', cases: [{ ...c, rule: 'json_keys', expected: 'x,' }], policy }).success, false); });
test('callers cannot set scores or unknown fields', () => assert.equal(jobSchema.safeParse({ appId: '00000000-0000-4000-8000-000000000001', suiteId: '00000000-0000-4000-8000-000000000002', candidate: 'v1', commitRef: 'abcdef0', source: 'imported', outputs: [], score: 100 }).success, false));
test('independent review rejects creator, requester and terminal state', () => { const base = { actor: 'reviewer', creator: 'developer', requester: 'owner', status: 'pending', gate: 'passed' }; assert.equal(reviewAllowed(base), true); for (const item of [{ actor: 'developer' }, { actor: 'owner' }, { status: 'approved' }, { gate: 'blocked' }]) assert.equal(reviewAllowed({ ...base, ...item }), false); });
test('empty and whitespace answers cannot pass a negative safety rule', () => {
  for (const output of ['', '   ', '\n\t']) {
    const result = evaluate([{ ...c, rule: 'not_contains', expected: 'password' }], policy, [{ caseId: 'one', output, latencyMs: 1 }]);
    assert.equal(result.gate, 'blocked');
    assert.equal(result.errors, 1);
  }
});

test('job lineage is optional for existing clients and validates UUID references', () => {
  const input = { appId: '00000000-0000-4000-8000-000000000001', suiteId: '00000000-0000-4000-8000-000000000002', candidate: 'new-candidate', commitRef: 'abcdef0', source: 'replay' };
  assert.equal(jobSchema.safeParse(input).success, true);
  assert.equal(jobSchema.safeParse({ ...input, previousJobId: input.appId }).success, true);
  for (const previousJobId of ['', 'not-a-uuid', null]) assert.equal(jobSchema.safeParse({ ...input, previousJobId }).success, false);
});

test('review request lineage accepts a UUID but cannot inject terminal state', () => {
  const input = { jobId: '00000000-0000-4000-8000-000000000001', note: 'New independent review' };
  assert.equal(releaseRequestSchema.safeParse(input).success, true);
  assert.equal(releaseRequestSchema.safeParse({ ...input, previousReleaseId: input.jobId }).success, true);
  assert.equal(releaseRequestSchema.safeParse({ ...input, previousReleaseId: 'invalid' }).success, false);
  assert.equal(releaseRequestSchema.safeParse({ ...input, status: 'approved' }).success, false);
});
