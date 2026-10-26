import test from 'node:test';
import assert from 'node:assert/strict';
import { providerAnswer, boundedJson } from '../src/provider.js';
import { evaluate } from '../src/domain.js';
const config = { url: 'https://provider.invalid/v1/chat/completions', key: 'synthetic-key-never-sent', model: 'synthetic-model' };
function response(content: unknown, reason: unknown = 'stop') {
  return { id: 'synthetic-request', model: 'synthetic-model', choices: [{ message: { content, reasoning: 'PRIVATE REASONING NOT EVIDENCE' }, finish_reason: reason }], usage: { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12, secret: 'not retained' } };
}
function fake(body: unknown) { let count = 0; return { fetch: (async () => { count++; return Response.json(body); }) as typeof fetch, count: () => count }; }
for (const reason of ['length', 'content_filter', 'tool_calls']) {
  test('a nonempty ' + reason + ' answer remains raw but cannot pass the gate', async () => {
    const raw = '\n receipt  \n', transport = fake(response(raw, reason));
    const result: any = await providerAnswer(config, 'v1', 'Synthetic question', transport.fetch);
    assert.equal(result.output, raw); assert.equal(result.metadata.finishReason, reason);
    assert.equal(typeof result.error, 'string'); assert.ok(result.error.length > 0);
    assert.deepEqual(result.metadata.usage, { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12 });
    const gate = evaluate([{ id: 'receipt', name: 'Synthetic', prompt: 'Synthetic', rule: 'contains', expected: 'receipt', critical: true }], { minScore: 95, maxLatencyMs: null }, [{ caseId: 'receipt', ...result, metadata: undefined }].map(({ metadata, ...o }) => o));
    assert.equal(gate.gate, 'blocked'); assert.equal(gate.errors, 1); assert.equal(gate.results[0].output, raw);
    assert.equal(transport.count(), 1); assert.ok(!JSON.stringify(result).includes('PRIVATE REASONING'));
  });
}
for (const content of [null, '', '  ', 'x'.repeat(10001)]) {
  test('invalid answer evidence retains bounded protocol metadata (' + (typeof content === 'string' ? content.length : 'null') + ')', async () => {
    const transport = fake(response(content));
    const result: any = await providerAnswer(config, 'v2', 'Synthetic question', transport.fetch);
    assert.match(result.error, /contract invalid/); assert.equal(result.metadata.requestId, 'synthetic-request');
    assert.equal(result.metadata.finishReason, 'stop'); assert.equal(result.metadata.contentCharacters, typeof content === 'string' ? content.length : null);
    assert.equal(result.output, typeof content === 'string' && content.length <= 10000 ? content : undefined);
    assert.equal(transport.count(), 1);
  });
}
test('the source completion-token budget is explicit and never silently retried with a different parameter', async () => {
  let requests = 0;
  const transport = (async (_url: unknown, init: RequestInit) => {
    requests++; const body = JSON.parse(String(init.body));
    assert.equal(body.max_completion_tokens, 1536); assert.equal(body.max_tokens, undefined);
    assert.equal(body.model, 'synthetic-model'); assert.deepEqual(body.messages.map((m: any) => m.role), ['system', 'user']);
    assert.equal(body.messages[1].content, 'Synthetic question'); assert.equal(init.redirect, 'error');
    return Response.json(response(' Raw complete answer. '));
  }) as typeof fetch;
  const result: any = await providerAnswer(config, 'v2', 'Synthetic question', transport);
  assert.equal(result.output, ' Raw complete answer. '); assert.equal(result.error, undefined); assert.equal(requests, 1);
});
test('an already cancelled execution cannot send a request', async () => {
  const controller = new AbortController(); controller.abort();
  const never = (async () => { assert.fail('cancelled before send'); }) as typeof fetch;
  await assert.rejects(providerAnswer(config, 'v1', 'Synthetic', never, controller.signal), { name: 'AbortError' });
});
test('cancellation interrupts a streaming response and releases the reader instead of parsing partial JSON', async () => {
  const controller = new AbortController(); let cancelled = false;
  const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"choices":')); }, cancel() { cancelled = true; } });
  const reading = boundedJson(new Response(stream), 100000, controller.signal);
  controller.abort(); await assert.rejects(reading, { name: 'AbortError' }); assert.equal(cancelled, true); assert.equal(stream.locked, false);
});
test('late headers cannot evade the monotonic request budget before the timeout event runs', async t => {
  let now = 0; t.mock.method(performance, 'now', () => now); let cancelled = false;
  const transport = (async () => { now = 20001; return new Response(new ReadableStream({ cancel() { cancelled = true; } })); }) as typeof fetch;
  await assert.rejects(providerAnswer(config, 'v1', 'Synthetic', transport), { name: 'TimeoutError' }); assert.equal(cancelled, true);
});
test('a late completed body remains raw but is explicitly timed-out evidence', async t => {
  let now = 0; t.mock.method(performance, 'now', () => now);
  const transport = (async () => new Response(new ReadableStream({ pull(controller) { now = 20001; controller.enqueue(new TextEncoder().encode(JSON.stringify(response(' raw receipt ')))); controller.close(); } }, { highWaterMark: 0 }))) as typeof fetch;
  const result = await providerAnswer(config, 'v1', 'Synthetic', transport);
  assert.equal(result.output, ' raw receipt '); assert.match(result.error ?? '', /timed out/);
});
