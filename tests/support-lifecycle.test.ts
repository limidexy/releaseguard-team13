import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { SignJWT } from 'jose';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
// Only explicitly mocked provider transports may run. Scope restoration cannot
// expose a background operation to a real endpoint or an inherited DB URL.
mock.method(globalThis, 'fetch', async () => { throw new Error('Offline Support regression forbids external fetch'); });
const secret = 'synthetic-support-lifecycle-secret-not-a-real-credential';
Object.assign(process.env, { AUTH_MODE: 'dev', ALLOW_DEV_AUTH: 'true', AUTH_SECRET: secret, INTERNAL_SECRET: secret, SERVICE_ROLE: 'support', ALLOW_REAL_MODEL: 'true', MODEL_API_URL: 'https://provider.invalid/execute', MODEL_API_KEY: 'synthetic-secret-never-sent', MODEL_ID: 'synthetic-model', DATABASE_URL: 'postgresql://offline:offline@127.0.0.1:1/offline', AMQP_URL: 'amqp://offline:offline@127.0.0.1:1' });
const { support } = await import('../src/support.js');
const authorization = 'Bearer ' + await new SignJWT({ caller: 'worker' }).setProtectedHeader({ alg: 'HS256' }).setIssuer('releaseguard-services').setAudience('support').setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(secret));
const input = { source: 'real', promptVersion: 'v2', scenario: 'passing', cases: [{ id: 'receipt', name: 'Synthetic', prompt: 'Synthetic', rule: 'contains', expected: 'receipt', critical: true }] };
for (const error of [new TypeError('fetch failed https://user:private@provider.invalid?key=synthetic-secret-never-sent'), new SyntaxError('Unexpected token PRIVATE-PROVIDER-BODY'), Object.assign(new Error('timeout private body'), { name: 'TimeoutError' })]) {
  test('support suppresses private transport/parse details (' + error.name + ')', async t => {
    let calls = 0; t.mock.method(globalThis, 'fetch', async () => { calls++; throw error; });
    const app = Fastify(); await support(app);
    try {
      const result = await app.inject({ method: 'POST', url: '/execute', headers: { authorization }, payload: input });
      assert.equal(result.statusCode, 200); const body = result.json();
      assert.equal(body.outputs.length, 1); assert.equal(typeof body.outputs[0].error, 'string');
      assert.ok(!result.body.includes('private@')); assert.ok(!result.body.includes('PRIVATE-PROVIDER-BODY')); assert.ok(!result.body.includes('synthetic-secret-never-sent'));
      assert.equal(body.provenance.requestMetadata.length, 1); assert.equal(body.provenance.requestMetadata[0].attempted, true);
      assert.equal(calls, 1);
    } finally { await app.close(); }
  });
}
test('support carries a token-truncated raw answer and error into evidence, without repairing it', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ id: 'synthetic-id', choices: [{ message: { content: ' receipt ' }, finish_reason: 'length' }], usage: { completion_tokens: 1536 } }));
  const app = Fastify(); await support(app);
  try {
    const r = await app.inject({ method: 'POST', url: '/execute', headers: { authorization }, payload: input }); const body = r.json();
    assert.equal(r.statusCode, 200); assert.equal(body.outputs[0].output, ' receipt '); assert.match(body.outputs[0].error, /truncated/);
    assert.equal(body.provenance.requestMetadata[0].finishReason, 'length'); assert.equal(body.provenance.requestMetadata[0].usage.completion_tokens, 1536);
  } finally { await app.close(); }
});
test('an HTTP disconnect cancels the in-flight provider and never starts a later case', { timeout: 4000 }, async t => {
  let started!: () => void, release!: (response: Response) => void, closed!: () => void;
  const firstStarted = new Promise<void>(resolve => { started = resolve; });
  const firstResponse = new Promise<Response>(resolve => { release = resolve; });
  const disconnected = new Promise<void>(resolve => { closed = resolve; });
  let calls = 0; let providerSignal: AbortSignal | undefined;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    calls++; providerSignal = init.signal ?? undefined;
    if (calls === 1) { started(); return firstResponse; }
    return Response.json({ choices: [{ message: { content: 'receipt' }, finish_reason: 'stop' }] });
  });
  const app = Fastify();
  app.addHook('onRequest', async (_req, reply) => { reply.raw.once('close', closed); });
  await support(app); await app.listen({ host: '127.0.0.1', port: 0 });
  const client = http.request({ host: '127.0.0.1', port: (app.server.address() as AddressInfo).port, path: '/execute', method: 'POST', headers: { authorization, 'content-type': 'application/json' } });
  client.on('error', () => {});
  try {
    client.end(JSON.stringify({ ...input, cases: [...input.cases, { ...input.cases[0], id: 'later' }] }));
    await firstStarted; client.destroy(); await disconnected;
    release(Response.json({ choices: [{ message: { content: 'receipt' }, finish_reason: 'stop' }] }));
    for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1, 'no later case may be dispatched after the caller disconnected');
    assert.equal(providerSignal?.aborted, true, 'the actual in-flight fetch signal must be cancelled');
  } finally { client.destroy(); release(Response.json({})); await app.close(); }
});
test('the overall execution deadline cancels a stalled transport and labels all later cases not sent', async t => {
  const app = Fastify(); await support(app); await app.ready();
  let now = 0; t.mock.method(performance, 'now', () => now); t.mock.timers.enable({ apis: ['setTimeout'] });
  let started!: () => void; const dispatched = new Promise<void>(resolve => { started = resolve; });
  let calls = 0; let signal: AbortSignal | null | undefined;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    calls++; signal = init.signal; started();
    return new Promise<Response>((_resolve, reject) => signal!.addEventListener('abort', () => reject(signal!.reason), { once: true }));
  });
  const cases = Array.from({ length: 10 }, (_, i) => ({ ...input.cases[0], id: 'synthetic-' + i }));
  const running = app.inject({ method: 'POST', url: '/execute', headers: { authorization }, payload: { ...input, cases } });
  try {
    await dispatched; now = 399999; t.mock.timers.tick(399999); assert.equal(signal!.aborted, false);
    now = 400000; t.mock.timers.tick(1);
    const r = await running; const result = r.json();
    assert.equal(r.statusCode, 200); assert.equal(signal!.aborted, true); assert.equal(calls, 1);
    assert.equal(result.outputs.length, 10); assert.equal(result.provenance.stopped, true);
    assert.equal(result.provenance.executionBudgetMs, 400000);
    assert.equal(result.provenance.requestMetadata[0].attempted, true);
    assert.ok(result.provenance.requestMetadata.slice(1).every((m: any) => m.attempted === false));
    assert.ok(result.outputs.every((o: any) => typeof o.error === 'string' && o.output === undefined));
  } finally { await running; await app.close(); }
});
test('a provider quota rejection is never retried and no later case is dispatched', async t => {
  let calls = 0; t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ error: 'PRIVATE-ERROR-BODY' }, { status: 429 }); });
  const app = Fastify(); await support(app);
  try {
    const r = await app.inject({ method: 'POST', url: '/execute', headers: { authorization }, payload: { ...input, cases: [...input.cases, { ...input.cases[0], id: 'later' }] } });
    const result = r.json(); assert.equal(calls, 1); assert.equal(result.outputs[0].error, 'Provider HTTP 429');
    assert.equal(result.provenance.requestMetadata[1].attempted, false); assert.match(result.outputs[1].error, /not sent/);
    assert.equal(result.provenance.stopped, true); assert.ok(!r.body.includes('PRIVATE-ERROR-BODY'));
  } finally { await app.close(); }
});
test('disabled real execution fails without a provider request or synthetic fallback', async t => {
  const saved = process.env.ALLOW_REAL_MODEL; process.env.ALLOW_REAL_MODEL = 'false'; t.after(() => { process.env.ALLOW_REAL_MODEL = saved; });
  t.mock.method(globalThis, 'fetch', async () => { assert.fail('disabled real execution must not dispatch'); });
  const app = Fastify(); await support(app);
  try { const r = await app.inject({ method: 'POST', url: '/execute', headers: { authorization }, payload: input }); assert.equal(r.statusCode, 503); assert.ok(!r.body.includes('outputs')); }
  finally { await app.close(); }
});
test('an unauthenticated caller cannot reach provider execution', async t => {
  t.mock.method(globalThis, 'fetch', async () => { assert.fail('unauthenticated dispatch'); });
  const app = Fastify(); await support(app);
  try { assert.equal((await app.inject({ method: 'POST', url: '/execute', payload: input })).statusCode, 401); }
  finally { await app.close(); }
});
test('the existing ten-case real budget rejects an eleventh case before dispatch', async t => {
  t.mock.method(globalThis, 'fetch', async () => { assert.fail('eleventh-case budget must reject before any provider call'); });
  const app = Fastify(); await support(app);
  try { assert.equal((await app.inject({ method: 'POST', url: '/execute', headers: { authorization }, payload: { ...input, cases: Array.from({ length: 11 }, (_, i) => ({ ...input.cases[0], id: 'case-' + i })) } })).statusCode, 400); }
  finally { await app.close(); }
});
test('URL credentials cannot reach fetch or the public error response', async t => {
  const saved = process.env.MODEL_API_URL; process.env.MODEL_API_URL = 'https://private:password@provider.invalid/execute'; t.after(() => { process.env.MODEL_API_URL = saved; });
  t.mock.method(globalThis, 'fetch', async () => { assert.fail('URL credential dispatch'); });
  const app = Fastify(); await support(app);
  try { const r = await app.inject({ method: 'POST', url: '/execute', headers: { authorization }, payload: input }); assert.equal(r.statusCode, 503); assert.ok(!r.body.includes('private:password')); }
  finally { await app.close(); }
});
