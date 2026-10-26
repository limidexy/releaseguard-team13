import test, { after, mock, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Socket } from 'node:net';
import { SignJWT } from 'jose';

// Real HTTP handlers, JWT checks and transaction wrapper; only SQL I/O is fake.
// Defaults stay fail-closed even after an individual test's mock is restored.
mock.method(Socket.prototype, 'connect', () => { throw Error('Offline review regression forbids TCP'); });
mock.method(globalThis, 'fetch', async () => { throw Error('Offline review regression forbids fetch'); });
const secret = 'synthetic-review-route-secret-not-a-real-identity';
Object.assign(process.env, { AUTH_MODE: 'dev', ALLOW_DEV_AUTH: 'true', AUTH_SECRET: secret, INTERNAL_SECRET: secret,
  SERVICE_ROLE: 'governance', ALLOW_REAL_MODEL: 'false', DATABASE_URL: 'postgresql://offline:offline@127.0.0.1:1/offline', AMQP_URL: 'amqp://offline:offline@127.0.0.1:1' });
const common = await import('../src/common.js');
const { governance } = await import('../src/governance.js');
const result = (rows: unknown[] = []) => ({ rows, rowCount: rows.length, command: 'SELECT', fields: [], oid: 0 });
mock.method(common.pool, 'query', (async (sql: string) => { assert.match(sql, /^CREATE TABLE IF NOT EXISTS releases/); return result(); }) as any);
mock.method(common.pool, 'connect', async () => { throw Error('Offline review regression requires an explicit SQL boundary'); });
after(() => common.pool.end());
const releaseId = '00000000-0000-4000-8000-000000000001', jobId = '00000000-0000-4000-8000-000000000002';
const stored = { id: releaseId, workspace: 'synthetic-review-workspace', job_id: jobId,
  created_by: 'synthetic-author', requested_by: 'synthetic-requester', status: 'pending', version: 3,
  previous_release_id: '00000000-0000-4000-8000-000000000003',
  evidence: { result: { gate: 'passed', score: 100 }, execution: { outputs: [{ caseId: 'original', output: 'Unchanged original answer' }], provenance: { source: 'replay' } } },
  request_note: 'Synthetic original request', review_note: null, reviewed_by: null };
