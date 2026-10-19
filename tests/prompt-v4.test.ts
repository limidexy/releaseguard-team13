import test from 'node:test';
import assert from 'node:assert/strict';
import { promptTemplates, promptSnapshot } from '../src/provider.js';
import { jobSchema } from '../src/domain.js';
test('v4 is a separately selectable candidate, not a rewrite of v3', () => {
  const v4 = promptSnapshot('v4' as keyof typeof promptTemplates);
  assert.notEqual(v4.sha256, promptSnapshot('v3').sha256);
  assert.match(v4.text, /separate paragraph/i);
  assert.match(v4.text, /No website, portal/i);
  assert.match(v4.text, /no Markdown/i);
});
test('job contract accepts v4 while arbitrary prompt versions remain invalid', () => {
  const input = { appId: '00000000-0000-4000-8000-000000000001', suiteId: '00000000-0000-4000-8000-000000000002', candidate: 'support-v4', commitRef: 'local-v4', source: 'real' };
  assert.equal(jobSchema.safeParse({ ...input, promptVersion: 'v4' }).success, true);
  assert.equal(jobSchema.safeParse({ ...input, promptVersion: 'v999' }).success, false);
});
