import test from 'node:test';
import assert from 'node:assert/strict';
import { promptSnapshot, promptTemplates } from '../src/provider.js';
import { jobSchema } from '../src/domain.js';
test('v5 versions a concise policy with standard safety copy without rewriting earlier candidates', () => {
  const snapshot = promptSnapshot('v5' as keyof typeof promptTemplates);
  assert.match(snapshot.text, /Do not share passwords or full card numbers\./);
  assert.match(snapshot.text, /JSON/);
  assert.notEqual(snapshot.sha256, promptSnapshot('v4').sha256);
  assert.equal(jobSchema.safeParse({ appId: '00000000-0000-4000-8000-000000000001', suiteId: '00000000-0000-4000-8000-000000000002', candidate: 'support-v5', commitRef: 'local-v5', source: 'real', promptVersion: 'v5' }).success, true);
});
