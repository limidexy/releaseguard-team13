import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { z } from 'zod';
import { caseSchema, suiteSchema, jobSchema, outputSchema, policySchema } from '../src/domain.js';

const caseInput = { id: 'receipt', name: 'Receipt case', prompt: 'What evidence is needed?', rule: 'contains', expected: 'receipt', critical: true };
const policy = { minScore: 95, maxLatencyMs: 3000 };
const suite = { name: 'Compatibility suite', description: 'Synthetic dependency regression', cases: [caseInput], policy };
const appId = '00000000-0000-4000-8000-000000000001';
const suiteId = '00000000-0000-4000-8000-000000000002';
const job = { appId, suiteId, candidate: 'v1', commitRef: 'abcdef0', source: 'replay' };
const cases = (count: number) => Array.from({ length: count }, (_, i) => ({ ...caseInput, id: `case_${i}` }));

// These are the production domain schemas, not test-owned copies. The largest
// collection has 61 elements: exercise max(60) without reproducing a DoS.
const compatibility: [string, z.ZodType, unknown, boolean][] = [
  ['valid case', caseSchema, caseInput, true],
  ['case unknown field', caseSchema, { ...caseInput, score: 100 }, false],
  ['case missing prompt', caseSchema, { ...caseInput, prompt: undefined }, false],
  ['case invalid ID', caseSchema, { ...caseInput, id: 'with spaces' }, false],
  ['case empty expected', caseSchema, { ...caseInput, expected: '  ' }, false],
  ['not_empty accepts empty expected', caseSchema, { ...caseInput, rule: 'not_empty', expected: '' }, true],
  ['JSON key refinement', caseSchema, { ...caseInput, rule: 'json_keys', expected: 'eligible,' }, false],
  ['critical is a boolean', caseSchema, { ...caseInput, critical: 'true' }, false],
  ['valid suite', suiteSchema, suite, true],
  ['suite at 60 case limit', suiteSchema, { ...suite, cases: cases(60) }, true],
  ['suite rejects 61 cases', suiteSchema, { ...suite, cases: cases(61) }, false],
  ['suite rejects zero cases', suiteSchema, { ...suite, cases: [] }, false],
  ['suite rejects duplicate IDs', suiteSchema, { ...suite, cases: [caseInput, caseInput] }, false],
  ['suite unknown field', suiteSchema, { ...suite, version: 99 }, false],
  ['suite missing policy', suiteSchema, { ...suite, policy: undefined }, false],
  ['valid parent UUID', suiteSchema, { ...suite, parentId: appId }, true],
  ['invalid parent UUID', suiteSchema, { ...suite, parentId: 'not-a-uuid' }, false],
  ['valid policy', policySchema, policy, true],
  ['nullable latency', policySchema, { ...policy, maxLatencyMs: null }, true],
  ['policy score below zero', policySchema, { ...policy, minScore: -1 }, false],
  ['policy score above 100', policySchema, { ...policy, minScore: 101 }, false],
  ['policy latency must be integral', policySchema, { ...policy, maxLatencyMs: 1.5 }, false],
  ['policy rejects unknown field', policySchema, { ...policy, override: true }, false],
  ['valid replay job UUIDs', jobSchema, job, true],
  ['invalid app UUID', jobSchema, { ...job, appId: 'invalid' }, false],
  ['invalid suite UUID', jobSchema, { ...job, suiteId: 'invalid' }, false],
  ['missing app UUID', jobSchema, { ...job, appId: undefined }, false],
  ['job unknown field', jobSchema, { ...job, score: 100 }, false],
  ['job invalid commit', jobSchema, { ...job, commitRef: 'bad ref!' }, false],
  ['import requires outputs', jobSchema, { ...job, source: 'imported' }, false],
  ['import accepts explicit empty outputs', jobSchema, { ...job, source: 'imported', outputs: [] }, true],
  ['replay cannot supply outputs', jobSchema, { ...job, outputs: [] }, false],
  ['invalid prompt version', jobSchema, { ...job, promptVersion: 'v99' }, false],
  ['invalid scenario', jobSchema, { ...job, scenario: 'override' }, false],
  ['outputs at 60 limit', jobSchema, { ...job, source: 'imported', outputs: cases(60).map(c => ({ caseId: c.id, output: 'receipt' })) }, true],
  ['outputs reject 61 elements', jobSchema, { ...job, source: 'imported', outputs: cases(61).map(c => ({ caseId: c.id, output: 'receipt' })) }, false],
  ['valid output', outputSchema, { caseId: 'receipt', output: 'receipt', latencyMs: 0 }, true],
  ['output unknown field', outputSchema, { caseId: 'receipt', score: 100 }, false],
  ['output negative latency', outputSchema, { caseId: 'receipt', latencyMs: -1 }, false],
  ['output nonfinite latency', outputSchema, { caseId: 'receipt', latencyMs: Infinity }, false],
  ['output NaN latency', outputSchema, { caseId: 'receipt', latencyMs: NaN }, false],
];

