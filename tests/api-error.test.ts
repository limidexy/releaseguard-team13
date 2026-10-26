import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Ports PR #4's UI-error contract onto current main. Execute the actual API
// function and translations, with only fetch and the connection controls isolated.
const source = readFileSync('public/app.js', 'utf8');
const copySource = source.slice(source.indexOf('const copy ='), source.indexOf('let language='));
const apiStart = source.indexOf('async function api(');
const apiSource = source.slice(apiStart, source.indexOf('\nasync function safe(', apiStart));
const helperSource = source.match(/\/\/ <api-error>[^\n]*\n([\s\S]*?)\n\/\/ <\/api-error>/)?.[1] ?? '';

function harness(status: number, body: string, language = 'en', token = ' offline-test-token ') {
  const requests: { url: string; init: RequestInit }[] = [];
  let opened = 0;
  const context = vm.createContext({
    AbortSignal,
    $: () => ({ value: token }),
    openConnection: () => { opened++; },
    fetch: async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      return new Response(body, { status });
    },
  });
  vm.runInContext(
    copySource + '\nlet language=' + JSON.stringify(language) +
    '; let connected=true; const t=key=>copy[key]?.[language==="zh"?0:1]??key;\n' +
    helperSource + '\n' + apiSource +
    '\nglobalThis.runApi=api; globalThis.readConnection=()=>connected;', context);
  return {
    api: context.runApi as (path: string, body?: unknown, key?: string) => Promise<unknown>,
    connected: context.readConnection as () => boolean,
    requests,
    opened: () => opened,
  };
}

for (const [language, prefix] of [['zh', /^操作.*冲突/], ['en', /^The action conflicts/]] as const) {
  test('409 reports a localized conflict and preserves the reason in ' + language, async () => {
    const h = harness(409, JSON.stringify({ error: 'Independent pending review required' }), language);
    await assert.rejects(h.api('releases/review'), (e: Error) => {
      assert.match(e.message, prefix);
      assert.ok(e.message.endsWith(' (Independent pending review required)'));
      assert.ok(!e.message.includes('{'));
      return true;
    });
    assert.equal(h.requests.length, 1, 'errors do not automatically retry');
  });
}

test('400 preserves the validation path/reason without dumping JSON', async () => {
  const h = harness(400, JSON.stringify({ error: 'validation_error', details: [
    { path: ['outputs', 0, 'output'], message: 'Expected string, received number' },
  ] }), 'zh');
  await assert.rejects(h.api('jobs'), (e: Error) => {
    assert.match(e.message, /未通过校验/);
    assert.match(e.message, /outputs\[0\]\.output/);
    assert.match(e.message, /Expected string, received number/);
    assert.ok(!e.message.includes('{'));
    return true;
  });
});

for (const [status, body] of [
  [503, '<html>upstream not ready</html>'],
  [502, JSON.stringify({ error: 'upstream_unavailable' })],
  [200, '<html>not JSON evidence</html>'],
] as const) {
  test('non-JSON or upstream failure returns a readable service hint (' + status + ')', async () => {
    const h = harness(status, body);
    await assert.rejects(h.api('jobs'), (e: Error) => {
      assert.match(e.message, /^The request did not finish\./);
      assert.ok(!e.message.includes('<html>'));
      return true;
    });
    assert.equal(h.requests.length, 1);
  });
}

test('401 non-JSON still clears identity and reopens connection', async () => {
  const h = harness(401, '<html>expired identity</html>');
  await assert.rejects(h.api('jobs'), (e: Error) => {
    assert.match(e.message, /^The token is invalid or expired\./);
    return true;
  });
  assert.equal(h.connected(), false);
  assert.equal(h.opened(), 1);
});

test('403 non-JSON uses the role hint without retrying or changing identity', async () => {
  const h = harness(403, '<html>forbidden</html>');
  await assert.rejects(h.api('jobs'), (e: Error) => {
    assert.match(e.message, /^This identity cannot perform the action\./);
    return true;
  });
  assert.equal(h.requests.length, 1);
  assert.equal(h.connected(), true);
  assert.equal(h.opened(), 0);
});

