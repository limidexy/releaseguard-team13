import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Regression for PR #4 review: the console must keep readable validation details
// and must not show raw "HTTP 409 {...}" / "HTTP 503 {...}" / JSON parse errors.
const source = readFileSync('public/app.js', 'utf8');
const block = source.match(/\/\/ <api-error>[^\n]*\n([\s\S]*?)\n\/\/ <\/api-error>/);
assert.ok(block, 'api-error helper block markers are present in public/app.js');
const sandbox: Record<string, any> = {};
vm.runInNewContext(block[1] + '\nthis.apiErrorMessage = apiErrorMessage;', sandbox);
const apiErrorMessage = sandbox.apiErrorMessage as (status: number, v: unknown, t: (k: string) => string) => string;
const zh: Record<string, string> = { expiredToken: '令牌无效', noAccess: '无权限', offline: '请求未完成', conflict: '操作冲突', validation: '未通过校验' };
const en: Record<string, string> = { expiredToken: 'Token invalid', noAccess: 'No access', offline: 'Did not finish', conflict: 'Conflict', validation: 'Failed validation' };
const tz = (k: string) => zh[k] ?? k, te = (k: string) => en[k] ?? k;

test('400 validation errors keep the field path and reason', () => {
  const body = { error: 'validation_error', details: [{ path: ['outputs', 0, 'output'], message: 'Expected string, received number' }] };
  const zhMsg = apiErrorMessage(400, body, tz), enMsg = apiErrorMessage(400, body, te);
  assert.match(zhMsg, /^未通过校验/);
  assert.match(enMsg, /^Failed validation/);
  for (const m of [zhMsg, enMsg]) {
    assert.ok(m.includes('outputs[0].output'), m);
    assert.ok(m.includes('Expected string, received number'), m);
    assert.ok(!m.includes('{'), 'no raw JSON: ' + m);
  }
});

test('400 without details still shows the server reason', () => {
  assert.equal(apiErrorMessage(400, { error: 'Idempotency-Key required' }, te), 'Failed validation (Idempotency-Key required)');
});

test('409 conflicts are localized and keep the server reason', () => {
  const m = apiErrorMessage(409, { error: 'Independent pending review required' }, tz);
  assert.equal(m, '操作冲突 (Independent pending review required)');
});

test('5xx and non-JSON responses show the offline hint instead of raw text', () => {
  assert.equal(apiErrorMessage(503, { error: 'service_unavailable' }, tz), '请求未完成');
  assert.equal(apiErrorMessage(502, null, te), 'Did not finish');
  assert.equal(apiErrorMessage(404, null, te), 'Did not finish');
});

test('401 and 403 map to identity messages', () => {
  assert.equal(apiErrorMessage(401, { error: 'Invalid or expired identity' }, te), 'Token invalid');
  assert.equal(apiErrorMessage(403, { error: 'Write role required' }, tz), '无权限');
});

test('other statuses show status plus reason, never raw JSON', () => {
  const m = apiErrorMessage(404, { error: 'Release not found' }, te);
  assert.equal(m, 'HTTP 404 Release not found');
});

test('detail list is bounded to three items', () => {
  const details = Array.from({ length: 5 }, (_, i) => ({ path: ['cases', i, 'id'], message: 'Required' }));
  const m = apiErrorMessage(400, { error: 'validation_error', details }, te);
  assert.equal((m.match(/Required/g) ?? []).length, 3);
});
