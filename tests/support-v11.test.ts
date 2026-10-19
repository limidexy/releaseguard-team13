import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { SignJWT } from 'jose';
import { promptSnapshot } from '../src/provider.js';

process.env.SERVICE_ROLE = 'support';
process.env.AUTH_MODE = 'dev';
process.env.ALLOW_DEV_AUTH = 'true';
process.env.AUTH_SECRET = 'unit-test-only-auth-key-not-for-deployment';
process.env.INTERNAL_SECRET = 'unit-test-only-internal-key-not-for-deployment';
const { support } = await import('../src/support.js');
const input = { source: 'replay', promptVersion: 'v11', scenario: 'passing', cases: [{ id: 'privacy', name: 'Privacy', prompt: 'Can I share secrets?', rule: 'returns_policy_v2_8', expected: 'privacy', critical: true }] };
const bearer = await new SignJWT({ caller: 'worker' }).setProtectedHeader({ alg: 'HS256' }).setIssuer('releaseguard-services').setAudience('support').setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(process.env.INTERNAL_SECRET));
const headers = { authorization: 'Bearer ' + bearer };

test('support endpoint accepts v11 but replay remains explicitly synthetic', async () => {
  const app = Fastify(); await support(app);
  try {
    const response = await app.inject({ method: 'POST', url: '/execute', headers, payload: input });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().provenance.source, 'replay');
    assert.equal(response.json().provenance.promptVersion, 'v11');
    assert.equal(response.json().provenance.trust, 'labelled_static_fixture');
  } finally { await app.close(); }
});
test('v11 cannot bypass service authentication or disabled real-provider guard', async () => {
  const app = Fastify(); await support(app);
  try {
    assert.equal((await app.inject({ method: 'POST', url: '/execute', payload: input })).statusCode, 401);
    process.env.ALLOW_REAL_MODEL = 'false';
    assert.equal((await app.inject({ method: 'POST', url: '/execute', headers, payload: { ...input, source: 'real' } })).statusCode, 503);
  } finally { await app.close(); }
});
test('v11 flows through service to provider with exact output and versioned provenance (mock transport)', async () => {
  const app = Fastify(); await support(app);
  const previousFetch = globalThis.fetch;
  try {
    process.env.ALLOW_REAL_MODEL = 'true'; process.env.MODEL_API_KEY = 'unit-test-only';
    process.env.MODEL_API_URL = 'https://provider.invalid/chat'; process.env.MODEL_ID = 'unit-test-model';
    const raw = 'Do not share passwords or full card numbers. Contact a human support agent.';
    globalThis.fetch = (async (_url: any, init: any) => {
      const request = JSON.parse(init.body);
      assert.equal(request.temperature, 0.2);
      assert.equal(request.reasoning_effort, 'low');
      assert.equal(request.max_completion_tokens, 3072);
      assert.ok(request.messages[0].content.startsWith(promptSnapshot('v11').text));
      return new Response(JSON.stringify({ id: 'mock-only', model: 'unit-test-model', choices: [{ message: { content: raw }, finish_reason: 'stop' }] }));
    }) as typeof fetch;
    const response = await app.inject({ method: 'POST', url: '/execute', headers, payload: { ...input, source: 'real' } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().outputs[0].output, raw);
    assert.equal(response.json().provenance.promptSnapshot.sha256, promptSnapshot('v11').sha256);
    assert.equal(response.json().provenance.requestMetadata[0].requestId, 'mock-only');
  } finally { globalThis.fetch = previousFetch; await app.close(); }
});
