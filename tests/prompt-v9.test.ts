import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { providerAnswer, promptSnapshot } from '../src/provider.js';
import { jobSchema } from '../src/domain.js';
import { checkReturnsPolicy } from '../src/returns-policy.js';
const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
test('frozen v2.6 scoring files and v8 request settings stay unchanged', () => {
  const frozen = JSON.parse(readFileSync('tests/frozen-v26-v8.json', 'utf8'));
  for (const [p, hash] of Object.entries(frozen.scorers)) assert.equal(sha(readFileSync(p)), hash);
  assert.deepEqual(promptSnapshot('v8'), frozen.v8);
});
test('v9 is accepted as a new candidate, preserving predecessor and rejecting unknown versions', () => {
  const b = { appId:'00000000-0000-4000-8000-000000000001',suiteId:'00000000-0000-4000-8000-000000000002',candidate:'candidate-v9',commitRef:'local-v9',source:'real',previousJobId:'00000000-0000-4000-8000-000000000003' };
  assert.equal(jobSchema.safeParse({...b,promptVersion:'v9'}).success, true);
  assert.equal(jobSchema.safeParse({...b,promptVersion:'v18'}).success, false);
});
test('v9 adapter preserves provider output and v8 budget, including fail-closed truncation', async () => {
  for (const finish of ['stop','length']) {
    const raw = 'Original provider output, not substituted by the application.';
    const answer = await providerAnswer({ url:'https://provider.invalid/chat',key:'mock-only',model:'mock' }, 'v9' as any, 'Can you help with a return?', (async (_u: any, init: any) => {
      const b = JSON.parse(init.body);
      assert.equal(b.max_completion_tokens, 3072);
      assert.equal(b.temperature, 0.2);
      assert.equal(b.reasoning_effort, 'low');
      assert.equal(b.messages[1].content, 'Can you help with a return?');
      assert.ok(b.messages[0].content.startsWith(promptSnapshot('v9' as any).text));
      return new Response(JSON.stringify({id:'mock-only',model:'mock',choices:[{message:{content:raw},finish_reason:finish}]}));
    }) as typeof fetch);
    assert.equal(answer.output, raw);
    assert.equal(answer.metadata.responseMode, 'plain');
    assert.equal(Boolean(answer.error), finish === 'length');
  }
});
test('unchanged v2.6 rejects all three historical failure patterns', () => {
  const rows = [
    ['eligibility','Unused item purchased within 30 days with a receipt. You can proceed with a refund or exchange.','I bought an unused item 12 days ago and have a receipt.'],
    ['damaged','Because the return is after 45 days, it falls outside the standard window. Contact a human support agent.','It arrived cracked, but I noticed after 45 days.'],
    ['escalation','Because the decision was made based on those criteria, I cannot change it. Contact a human support agent.','This decision is unfair.'],
  ];
  for (const [criterion,answer,question] of rows) assert.equal(checkReturnsPolicy(criterion,answer,'v2.6',question).passed,false);
});