test('successful GET preserves JSON and sends the trimmed token only as a header', async () => {
  const h = harness(200, '[{"id":"existing-job"}]');
  assert.equal(JSON.stringify(await h.api('jobs?limit=25')), '[{"id":"existing-job"}]');
  assert.equal(h.requests[0].url, '/api/v2/jobs?limit=25');
  assert.equal(h.requests[0].init.method, 'GET');
  assert.deepEqual({ ...h.requests[0].init.headers }, { authorization: 'Bearer offline-test-token' });
  assert.equal(h.requests[0].init.body, undefined);
});

test('POST preserves body and idempotency key and does not resubmit on a conflict', async () => {
  const h = harness(409, '{"error":"Existing candidate"}');
  const body = { source: 'replay', candidate: 'isolated-test' };
  await assert.rejects(h.api('jobs', body, 'unchanged-offline-key'));
  assert.equal(h.requests.length, 1);
  const sent = h.requests[0];
  assert.equal(sent.url, '/api/v2/jobs');
  assert.equal(sent.init.method, 'POST');
  assert.equal(sent.init.body, JSON.stringify(body));
  assert.deepEqual({ ...sent.init.headers }, {
    authorization: 'Bearer offline-test-token',
    'content-type': 'application/json',
    'idempotency-key': 'unchanged-offline-key',
  });
});

test('blank token reopens connection before any network request', async () => {
  const h = harness(200, '{}', 'en', '  ');
  await assert.rejects(h.api('jobs'), (e: Error) => {
    assert.match(e.message, /access token/i);
    return true;
  });
  assert.equal(h.requests.length, 0);
  assert.equal(h.opened(), 1);
});

test('other HTTP errors preserve status/reason without raw JSON', async () => {
  const h = harness(404, '{"error":"Release not found"}');
  await assert.rejects(h.api('releases/missing'), (e: Error) => {
    assert.equal(e.message, 'HTTP 404 Release not found');
    return true;
  });
});

test('validation details are bounded to three errors', async () => {
  const details = Array.from({ length: 5 }, (_, i) => ({ path: ['cases', i, 'id'], message: 'Required' }));
  const h = harness(400, JSON.stringify({ error: 'validation_error', details }));
  await assert.rejects(h.api('jobs'), (e: Error) => {
    assert.equal((e.message.match(/Required/g) ?? []).length, 3);
    assert.ok(!e.message.includes('{'));
    return true;
  });
});

for (const [language, hints] of [
  ['zh', [/审核自己提交或申请/, /审核版本已过期/, /未通过门禁/, /刷新后换合适的身份/]],
  ['en', [/created or requested/, /stale review version/, /did not pass the gate/, /Refresh and retry/]],
] as const) {
  test('409 provides actionable independent-review, stale-version and gate guidance in ' + language, async () => {
    const h = harness(409, '{"error":"Independent pending review required"}', language);
    await assert.rejects(h.api('releases/review'), (e: Error) => {
      for (const hint of hints) assert.match(e.message, hint);
      assert.ok(e.message.endsWith(' (Independent pending review required)'));
      return true;
    });
    assert.equal(h.requests.length, 1);
  });
}

for (const [language, instruction] of [
  ['zh', /字段位置和原因.*重试/],
  ['en', /Fix the field and reason.*retry/],
] as const) {
  test('400 tells the user how to correct the field without hiding validation details in ' + language, async () => {
    const h = harness(400, '{"error":"validation_error","details":[{"path":["candidate"],"message":"Required"}]}', language);
    await assert.rejects(h.api('jobs'), (e: Error) => {
      assert.match(e.message, instruction);
      assert.match(e.message, /candidate: Required/);
      assert.ok(!e.message.includes('{'));
      return true;
    });
  });
}

