import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import amqp from 'amqplib';
import { SignJWT } from 'jose';
import * as domain from '../src/domain.js';

const appId = '00000000-0000-4000-8000-000000000001';
const suiteId = '00000000-0000-4000-8000-000000000002';
const parentId = '00000000-0000-4000-8000-000000000003';
const childId = '00000000-0000-4000-8000-000000000004';
const releaseId = '00000000-0000-4000-8000-000000000005';
const otherId = '00000000-0000-4000-8000-000000000006';
const traceId = '00000000-0000-4000-8000-000000000007';
const secret = 'synthetic-lineage-secret-at-least-32-characters';
const input = { appId, suiteId, candidate: 'lineage-child', commitRef: 'abcdef0', source: 'imported', outputs: [] };
const linkedInput = { ...input, previousJobId: parentId };
const result = (rows: unknown[] = []) => ({ rows, rowCount: rows.length, command: 'SELECT', fields: [], oid: 0 });
type Query = (sql: string, values?: any[]) => Promise<ReturnType<typeof result>>;

test('lineage accepts legacy job input and only optional UUID predecessors', () => {
  assert.equal(domain.jobSchema.safeParse(input).success, true);
  assert.equal(domain.jobSchema.safeParse(linkedInput).success, true);
  for (const previousJobId of ['', 'not-a-uuid', null, 0]) {
    assert.equal(domain.jobSchema.safeParse({ ...input, previousJobId }).success, false);
  }
});
test('review lineage accepts optional UUID references but never caller decision state', () => {
  const schema = (domain as Record<string, any>).releaseRequestSchema;
  assert.ok(schema, 'The review request schema must expose the optional predecessor contract');
  const body = { jobId: childId, note: 'Synthetic request for a new independent review' };
  assert.equal(schema.safeParse(body).success, true);
  assert.equal(schema.safeParse({ ...body, previousReleaseId: releaseId }).success, true);
  for (const extra of [{ previousReleaseId: null }, { previousReleaseId: 'bad' }, { status: 'approved' }, { reviewed_by: 'attacker' }]) {
    assert.equal(schema.safeParse({ ...body, ...extra }).success, false);
  }
});

