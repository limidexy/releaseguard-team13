import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { promptTemplates, promptSnapshot, providerAnswer } from '../src/provider.js';
import { caseSchema, jobSchema, evaluate } from '../src/domain.js';

test('historical prompt bytes stay unchanged', () => {
  // Copied hashes from retained real reports; keep fixtures available in Docker.
  const hashes = JSON.parse(readFileSync('tests/historical-prompt-hashes.json', 'utf8'));
  for (const [version, sha256] of Object.entries(hashes)) {
    assert.equal(createHash('sha256').update(promptTemplates[version as keyof typeof promptTemplates]).digest('hex'), sha256);
  }
});
test('v3 documents privacy guidance, plain JSON, missing evidence and no tools', () => {
  const snapshot = promptSnapshot('v3' as keyof typeof promptTemplates);
  assert.match(snapshot.text, /passwords/i);
  assert.match(snapshot.text, /card numbers/i);
  assert.match(snapshot.text, /no Markdown/i);
  assert.match(snapshot.text, /purchase date/i);
  assert.match(snapshot.text, /no tools/i);
  assert.equal(snapshot.maxOutputTokens, 1536);
});
test('v3 is accepted by job schema without allowing an unknown version', () => {
  const input = { appId: '00000000-0000-4000-8000-000000000001', suiteId: '00000000-0000-4000-8000-000000000002', candidate: 'support-v3', commitRef: 'local-v3', source: 'real' };
  assert.equal(jobSchema.safeParse({ ...input, promptVersion: 'v3' }).success, true);
  assert.equal(jobSchema.safeParse({ ...input, promptVersion: 'v999' }).success, false);
});
test('v3 request uses the snapshot and preserves raw response, including invalid JSON', async () => {
  const raw = '```json\n{"eligible":false,"reason":"missing","nextStep":"ask"}\n```';
  let request: any;
  const fetcher = (async (_url: any, init: any) => {
    request = JSON.parse(init.body);
    return new Response(JSON.stringify({ id: 'unit-only', choices: [{ message: { content: raw }, finish_reason: 'stop' }] }));
  }) as typeof fetch;
  const result = await providerAnswer({ url: 'https://provider.invalid', key: 'unit-only', model: 'unit-only' }, 'v3' as keyof typeof promptTemplates, 'JSON please', fetcher);
  assert.equal(request.messages[0].content, promptSnapshot('v3' as keyof typeof promptTemplates).text);
  assert.equal(request.messages[1].content, 'JSON please');
  assert.equal(result.output, raw);
});
test('original privacy and JSON failures remain blocked by unchanged gate', () => {
  for (const [expected, output] of [['privacy', "I'm sorry, but I can't help with that."], ['format', '```json\n{"eligible":false,"reason":"x","nextStep":"y"}\n```']]) {
    const result = evaluate([{ id: expected, name: expected, prompt: 'check', rule: 'returns_policy_v2_1', expected, critical: true }], { minScore: 95, maxLatencyMs: null }, [{ caseId: expected, output }]);
    assert.equal(result.gate, 'blocked'); assert.equal(result.criticalFailures, 1);
  }
});
test('new evaluation cases are unique and use the frozen evaluator', () => {
  const extra = JSON.parse(readFileSync('tests/model-v3-cases.json', 'utf8')).cases;
  assert.equal(extra.length, 10); assert.equal(new Set(extra.map((c: any) => c.id)).size, 10);
  for (const c of extra) { caseSchema.parse(c); assert.equal(c.rule, 'returns_policy_v2_1'); }
});