const command = { decision: 'approved', note: 'Synthetic offline decision, not a human approval', version: 3 };
async function identity(claims: Record<string, unknown> = {}) {
  return 'Bearer ' + await new SignJWT({ sub: 'synthetic-reviewer', workspace: stored.workspace, role: 'reviewer', service: false, ...claims })
    .setProtectedHeader({ alg: 'HS256' }).setIssuer('releaseguard-local').setAudience('releaseguard').setIssuedAt().setExpirationTime('1m').sign(new TextEncoder().encode(secret));
}
async function fixture(t: TestContext, options: { row?: typeof stored | null; fail?: 'update' | 'audit' } = {}) {
  const calls: { sql: string; values?: any[] }[] = []; let connections = 0, released = 0;
  const row = options.row === undefined ? stored : options.row;
  t.mock.method(common.pool, 'connect', (async () => {
    connections++;
    return { release: () => { released++; }, query: async (sql: string, values?: any[]) => {
      calls.push({ sql, values });
      if (sql.startsWith('SELECT')) {
        assert.equal(sql, 'SELECT * FROM releases WHERE id=$1 AND workspace=$2 FOR UPDATE');
        return result(row && values?.[0] === row.id && values?.[1] === row.workspace ? [structuredClone(row)] : []);
      }
      if (sql.startsWith('UPDATE')) { if (options.fail === 'update') throw Error('synthetic private update failure'); return result(); }
      if (sql.startsWith('INSERT INTO audit')) { if (options.fail === 'audit') throw Error('synthetic private audit failure'); return result(); }
      assert.ok(['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql), 'Unexpected transaction SQL: ' + sql);
      return result();
    } };
  }) as any);
  const app = common.server(); app.log.level = 'silent'; await governance(app); t.after(() => app.close());
  const submit = async (body: Record<string, unknown> = command, claims: Record<string, unknown> = {}, url = '/releases/' + releaseId + '/review') => app.inject({ method: 'POST', url, payload: body, headers: { authorization: await identity(claims) } });
  return { app, calls, submit, connections: () => connections, released: () => released };
}
for (const decision of ['approved', 'rejected'] as const) test('actual review route commits one independent ' + decision + ' transition and matching audit', async t => {
  const h = await fixture(t), before = structuredClone(stored);
  const response = await h.submit({ ...command, decision });
  assert.equal(response.statusCode, 200); assert.deepEqual(response.json(), { id: releaseId, status: decision, version: 4 });
  assert.deepEqual(h.calls.map(c => c.sql.split(' ')[0]), ['BEGIN', 'SELECT', 'UPDATE', 'INSERT', 'COMMIT']);
  const update = h.calls[2], audit = h.calls[3];
  assert.match(update.sql, /version=version\+1/); assert.match(update.sql, /WHERE id=\$1 AND workspace=\$2$/);
  assert.deepEqual(update.values, [releaseId, stored.workspace, decision, command.note, 'synthetic-reviewer']);
  assert.match(audit.sql, /^INSERT INTO audit/);
  assert.deepEqual(audit.values?.slice(1), [stored.workspace, 'synthetic-reviewer', decision === 'approved' ? 'ReleaseApproved' : 'ReleaseRejected', releaseId, { ...command, decision, jobId }]);
  assert.deepEqual(stored, before, 'The route must not edit original evidence or predecessor/request fields');
  assert.equal(h.connections(), 1); assert.equal(h.released(), 1);
});
for (const [name, changes, claims, error] of [
  ['creator self-review', {}, { sub: 'synthetic-author' }, 'Independent pending review required'],
  ['requester self-review', {}, { sub: 'synthetic-requester' }, 'Independent pending review required'],
  ['already approved', { status: 'approved' }, {}, 'Independent pending review required'],
  ['already rejected', { status: 'rejected' }, {}, 'Independent pending review required'],
  ['unknown state', { status: 'unknown' }, {}, 'Independent pending review required'],
  ['blocked gate', { evidence: { ...stored.evidence, result: { gate: 'blocked', score: 100 } } }, {}, 'Independent pending review required'],
  ['stale version', { version: 4 }, {}, 'Stale review version'],
] as const) test('actual review route rejects ' + name + ' without a decision or audit write', async t => {
  const h = await fixture(t, { row: { ...stored, ...changes } }); const response = await h.submit(command, claims);
  assert.equal(response.statusCode, 409); assert.equal(response.json().error, error);
  assert.deepEqual(h.calls.map(c => c.sql.split(' ')[0]), ['BEGIN', 'SELECT', 'ROLLBACK']);
  assert.equal(h.released(), 1);
});
for (const missing of [false, true]) test('actual review route hides ' + (missing ? 'missing' : 'foreign-workspace') + ' rows and rolls back', async t => {
  const h = await fixture(t, missing ? { row: null } : {});
  const response = await h.submit(command, missing ? {} : { workspace: 'synthetic-foreign-workspace' });
  assert.equal(response.statusCode, 404); assert.deepEqual(response.json(), { error: 'Release not found' });
  assert.deepEqual(h.calls.map(c => c.sql.split(' ')[0]), ['BEGIN', 'SELECT', 'ROLLBACK']);
  assert.deepEqual(h.calls[1].values, [releaseId, missing ? stored.workspace : 'synthetic-foreign-workspace']);
});
for (const claims of [{ role: 'viewer' }, { role: 'contributor' }, { service: true, principal: 'synthetic-human', role: 'reviewer' }, { service: true, principal: 'synthetic-human', role: 'owner' }]) {
  test('actual review route rejects non-human/non-review role before SQL: ' + JSON.stringify(claims), async t => {
    const h = await fixture(t), response = await h.submit(command, claims);
    assert.equal(response.statusCode, 403); assert.equal(h.connections(), 0); assert.deepEqual(h.calls, []);
  });
}
test('owner may independently review, but a role is not permission to self-review', async t => {
  const h = await fixture(t);
  assert.equal((await h.submit(command, { role: 'owner', sub: 'synthetic-author' })).statusCode, 409);
  assert.equal((await h.submit(command, { role: 'owner' })).statusCode, 200);
});
test('anonymous and invalid identities cannot acquire a review transaction', async t => {
  const h = await fixture(t);
  for (const authorization of [undefined, 'Bearer synthetic-invalid']) {
    const response = await h.app.inject({ method: 'POST', url: '/releases/' + releaseId + '/review', payload: command, headers: authorization ? { authorization } : {} });
    assert.equal(response.statusCode, 401);
  }
  assert.equal(h.connections(), 0); assert.deepEqual(h.calls, []);
});
for (const body of [{ ...command, decision: 'pending' }, { ...command, version: 0 }, { ...command, version: 1.5 }, { ...command, note: 'short' }, { ...command, reviewed_by: 'injected' }]) {
  test('invalid review command cannot acquire SQL: ' + JSON.stringify(body), async t => {
    const h = await fixture(t), response = await h.submit(body);
    assert.equal(response.statusCode, 400); assert.equal(h.connections(), 0); assert.deepEqual(h.calls, []);
  });
}
for (const fail of ['update', 'audit'] as const) test('actual transaction rolls back a ' + fail + ' failure and hides private errors', async t => {
  const h = await fixture(t, { fail }), response = await h.submit();
  assert.equal(response.statusCode, 503); assert.deepEqual(response.json(), { error: 'service_unavailable' });
  assert.equal(h.calls.at(-1)!.sql, 'ROLLBACK'); assert.ok(!h.calls.some(c => c.sql === 'COMMIT'));
  assert.equal(h.released(), 1);
  // Only real PostgreSQL in the separate CI runner proves row rollback, not this SQL double.
});