// Real production routes and authentication; only external database, broker and
// upstream HTTP boundaries are substituted. Real transaction/migration coverage
// is run separately against the disposable CI Compose database, never 5193.
test('lineage route contracts retain the current submission and review guards', { timeout: 15000 }, async t => {
  const settings = { AUTH_MODE: 'dev', ALLOW_DEV_AUTH: 'true', AUTH_SECRET: secret,
    INTERNAL_SECRET: secret, SERVICE_ROLE: 'governance', SUBMISSION_CLOCK_SKEW_BOUND_MS: '0',
    REGISTRY_URL: 'http://synthetic-registry.invalid', EVALUATION_URL: 'http://synthetic-evaluation.invalid' };
  const old = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  Object.assign(process.env, settings);
  const common = await import('../src/common.js');
  const { evaluation } = await import('../src/evaluation.js');
  const { governance } = await import('../src/governance.js');
  const deadlines = await import('../src/submission-deadline.js');
  const { keyHash } = await import('../src/submission-state.js');
  t.after(async () => {
    await common.pool.end();
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const identity = async (workspace = 'workspace-a', role = 'contributor') => 'Bearer ' + await new SignJWT({
    sub: 'synthetic-author', workspace, role, service: false,
  }).setProtectedHeader({ alg: 'HS256' }).setIssuer('releaseguard-local').setAudience('releaseguard')
    .setIssuedAt().setExpirationTime('1m').sign(new TextEncoder().encode(secret));
  const headers = async (payload: unknown, workspace = 'workspace-a') => {
    const authorization = await identity(workspace), key = 'synthetic-lineage-key';
    return { authorization, 'idempotency-key': key, 'x-rg-trace-id': traceId,
      [deadlines.SUBMISSION_BUDGET_HEADER]: deadlines.createSubmissionDeadline({ traceId, method: 'POST', route: '/jobs',
        keySha256: keyHash(key), bodySha256: common.digest(payload), authorizationSha256: keyHash(authorization) }, secret, Date.now()) };
  };
  const createApp = (t: TestContext) => {
    const app = common.server(); app.log.level = 'silent'; t.after(() => app.close()); return app;
  };
  const evaluationApp = async (t: TestContext, query: Query, acquired?: (count: number) => void) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    t.mock.method(common.pool, 'query', query as any);
    let count = 0;
    t.mock.method(common.pool, 'connect', (async () => {
      acquired?.(++count);
      const client = new EventEmitter() as any; client.query = query; client.release = () => {};
      return client;
    }) as any);
    const connection = new EventEmitter() as any;
    connection.createConfirmChannel = async () => ({ assertQueue: async () => {}, close: async () => {}, sendToQueue: () => true, waitForConfirms: async () => {} });
    t.mock.method(amqp, 'connect', (async () => connection) as any);
    const app = createApp(t); await evaluation(app); return app;
  };

  for (const parentStatus of ['succeeded', 'failed']) {
    await t.test(`a ${parentStatus} predecessor is retained in the atomic new job`, async t => {
      let admissions = 0, lookups = 0;
      const app = await evaluationApp(t, async (sql, values) => {
        if (sql.includes('SELECT status,input FROM jobs')) {
          lookups++; assert.deepEqual(values, [parentId, 'workspace-a']);
          return result([{ status: parentStatus, input: { appId } }]);
        }
        if (sql.includes('INSERT INTO jobs') && sql.includes('INSERT INTO outbox')) {
          admissions++; assert.deepEqual(values?.[7], linkedInput); return result([{ job_id: childId }]);
        }
        assert.ok(sql.includes('CREATE TABLE') || sql.includes('SELECT id,status,request_hash'));
        return result();
      });
      t.mock.method(globalThis, 'fetch', (async () => Response.json({ application: { data: {} }, suite: { data: { cases: [] } } })) as any);
      const response = await app.inject({ method: 'POST', url: '/jobs', payload: linkedInput, headers: await headers(linkedInput) });
      assert.equal(response.statusCode, 202); assert.equal(admissions, 1); assert.equal(lookups, 1);
    });
  }
  for (const scenario of [
    { name: 'missing predecessor', parent: undefined, workspace: 'workspace-a', status: 404 },
    { name: 'foreign-workspace predecessor', parent: undefined, workspace: 'workspace-b', status: 404 },
    { name: 'queued predecessor', parent: { status: 'queued', input: { appId } }, workspace: 'workspace-a', status: 409 },
    { name: 'running predecessor', parent: { status: 'running', input: { appId } }, workspace: 'workspace-a', status: 409 },
    { name: 'another application', parent: { status: 'succeeded', input: { appId: otherId } }, workspace: 'workspace-a', status: 409 },
  ]) {
    await t.test(`${scenario.name} creates no new job or snapshot request`, async t => {
      let parents = 0, snapshots = 0, admissions = 0;
      const app = await evaluationApp(t, async (sql, values) => {
        if (sql.includes('SELECT status,input FROM jobs')) {
          parents++; assert.deepEqual(values, [parentId, scenario.workspace]);
          return result(scenario.parent ? [scenario.parent] : []);
        }
        if (sql.includes('INSERT INTO jobs')) admissions++;
        return result();
      });
      t.mock.method(globalThis, 'fetch', (async () => { snapshots++; throw new Error('Rejected lineage must not fetch a snapshot'); }) as any);
      const response = await app.inject({ method: 'POST', url: '/jobs', payload: linkedInput, headers: await headers(linkedInput, scenario.workspace) });
      assert.equal(response.statusCode, scenario.status); assert.equal(parents, 1);
      assert.equal(snapshots, 0); assert.equal(admissions, 0);
    });
  }
  await t.test('an existing linked request replays without a new parent lookup; removing its pointer conflicts', async t => {
    const app = await evaluationApp(t, async sql => {
      if (sql.includes('CREATE TABLE')) return result();
      assert.match(sql, /SELECT id,status,request_hash/);
      return result([{ id: childId, status: 'succeeded', request_hash: common.digest(linkedInput) }]);
    });
    t.mock.method(globalThis, 'fetch', (async () => { throw new Error('Stored replay cannot require an upstream'); }) as any);
    const replay = await app.inject({ method: 'POST', url: '/jobs', payload: linkedInput, headers: await headers(linkedInput) });
    assert.equal(replay.statusCode, 200); assert.equal(replay.json().id, childId);
    const changed = await app.inject({ method: 'POST', url: '/jobs', payload: input, headers: await headers(input) });
    assert.equal(changed.statusCode, 409);
  });
  for (const phase of ['pool acquisition', 'query completion']) {
    await t.test(`lineage ${phase} past the original deadline cannot start admission`, async t => {
      let monotonic = 0, parentQueries = 0, admissions = 0, snapshots = 0;
      t.mock.method(performance, 'now', () => monotonic);
      const app = await evaluationApp(t, async sql => {
        if (sql.includes('SELECT status,input FROM jobs')) {
          parentQueries++; monotonic = 10001; return result([{ status: 'succeeded', input: { appId } }]);
        }
        if (sql.includes('INSERT INTO jobs')) admissions++;
        return result();
      }, count => { if (count === 2 && phase === 'pool acquisition') monotonic = 10001; });
      t.mock.method(globalThis, 'fetch', (async () => { snapshots++; throw new Error('Expired lineage cannot fetch a snapshot'); }) as any);
      const response = await app.inject({ method: 'POST', url: '/jobs', payload: linkedInput, headers: await headers(linkedInput) });
      assert.equal(response.statusCode, 504); assert.equal(response.json().submissionState, 'unknown');
      assert.equal(response.json().automaticRetry, false);
      assert.equal(parentQueries, phase === 'pool acquisition' ? 0 : 1);
      assert.equal(admissions, 0); assert.equal(snapshots, 0);
    });
  }

  const governanceApp = async (t: TestContext, query: Query, evidence: Record<string, any>) => {
    t.mock.method(common.pool, 'query', query as any);
    t.mock.method(common.pool, 'connect', (async () => ({ query, release: () => {} })) as any);
    t.mock.method(globalThis, 'fetch', (async (url: string) => {
      assert.match(url, /^http:\/\/synthetic-evaluation\.invalid\/internal\/jobs\//);
      return Response.json(evidence);
    }) as any);
    const app = createApp(t); await governance(app); return app;
  };
  for (const decision of ['approved', 'rejected']) {
    for (const explicit of [true, false]) {
      await t.test(`${explicit ? 'explicit' : 'automatic'} ${decision} review linkage writes only a new request and audit`, async t => {
        const writes: { sql: string; values?: any[] }[] = [];
        const evidence = { id: childId, status: 'succeeded', created_by: 'original-creator', input: linkedInput, result: { gate: 'passed' } };
        const app = await governanceApp(t, async (sql, values) => {
          if (sql.includes('SELECT id,job_id,status FROM releases')) {
            assert.deepEqual(values, [explicit ? releaseId : parentId, 'workspace-a']);
            return result([{ id: releaseId, job_id: parentId, status: decision }]);
          }
          if (/^(INSERT|UPDATE|DELETE)/.test(sql)) writes.push({ sql, values });
          return result();
        }, evidence);
        const response = await app.inject({ method: 'POST', url: '/releases', headers: { authorization: await identity() },
          payload: { jobId: childId, note: 'Synthetic new review request', ...(explicit ? { previousReleaseId: releaseId } : {}) } });
        assert.equal(response.statusCode, 201); assert.equal(response.json().status, 'pending');
        assert.equal(writes.length, 2); assert.match(writes[0].sql, /^INSERT INTO releases/);
        assert.equal(writes[0].values?.[7], releaseId); assert.deepEqual(writes[0].values?.[5], evidence);
        assert.match(writes[1].sql, /^INSERT INTO audit/);
        assert.equal(writes[1].values?.[5].previousReleaseId, releaseId);
        assert.equal(writes[1].values?.[5].previousJobId, parentId);
      });
    }
  }
  for (const scenario of [
    { name: 'missing review', explicit: true, workspace: 'workspace-a', row: undefined, status: 404 },
    { name: 'foreign review', explicit: true, workspace: 'workspace-b', row: undefined, status: 404 },
    { name: 'unrelated review', explicit: true, workspace: 'workspace-a', row: { id: releaseId, job_id: otherId, status: 'approved' }, status: 409 },
    { name: 'pending explicit review', explicit: true, workspace: 'workspace-a', row: { id: releaseId, job_id: parentId, status: 'pending' }, status: 409 },
    { name: 'pending automatic review', explicit: false, workspace: 'workspace-a', row: { id: releaseId, job_id: parentId, status: 'pending' }, status: 409 },
  ]) {
    await t.test(`${scenario.name} rolls back before writing a request or audit`, async t => {
      const commands: string[] = [];
      const app = await governanceApp(t, async (sql, values) => {
        commands.push(sql);
        if (sql.includes('SELECT id,job_id,status FROM releases')) {
          assert.deepEqual(values, [scenario.explicit ? releaseId : parentId, scenario.workspace]);
          return result(scenario.row ? [scenario.row] : []);
        }
        return result();
      }, { id: childId, status: 'succeeded', created_by: 'original-creator', input: linkedInput, result: { gate: 'passed' } });
      const response = await app.inject({ method: 'POST', url: '/releases', headers: { authorization: await identity(scenario.workspace) },
        payload: { jobId: childId, note: 'Synthetic rejected review request', ...(scenario.explicit ? { previousReleaseId: releaseId } : {}) } });
      assert.equal(response.statusCode, scenario.status);
      assert.equal(commands.filter(sql => /^(INSERT|UPDATE|DELETE)/.test(sql)).length, 0);
      assert.equal(commands.at(-1), 'ROLLBACK');
    });
  }
  await t.test('a prior job without a review retains its job pointer and a null review pointer', async t => {
    const writes: any[][] = [];
    const app = await governanceApp(t, async (sql, values) => {
      if (sql.startsWith('INSERT')) writes.push(values!);
      return result();
    }, { id: childId, status: 'succeeded', created_by: 'original-creator', input: linkedInput, result: { gate: 'passed' } });
    const response = await app.inject({ method: 'POST', url: '/releases', headers: { authorization: await identity() },
      payload: { jobId: childId, note: 'Synthetic request without prior review' } });
    assert.equal(response.statusCode, 201); assert.equal(writes[0][7], null);
    assert.equal(writes[1][5].previousJobId, parentId); assert.equal(writes[1][5].previousReleaseId, null);
  });
});
