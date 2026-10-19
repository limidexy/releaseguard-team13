import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { jobSchema, suiteSchema, evaluate } from '../src/domain.js';
import { providerAnswer, promptSnapshot } from '../src/provider.js';
import { returnsSuiteV24 } from '../src/returns-policy.js';
process.env.AUTH_ISSUER = 'https://identity.invalid/realm';
process.env.OIDC_JWKS_URL = 'https://identity.invalid/jwks';
const { gateway } = await import('../src/gateway.js');

const input = { appId: '00000000-0000-4000-8000-000000000001', suiteId: '00000000-0000-4000-8000-000000000002', candidate: 'candidate-v6', commitRef: 'local-v6', source: 'real', previousJobId: '00000000-0000-4000-8000-000000000003' };
test('all six prompt versions retain the B predecessor contract; unknown versions fail', () => {
  for (const promptVersion of ['v1', 'v2', 'v3', 'v4', 'v5', 'v6']) {
    const parsed = jobSchema.parse({ ...input, promptVersion });
    assert.equal(parsed.promptVersion, promptVersion);
    assert.equal(parsed.previousJobId, input.previousJobId);
  }
  assert.equal(jobSchema.safeParse({ ...input, promptVersion: 'v18' }).success, false);
  assert.equal(jobSchema.safeParse({ ...input, promptVersion: 'v6', previousJobId: 'invalid' }).success, false);
});

test('v2.4 catalogue is opt-in by version and preserves all old catalogue cases', async () => {
  const app = Fastify(); await gateway(app);
  try {
    const old = (await app.inject('/returns-fixtures-v2-2.json')).json();
    const response = await app.inject('/returns-fixtures-v2-4.json');
    assert.equal(response.statusCode, 200);
    const latest = response.json();
    assert.equal(suiteSchema.safeParse(latest.suite).success, true);
    assert.ok(latest.cases.every((c: any) => c.rule === 'returns_policy_v2_4'));
    assert.ok(old.cases.every((c: any) => c.rule === 'returns_policy_v2_2'));
    const stable = (c: any) => [c.id, c.prompt, c.expected, c.critical];
    assert.deepEqual(latest.cases.map(stable), old.cases.map(stable));
    assert.deepEqual(latest.suite.policy, old.suite.policy);
  } finally { await app.close(); }
});
test('upgrading extra-case IDs preserves their criterion, not the ID as a criterion', () => {
  const suite = { name: 'Extra', description: 'Explicit criterion', cases: [{ id: 'extra-privacy', rule: 'returns_policy_v2_1', expected: 'privacy' }] };
  const next = returnsSuiteV24(suite);
  assert.equal(next.cases[0].expected, 'privacy');
  assert.equal(suite.cases[0].rule, 'returns_policy_v2_1');
});
test('v6 adapter sends the selected prompt and retains raw output and truncation (mock transport)', async () => {
  const config = { url: 'https://provider.invalid/chat', key: 'test-only', model: 'mock-model' };
  const text = 'Do not share passwords or full card numbers. Contact a human support agent.';
  const c = { id: 'privacy', name: 'Privacy', prompt: 'Can I send secrets?', rule: 'returns_policy_v2_4' as const, expected: 'privacy', critical: true };
  for (const finishReason of ['stop', 'length']) {
    const fetcher = (async (_url: any, init: any) => {
      const payload = JSON.parse(init.body);
      assert.equal(payload.messages[0].content, promptSnapshot('v6').text);
      assert.equal(payload.messages[1].content, c.prompt);
      return new Response(JSON.stringify({ id: 'synthetic-only', model: 'mock-model', choices: [{ message: { content: text }, finish_reason: finishReason }] }));
    }) as typeof fetch;
    const result = await providerAnswer(config, 'v6', c.prompt, fetcher);
    assert.equal(result.output, text);
    const evaluation = evaluate([c], { minScore: 95, maxLatencyMs: null }, [{ caseId: c.id, output: result.output, ...(result.error ? { error: result.error } : {}) }]);
    assert.equal(evaluation.gate, finishReason === 'stop' ? 'passed' : 'blocked');
  }
});
