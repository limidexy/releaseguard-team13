import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { providerAnswer, promptSnapshot, responseModesV8, responseModeV8 } from '../src/provider.js';
import { jobSchema } from '../src/domain.js';
const questions = [
  ['When can I return an unused item?', 'plain'],
  ['Reply as JSON with eligible, reason and nextStep.', 'json'],
  ['For our API, respond with JSON only: eligible, reason, nextStep.', 'json'],
  ['Do not use JSON. Help with my return.', 'plain'],
  ['Please explain what JSON means.', 'plain'],
  ['I have no receipt. Reply as JSON.', 'json'],
] as const;
for (const [question, mode] of questions) test('v8 format routing: ' + question, async () => {
  assert.equal(responseModeV8(question), mode);
  const raw = mode === 'plain' ? 'An actual mocked reply.' : '{"eligible":false,"reason":"Unknown","nextStep":"Ask date"}';
  const system = promptSnapshot('v8').text + '\n\n' + responseModesV8[mode];
  const answer = await providerAnswer({ url: 'https://provider.invalid/chat', key: 'mock-only', model: 'mock' }, 'v8', question, (async (_u: any, init: any) => {
    const body = JSON.parse(init.body);
    assert.equal(body.messages[0].content, system);
    assert.equal(body.messages[1].content, question);
    assert.equal(body.max_completion_tokens, 3072);
    assert.equal(body.reasoning_effort, 'low');
    return new Response(JSON.stringify({ choices: [{ message: { content: raw }, finish_reason: 'stop' }] }));
  }) as typeof fetch);
  assert.equal(answer.output, raw);
  assert.equal(answer.metadata.responseMode, mode);
  assert.equal(answer.metadata.systemPromptSha256, createHash('sha256').update(system).digest('hex'));
});
test('v6 and v7 historical snapshots remain byte-equivalent objects', () => {
  for (const [v, dir] of [['v6', 'model-v6-2026-10-15'], ['v7', 'model-v7-2026-10-16']] as const) {
    // Hash fixtures are generated from frozen plans before the v8 real run.
    const frozen = JSON.parse(readFileSync('tests/historical-v6-v7-snapshots.json', 'utf8'));
    assert.deepEqual(promptSnapshot(v), frozen[v]);
  }
});
test('v8 accepts predecessor association and unknown prompt stays invalid', () => {
  const input = { appId: '00000000-0000-4000-8000-000000000001', suiteId: '00000000-0000-4000-8000-000000000002', candidate: 'v8-test', commitRef: 'local-v8', source: 'real', previousJobId: '00000000-0000-4000-8000-000000000003' };
  assert.equal(jobSchema.parse({ ...input, promptVersion: 'v8' }).previousJobId, input.previousJobId);
  assert.equal(jobSchema.safeParse({ ...input, promptVersion: 'v18' }).success, false);
});
