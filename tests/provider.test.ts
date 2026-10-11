import test from 'node:test';
import assert from 'node:assert/strict';
import { boundedJson, providerAnswer, promptSnapshot } from '../src/provider.js';
const config = { url: 'https://provider.invalid/v1/chat/completions', key: 'test-only-not-a-secret', model: 'test-model' };
const fake = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
test('provider contract retains unedited output and bounded usage metadata', async () => {
  let submitted: any;
  const fetcher = (async (_url: any, init: any) => { submitted = JSON.parse(init.body); return new Response(JSON.stringify({ id: 'req-1', model: 'pinned-model', choices: [{ message: { content: ' Raw answer. ' } }], usage: { total_tokens: 17, completion_tokens: -1 } })); }) as typeof fetch;
  const result = await providerAnswer(config, 'v2', 'Can I return this?', fetcher);
  assert.equal(result.output, ' Raw answer. '); assert.equal(result.metadata.requestId, 'req-1');
  assert.deepEqual(result.metadata.usage, { total_tokens: 17 });
  assert.equal(submitted.messages[1].content, 'Can I return this?'); assert.equal(submitted.max_tokens, 300);
  assert.match(submitted.messages[0].content, /Never claim to issue refunds/);
});
test('provider HTTP failures are not converted to fabricated answers', async () => {
  await assert.rejects(providerAnswer(config, 'v1', 'q', fake({ error: 'private details' }, 429)), /^Error: Provider HTTP 429$/);
});
test('token-truncated answers retain the raw text and signal an error to the evaluation gate', async () => {
  const result = await providerAnswer(config, 'v2', 'q', fake({
    id: 'truncated-request', model: 'test-model',
    choices: [{ message: { content: 'Eligible within 30 days, but' }, finish_reason: 'length' }],
    usage: { completion_tokens: 300 },
  }));
  assert.equal(result.output, 'Eligible within 30 days, but');
  assert.equal((result.metadata as any).finishReason, 'length');
  assert.match((result as any).error, /truncated/);
});
test('missing, empty and oversized provider answers fail closed', async () => {
  for (const body of [{}, { choices: [] }, { choices: [{ message: { content: '  ' } }] }, { choices: [{ message: { content: 'x'.repeat(10001) } }] }])
    await assert.rejects(providerAnswer(config, 'v1', 'q', fake(body)), /contract invalid/);
});
test('stream byte limit works without a Content-Length header', async () => {
  await assert.rejects(boundedJson(new Response('x'.repeat(101)), 100), /size limit/);
});
test('plaintext or credential-bearing URL rejected before network', async () => {
  const neverFetch = (async () => { assert.fail('must reject before network'); }) as typeof fetch;
  for (const url of ['http://provider.invalid', 'https://user:password@provider.invalid'])
    await assert.rejects(providerAnswer({ ...config, url }, 'v1', 'q', neverFetch), /requires HTTPS/);
});
test('prompt snapshot distinguishes versions and preserves exact prompt', () => {
  const a = promptSnapshot('v1'), b = promptSnapshot('v2');
  assert.notEqual(a.sha256, b.sha256); assert.match(b.sha256, /^[a-f0-9]{64}$/);
  assert.match(b.text, /Never request passwords/);
});