for (const [name, schema, input, accepted] of compatibility) {
  test(`dependency compatibility: ${name}`, () => {
    const result = schema.safeParse(input);
    assert.equal(result.success, accepted);
    if (!result.success) {
      assert(result.error instanceof z.ZodError);
      assert(result.error.issues.length > 0);
      for (const issue of result.error.issues) {
        assert(Array.isArray(issue.path));
        assert.equal(typeof issue.message, 'string');
      }
    }
  });
}

const require = createRequire(import.meta.url);
for (const [name, load] of [
  ['application dependency', () => require('fast-uri')],
  ['AJV dependency', () => createRequire(require.resolve('ajv'))('fast-uri')],
] as const) {
  test(`dependency security: ${name} does not decode an encoded URI scheme`, () => {
    const uri = load();
    for (const input of ['%6Aavascript:alert(1)', '%u006Aavascript:alert(1)']) {
      assert(uri.parse(input).error, 'encoded scheme must be reported malformed');
      assert.notEqual(uri.parse(input).scheme, 'javascript');
      assert.notEqual(uri.normalize(input), 'javascript:alert(1)');
    }
    assert.equal(uri.normalize('https://example.invalid/path'), 'https://example.invalid/path');
  });
}

test('dependency compatibility: actual route validation and HTTP 400 stay offline', () => {
  const common = new URL('../src/common.js', import.meta.url).href;
  const registry = new URL('../src/registry.js', import.meta.url).href;
  const evaluation = new URL('../src/evaluation.js', import.meta.url).href;
  const governance = new URL('../src/governance.js', import.meta.url).href;
  // Isolate auth/pool configuration from the developer's environment. All DB
  // and broker operations below are explicit in-memory fakes. inject() never
  // listens on a socket; network attempts fail even if a future edit adds one.
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import net from 'node:net';
    import { SignJWT } from 'jose';
    import amqp from 'amqplib';
    const forbidden = { listen: 0, connect: 0, fetch: 0 };
    net.Server.prototype.listen = function () { forbidden.listen++; throw new Error('No listeners in compatibility test'); };
    net.Socket.prototype.connect = function () { forbidden.connect++; throw new Error('No network in compatibility test'); };
    globalThis.fetch = async function () { forbidden.fetch++; throw new Error('No fetch in compatibility test'); };
    const { server, pool, actorSchema } = await import(${JSON.stringify(common)});
    const queries = [];
    const query = async (sql, values) => {
      queries.push({ sql, values });
      if (/^CREATE TABLE|^BEGIN$|^COMMIT$|^ROLLBACK$|^INSERT INTO applications|^SELECT id,status,created_by|^SELECT [*] FROM releases/.test(sql)) return { rows: [] };
      throw new Error('Unexpected mocked SQL: ' + sql);
    };
    pool.query = query;
    pool.connect = async () => ({ query, release() {} });
    const channel = { async assertQueue() {}, async close() {}, async waitForConfirms() {}, sendToQueue() { return true; } };
    const connection = { on() { return this; }, async createConfirmChannel() { return channel; } };
    amqp.connect = async () => connection;
    const actorInput = { sub: 'synthetic-reviewer', workspace: 'synthetic-workspace', role: 'reviewer' };
    assert.equal(actorSchema.parse(actorInput).service, false);
    assert.equal(actorSchema.safeParse({ ...actorInput, service: true }).success, false);
    assert.equal(actorSchema.safeParse({ ...actorInput, service: true, principal: '' }).success, false);
    assert.equal(actorSchema.safeParse({ ...actorInput, service: true, principal: 'synthetic-accountable-person' }).success, true);
    assert.equal(actorSchema.safeParse({ ...actorInput, role: 'admin' }).success, false);
    assert.equal(actorSchema.safeParse({ ...actorInput, sub: '' }).success, false);
    const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
    const token = async role => new SignJWT({ ...actorInput, role }).setProtectedHeader({ alg: 'HS256' }).setIssuer('releaseguard-local').setAudience('releaseguard').setIssuedAt().setExpirationTime('1m').sign(secret);
    const contributor = 'Bearer ' + await token('contributor');
    const reviewer = 'Bearer ' + await token('reviewer');
    const app = server();
    app.log.level = 'silent';
    let headerHandlerCalls = 0;
    app.get('/synthetic-header-contract', { schema: { headers: { type: 'object', propertyNames: { not: { enum: ['X-Debug-Override'] } } } } }, async () => { headerHandlerCalls++; return { ok: true }; });
    await (await import(${JSON.stringify(registry)})).registry(app);
    await (await import(${JSON.stringify(evaluation)})).evaluation(app);
    await (await import(${JSON.stringify(governance)})).governance(app);
    const checks = [];
    const check = async (name, options, expected, path) => {
      const res = await app.inject(options);
      assert.equal(res.statusCode, expected, name + ': ' + res.body);
      const body = res.json();
      if (expected === 400) {
        assert.equal(body.error, 'validation_error', name);
        assert(body.details.length > 0, name);
        assert(body.details.every(d => Array.isArray(d.path) && typeof d.message === 'string'), name);
        if (path) assert(body.details.some(d => d.path.join('.') === path), name);
        assert.equal('issues' in body, false, 'internal Zod issue representation is not the HTTP contract');
      }
      checks.push(name);
      return body;
    };
    const application = { name: 'Synthetic app', description: 'Dependency compatibility only', runnerUrl: 'https://runner.invalid/execute' };
    const post = (url, payload, authorization = contributor) => ({ method: 'POST', url, headers: { authorization }, payload });
    const id = '00000000-0000-4000-8000-000000000001';
    try {
      // Small reproducer from GHSA-389g-gv7q-r4x8. Exercise both wire cases
      // against the patched Fastify compiler, without adding a production route.
      for (const header of ['X-Debug-Override', 'x-debug-override']) {
        const response = await app.inject({ url: '/synthetic-header-contract', headers: { [header]: 'synthetic' } });
        assert.equal(response.statusCode, 400, 'header deny-list must survive case normalization');
      }
      assert.equal(headerHandlerCalls, 0);
      assert.equal((await app.inject({ url: '/synthetic-header-contract', headers: { 'x-safe-header': 'synthetic' } })).statusCode, 200);
      assert.equal(headerHandlerCalls, 1);
      await check('allowed runner URL', post('/applications', application), 201);
      await check('invalid runner URL', post('/applications', { ...application, runnerUrl: 'not-a-url' }), 400, 'runnerUrl');
      await check('unknown application field', post('/applications', { ...application, override: true }), 400);
      await check('missing application name', post('/applications', { ...application, name: undefined }), 400, 'name');
      await check('pagination defaults', { url: '/jobs', headers: { authorization: contributor } }, 200);
      assert.deepEqual(queries.at(-1).values, ['synthetic-workspace', 25, 0]);
      await check('pagination string coercion', { url: '/jobs?limit=100&offset=10000', headers: { authorization: contributor } }, 200);
      assert.deepEqual(queries.at(-1).values, ['synthetic-workspace', 100, 10000]);
      for (const query of ['limit=0', 'limit=101', 'limit=1.5', 'limit=word', 'offset=-1', 'offset=10001', 'offset=1.5', 'offset=word']) {
        await check('pagination rejects ' + query, { url: '/jobs?' + query, headers: { authorization: contributor } }, 400, query.split('=')[0]);
      }
      for (const payload of [{ jobId: id, note: 'tiny' }, { jobId: 'invalid', note: 'Valid request note' }, { jobId: id }, { jobId: id, note: 'Valid request note', override: true }]) {
        await check('release request input ' + JSON.stringify(payload), post('/releases', payload), 400);
      }
      const review = { decision: 'approved', note: 'Synthetic review only', version: 1 };
      // No release exists in the fake DB: 404 proves schema validation was
      // accepted, without approving anything or claiming transaction coverage.
      await check('valid review reaches mocked missing record', post('/releases/' + id + '/review', review, reviewer), 404);
      for (const payload of [{ ...review, note: 'too short' }, { ...review, version: 0 }, { ...review, version: 1.5 }, { ...review, version: '1' }, { ...review, version: undefined }, { ...review, decision: 'override' }, { ...review, score: 100 }]) {
        await check('review rejects ' + JSON.stringify(payload), post('/releases/' + id + '/review', payload, reviewer), 400);
      }
      await check('review UUID error', post('/releases/not-a-uuid/review', review, reviewer), 400, 'id');
      await check('unauthenticated remains 401', { url: '/jobs' }, 401);
    } finally {
      await app.close();
      await pool.end();
    }
    assert.deepEqual(forbidden, { listen: 0, connect: 0, fetch: 0 });
    assert.equal(app.server.listening, false);
    assert.equal(pool.totalCount, 0);
    assert.equal(pool.idleCount, 0);
    assert.equal(pool.waitingCount, 0);
    process.stdout.write(JSON.stringify({ checks, actorChecks: 6, forbidden, poolTotal: pool.totalCount }));
  `], {
    cwd: new URL('../..', import.meta.url),
    encoding: 'utf8', timeout: 15000, maxBuffer: 262144,
    env: {
      AUTH_MODE: 'dev', ALLOW_DEV_AUTH: 'true', SERVICE_ROLE: 'gateway',
      AUTH_SECRET: 'synthetic-dependency-test-secret-not-a-real-credential',
      DATABASE_URL: 'postgres://unused:unused@127.0.0.1:1/never_connected',
      AMQP_URL: 'amqp://127.0.0.1:1/never_connected',
      RUNNER_ORIGINS: 'https://runner.invalid', NODE_ENV: 'test', TZ: 'UTC',
    },
  });
  assert.equal(child.error, undefined, 'isolated compatibility process must complete');
  assert.equal(child.status, 0, 'isolated compatibility failure: ' + child.stderr);
  assert.equal(child.stderr, '');
  const result = JSON.parse(child.stdout);
  assert.equal(result.checks.length, 28);
  assert.equal(result.actorChecks, 6);
  assert.deepEqual(result.forbidden, { listen: 0, connect: 0, fetch: 0 });
  assert.equal(result.poolTotal, 0);
});
