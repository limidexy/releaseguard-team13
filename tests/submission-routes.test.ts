import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import Fastify from 'fastify';
import amqp from 'amqplib';
import { SignJWT } from 'jose';

const appId = '00000000-0000-4000-8000-000000000001';
const suiteId = '00000000-0000-4000-8000-000000000002';
const jobId = '00000000-0000-4000-8000-000000000003';
const traceId = '00000000-0000-4000-8000-000000000004';
const key = 'synthetic-key-123';
const secret = 'synthetic-route-secret-at-least-32-characters';
const input = { appId, suiteId, candidate: 'synthetic-v1', commitRef: 'abcdef0', source: 'imported', outputs: [] };
const result = (rows: unknown[] = []) => ({ rows, rowCount: rows.length, command: 'SELECT', fields: [], oid: 0 });

async function body(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function within<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Timed out waiting for synthetic HTTP event')), milliseconds);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

async function upstream(t: TestContext, handler: (req: IncomingMessage, reply: ServerResponse) => void | Promise<void>) {
  const service = http.createServer((req, reply) => {
    Promise.resolve(handler(req, reply)).catch(error => { reply.destroy(error); });
  });
  await new Promise<void>((resolve, reject) => {
    service.once('error', reject);
    service.listen(0, '127.0.0.1', () => { service.off('error', reject); resolve(); });
  });
  t.after(async () => {
    service.closeAllConnections();
    await new Promise<void>((resolve, reject) => service.close(error => error ? reject(error) : resolve()));
  });
  return `http://127.0.0.1:${(service.address() as AddressInfo).port}`;
}

// Route-level contracts use real HTTP only on loopback and substitute database
// and broker boundaries. They do not claim PostgreSQL/RabbitMQ integration.
test('submission route contracts', { timeout: 20000 }, async t => {
  const settings: Record<string, string> = {
    AUTH_MODE: 'dev', ALLOW_DEV_AUTH: 'true', AUTH_SECRET: secret,
    INTERNAL_SECRET: secret, SERVICE_ROLE: 'evaluation', SUBMISSION_CLOCK_SKEW_BOUND_MS: '0',
  };
  const old = Object.fromEntries([...Object.keys(settings), 'EVALUATION_URL', 'REGISTRY_URL', 'MAX_JOBS_PER_MINUTE'].map(name => [name, process.env[name]]));
  Object.assign(process.env, settings);
  const common = await import('../src/common.js');
  const { gateway } = await import('../src/gateway.js');
  const { registry } = await import('../src/registry.js');
  const { evaluation } = await import('../src/evaluation.js');
  const deadlines = await import('../src/submission-deadline.js');
  const { keyHash } = await import('../src/submission-state.js');
  t.after(async () => {
    await common.pool.end();
    for (const [name, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });

  const userToken = async (workspace = 'workspace-a') => 'Bearer ' + await new SignJWT({
    sub: 'synthetic-contributor', workspace, role: 'contributor', service: false,
  }).setProtectedHeader({ alg: 'HS256' }).setIssuer('releaseguard-local').setAudience('releaseguard')
    .setIssuedAt().setExpirationTime('1m').sign(new TextEncoder().encode(secret));
  const internalToken = async () => 'Bearer ' + await new SignJWT({ caller: 'evaluation' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuer('releaseguard-services').setAudience(common.role)
    .setIssuedAt().setExpirationTime('1m').sign(new TextEncoder().encode(secret));
  const signedHeaders = (authorization: string, route: string, payload: unknown, startedAtMs = Date.now(), target: 'evaluation' | 'registry' = 'evaluation', idempotencyKey = key) => ({
    authorization, 'idempotency-key': idempotencyKey, 'x-rg-trace-id': traceId,
    [deadlines.SUBMISSION_KEY_HASH_HEADER]: keyHash(idempotencyKey),
    [deadlines.SUBMISSION_BUDGET_HEADER]: deadlines.createSubmissionDeadline({
      traceId, method: target === 'registry' ? 'GET' : 'POST', route,
      keySha256: keyHash(idempotencyKey), bodySha256: common.digest(payload), authorizationSha256: keyHash(authorization),
    }, secret, startedAtMs, target),
  });

  await t.test('gateway replaces untrusted internal headers with a request-bound deadline', async t => {
    let received = 0;
    process.env.EVALUATION_URL = await upstream(t, async (req, reply) => {
      received++;
      const payload = JSON.parse(await body(req));
      assert.deepEqual(payload, input);
      assert.notEqual(req.headers['x-rg-trace-id'], traceId);
      assert.equal(req.headers[deadlines.SUBMISSION_KEY_HASH_HEADER], undefined);
      const budget = deadlines.receiveSubmissionDeadline(req.headers[deadlines.SUBMISSION_BUDGET_HEADER], {
        traceId: String(req.headers['x-rg-trace-id']), method: 'POST', route: '/jobs',
        keySha256: keyHash(key), bodySha256: common.digest(payload), authorizationSha256: keyHash('Bearer synthetic-user'),
      }, secret, 0);
      try { assert.ok(budget.remainingMs() > 0 && budget.remainingMs() <= deadlines.SUBMISSION_BUDGET_MS); }
      finally { budget.dispose(); }
      reply.writeHead(202, { 'content-type': 'application/json' }).end(JSON.stringify({ id: jobId, status: 'queued' }));
    });
    const app = Fastify({ logger: false });
    t.after(() => app.close());
    await gateway(app);
    const reply = await app.inject({ method: 'POST', url: '/api/v2/jobs', payload: input, headers: {
      authorization: 'Bearer synthetic-user', 'idempotency-key': key,
      'x-rg-trace-id': traceId, [deadlines.SUBMISSION_BUDGET_HEADER]: 'attacker-context',
      [deadlines.SUBMISSION_KEY_HASH_HEADER]: 'attacker-key',
    } });
    assert.equal(reply.statusCode, 202);
    assert.equal(reply.json().id, jobId);
    assert.equal(received, 1);
  });

  await t.test('gateway signs the actual upstream path for raw empty and encoded query strings', async t => {
    const received: string[] = [];
    process.env.EVALUATION_URL = await upstream(t, async (req, reply) => {
      received.push(req.url!);
      assert.equal(req.method, 'POST');
      const payload = JSON.parse(await body(req));
      const budget = deadlines.receiveSubmissionDeadline(req.headers[deadlines.SUBMISSION_BUDGET_HEADER], {
        traceId: String(req.headers['x-rg-trace-id']), method: req.method, route: req.url!,
        keySha256: keyHash(key), bodySha256: common.digest(payload), authorizationSha256: keyHash('Bearer synthetic-user'),
      }, secret, 0);
      budget.dispose();
      reply.writeHead(202, { 'content-type': 'application/json' }).end(JSON.stringify({ id: jobId, status: 'queued' }));
    });
    t.mock.method(globalThis, 'fetch', (async () => { throw new Error('Submission must use the non-retrying native transport'); }) as any);
    const app = Fastify({ logger: false });
    t.after(() => app.close());
    await gateway(app);
    const address = new URL(await app.listen({ host: '127.0.0.1', port: 0 }));
    // Fetch would remove the empty '?' before the gateway sees it. The native
    // client's path option preserves the raw request target for this regression.
    const cases: { path: string; upstreamPath?: string; status: number }[] = [
      { path: '/api/v2/jobs?', upstreamPath: '/jobs', status: 202 },
      { path: '/api/v2/jobs?note=%E6%B5%8B%E8%AF%95&escaped=%2F%3F', upstreamPath: '/jobs?note=%E6%B5%8B%E8%AF%95&escaped=%2F%3F', status: 202 },
      { path: '/api/v2/jobs?note=caf%C3%A9', upstreamPath: '/jobs?note=caf%C3%A9', status: 202 },
      // An unescaped Latin-1 byte is not a valid UTF-8 HTTP query. Keep the
      // framework's existing rejection; it must not turn into a signed POST.
      { path: '/api/v2/jobs?note=caf\u00e9', status: 400 },
      { path: '/api/v2/unknown?', status: 404 },
    ];
    for (const { path, status } of cases) {
      const response = await within(new Promise<{ status: number; data: string }>((resolve, reject) => {
        const request = http.request({ hostname: address.hostname, port: address.port, path, method: 'POST', agent: false, headers: {
          'content-type': 'application/json', authorization: 'Bearer synthetic-user', 'idempotency-key': key,
        } }, reply => { body(reply).then(data => resolve({ status: reply.statusCode!, data }), reject); });
        request.once('error', reject);
        t.after(() => request.destroy());
        request.end(JSON.stringify(input));
      }), 1500);
      assert.equal(response.status, status, `Raw path ${JSON.stringify(path)}: ${response.data}`);
      if (status === 202) assert.equal(JSON.parse(response.data).id, jobId);
    }
    assert.deepEqual(received, cases.flatMap(value => value.upstreamPath ? [value.upstreamPath] : []));
  });

  await t.test('gateway preserves upstream rejection statuses without retrying', async t => {
    let received = 0, status = 409;
    process.env.EVALUATION_URL = await upstream(t, async (req, reply) => {
      received++; await body(req);
      reply.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'synthetic-rejection' }));
    });
    const app = Fastify({ logger: false });
    t.after(() => app.close());
    await gateway(app);
    for (const code of [409, 429, 503, 504]) {
      status = code;
      const reply = await app.inject({ method: 'POST', url: '/api/v2/jobs', payload: input, headers: { 'idempotency-key': key } });
      assert.equal(reply.statusCode, code);
      assert.deepEqual(reply.json(), { error: 'synthetic-rejection' });
    }
    assert.equal(received, 4);
  });

  await t.test('gateway reports a lost submission response as unknown and never resends it', async t => {
    let received = 0;
    process.env.EVALUATION_URL = await upstream(t, async (req, reply) => { received++; await body(req); reply.destroy(); });
    const app = Fastify({ logger: false });
    t.after(() => app.close());
    await gateway(app);
    const reply = await app.inject({ method: 'POST', url: '/api/v2/jobs', payload: input, headers: { 'idempotency-key': key } });
    assert.equal(reply.statusCode, 504);
    assert.deepEqual(reply.json(), {
      error: 'submission_outcome_unknown', submissionState: 'unknown', idempotencyKey: key,
      statusUrl: '/api/v2/jobs/submissions/' + key, doNotResubmit: true, automaticRetry: false,
    });
    assert.equal(received, 1);
  });

  await t.test('gateway rejects a completed response past the monotonic deadline even before its timer fires', async t => {
    let monotonic = 0, received = 0;
    t.mock.method(performance, 'now', () => monotonic);
    process.env.EVALUATION_URL = await upstream(t, async (req, reply) => {
      received++;
      await body(req);
      // The real 10-second timeout has not fired. Model an event-loop stall
      // making the upstream response callback run after the absolute budget.
      monotonic = deadlines.SUBMISSION_BUDGET_MS + 1;
      reply.writeHead(202, { 'content-type': 'application/json' }).end(JSON.stringify({ id: jobId, status: 'queued' }));
    });
    const app = Fastify({ logger: false });
    t.after(() => app.close());
    await gateway(app);
    const reply = await app.inject({ method: 'POST', url: '/api/v2/jobs', payload: input, headers: { 'idempotency-key': key } });
    assert.equal(reply.statusCode, 504);
    assert.equal(reply.json().submissionState, 'unknown');
    assert.equal(reply.json().automaticRetry, false);
    assert.equal(reply.json().doNotResubmit, true);
    assert.equal(received, 1);
  });

  await t.test('gateway keeps origin checks before forwarding a mutation', async t => {
    let received = 0;
    process.env.EVALUATION_URL = await upstream(t, (_req, reply) => { received++; reply.end('{}'); });
    const app = Fastify({ logger: false });
    t.after(() => app.close());
    await gateway(app);
    const reply = await app.inject({ method: 'POST', url: '/api/v2/jobs', payload: input, headers: { 'sec-fetch-site': 'cross-site' } });
    assert.equal(reply.statusCode, 403);
    assert.equal(received, 0);
  });

  await t.test('closing the gateway client cancels an in-flight submission without a second POST', async t => {
    let arrived!: () => void, closed!: () => void, received = 0;
    const arrival = new Promise<void>(resolve => { arrived = resolve; });
    const cancellation = new Promise<void>(resolve => { closed = resolve; });
    process.env.EVALUATION_URL = await upstream(t, async (req, reply) => {
      received++;
      await body(req);
      reply.once('close', closed);
      arrived();
      // Deliberately leave the response pending until downstream cancellation.
    });
    const app = Fastify({ logger: false });
    t.after(() => app.close());
    await gateway(app);
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const request = http.request(address + '/api/v2/jobs', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key },
    });
    request.on('error', () => {});
    t.after(() => request.destroy());
    request.end(JSON.stringify(input));
    await within(arrival, 1500);
    request.destroy();
    await within(cancellation, 1500);
    assert.equal(received, 1);
  });

  await t.test('registry rejects unsigned, altered and expired snapshot contexts before any query', async t => {
    t.mock.method(common.pool, 'query', (async () => result()) as any);
    let dispatched = 0;
    t.mock.method(common.pool, 'connect', (async () => { dispatched++; throw new Error('Unexpected database acquisition'); }) as any);
    const app = Fastify({ logger: false });
    t.after(() => app.close());
    await registry(app);
    const route = `/internal/snapshot/${appId}/${suiteId}?workspace=workspace-a`;
    const authorization = await internalToken();
    assert.equal((await app.inject({ url: route, headers: { authorization } })).statusCode, 401);
    const valid = signedHeaders(authorization, route, null, Date.now(), 'registry');
    assert.equal((await app.inject({ url: route + '-changed', headers: valid })).statusCode, 401);
    assert.equal((await app.inject({ url: route, headers: { ...valid, [deadlines.SUBMISSION_KEY_HASH_HEADER]: keyHash('different-key') } })).statusCode, 401);
    const expired = signedHeaders(authorization, route, null, Date.now() - 11000, 'registry');
    assert.equal((await app.inject({ url: route, headers: expired })).statusCode, 504);
    assert.equal(dispatched, 0);
  });

  await t.test('registry reads the signed workspace with one snapshot query and releases one borrowed client', async t => {
    t.mock.method(common.pool, 'query', (async () => result()) as any);
    const queries: { sql: string; values: unknown[] }[] = [];
    let released = 0;
    t.mock.method(common.pool, 'connect', (async () => {
      const client = new EventEmitter() as any;
      client.query = async (sql: string, values: unknown[]) => {
        queries.push({ sql, values });
        return result([{ application_id: appId, application_data: { name: 'Synthetic app' }, suite_id: suiteId, suite_version: 1, suite_data: { cases: [] } }]);
      };
      client.release = () => { released++; };
      return client;
    }) as any);
    const app = Fastify({ logger: false });
    t.after(() => app.close());
    await registry(app);
    const route = `/internal/snapshot/${appId}/${suiteId}?workspace=workspace-a`;
    const reply = await app.inject({ url: route, headers: signedHeaders(await internalToken(), route, null, Date.now(), 'registry') });
    assert.equal(reply.statusCode, 200);
    assert.equal(reply.json().application.id, appId);
    assert.equal(reply.json().suite.id, suiteId);
    assert.equal(queries.length, 1);
    assert.deepEqual(queries[0].values, [appId, suiteId, 'workspace-a']);
    assert.equal(released, 1);
  });

  // Freeze only the background interval: deadline timeouts remain real. These
  // request-level assertions must not depend on beating the publisher's 250ms
  // interval on a busy CI host, or count its transaction queries as requests.
  const evaluationApp = async (t: TestContext, query: (sql: string, values?: unknown[]) => Promise<ReturnType<typeof result>>) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    t.mock.method(common.pool, 'query', query as any);
    t.mock.method(common.pool, 'connect', (async () => {
      const client = new EventEmitter() as any;
      client.query = query;
      client.release = () => {};
      return client;
    }) as any);
    const connection = new EventEmitter() as any;
    connection.createConfirmChannel = async () => ({ assertQueue: async () => {}, close: async () => {}, sendToQueue: () => true, waitForConfirms: async () => {} });
    t.mock.method(amqp, 'connect', (async () => connection) as any);
    const app = Fastify({ logger: false });
    t.after(() => app.close());
    await evaluation(app);
    return app;
  };

  await t.test('evaluation requires a bound context before any job lookup or mutation', async t => {
    let queries = 0;
    const app = await evaluationApp(t, async sql => { if (!sql.includes('CREATE TABLE')) queries++; return result(); });
    const authorization = await userToken();
    const unsigned = await app.inject({ method: 'POST', url: '/jobs', payload: input, headers: { authorization, 'idempotency-key': key } });
    assert.equal(unsigned.statusCode, 401);
    const headers = signedHeaders(authorization, '/jobs', input);
    const altered = await app.inject({ method: 'POST', url: '/jobs', payload: { ...input, candidate: 'different' }, headers });
    assert.equal(altered.statusCode, 401);
    const expired = await app.inject({ method: 'POST', url: '/jobs', payload: input, headers: signedHeaders(authorization, '/jobs', input, Date.now() - 11000) });
    assert.equal(expired.statusCode, 504);
    assert.equal(expired.json().submissionState, 'unknown');
    assert.equal(queries, 0);
  });

  await t.test('evaluation preserves an idempotent replay and rejects a changed payload', async t => {
    let reads = 0;
    const app = await evaluationApp(t, async sql => {
      if (sql.includes('existing_lookup') || sql.includes('SELECT id,status,request_hash')) {
        reads++;
        return result([{ id: jobId, status: 'succeeded', request_hash: common.digest(input) }]);
      }
      if (!sql.includes('CREATE TABLE')) throw new Error('Replay must not dispatch a mutation');
      return result();
    });
    t.mock.method(globalThis, 'fetch', (async () => { throw new Error('Replay must not request another snapshot'); }) as any);
    const authorization = await userToken();
    const replay = await app.inject({ method: 'POST', url: '/jobs', payload: input, headers: signedHeaders(authorization, '/jobs', input) });
    assert.equal(replay.statusCode, 200);
    assert.deepEqual(replay.json(), { id: jobId, status: 'succeeded', replayed: true });
    const changed = { ...input, candidate: 'different' };
    const conflict = await app.inject({ method: 'POST', url: '/jobs', payload: changed, headers: signedHeaders(authorization, '/jobs', changed) });
    assert.equal(conflict.statusCode, 409);
    assert.equal(reads, 2);
  });

  await t.test('evaluation carries the original deadline through snapshot and one atomic admission', async t => {
    const started = Date.now() - 25;
    const admissions: unknown[][] = [];
    process.env.MAX_JOBS_PER_MINUTE = '7';
    process.env.REGISTRY_URL = 'http://synthetic-registry.invalid';
    const app = await evaluationApp(t, async (sql, values) => {
      if (sql.includes('INSERT INTO jobs') && sql.includes('INSERT INTO outbox')) { admissions.push(values!); return result([{ job_id: jobId }]); }
      return result();
    });
    let snapshots = 0;
    t.mock.method(globalThis, 'fetch', (async (url: string, init: RequestInit) => {
      snapshots++;
      const parsed = new URL(url), headers = init.headers as Record<string, string>;
      const budget = deadlines.receiveSubmissionDeadline(headers[deadlines.SUBMISSION_BUDGET_HEADER], {
        traceId, method: 'GET', route: parsed.pathname + parsed.search,
        keySha256: keyHash(key), bodySha256: common.digest(null), authorizationSha256: keyHash(headers.authorization),
      }, secret, 0, undefined, 'registry');
      try { assert.equal(budget.startedAtMs, started); assert.equal(budget.deadlineAtMs, started + deadlines.SUBMISSION_BUDGET_MS); }
      finally { budget.dispose(); }
      assert.equal(parsed.searchParams.get('workspace'), 'workspace-a');
      return Response.json({ application: { data: {} }, suite: { data: { cases: [] } } });
    }) as any);
    const authorization = await userToken();
    const reply = await app.inject({ method: 'POST', url: '/jobs', payload: input, headers: signedHeaders(authorization, '/jobs', input, started) });
    assert.equal(reply.statusCode, 202);
    assert.equal(snapshots, 1);
    assert.equal(admissions.length, 1);
    assert.equal(admissions[0][1], 7);
    assert.equal(admissions[0][3], 'workspace-a');
    assert.equal(admissions[0][4], 'synthetic-contributor');
    assert.equal(admissions[0][6], key);
  });

  await t.test('an invalid Registry snapshot fails closed and a later submission fetches again', async t => {
    process.env.REGISTRY_URL = 'http://synthetic-registry.invalid';
    let snapshots = 0, admissions = 0;
    const app = await evaluationApp(t, async sql => {
      if (sql.includes('SELECT id,status,request_hash')) return result();
      if (sql.includes('INSERT INTO jobs') && sql.includes('INSERT INTO outbox')) { admissions++; return result([{ job_id: jobId }]); }
      return result();
    });
    t.mock.method(globalThis, 'fetch', (async () => {
      snapshots++;
      return snapshots === 1 ? Response.json({ malformed: true }) : Response.json({ application: { data: {} }, suite: { data: { cases: [] } } });
    }) as any);
    const authorization = await userToken();
    const first = { ...input, candidate: 'invalid-snapshot-a' };
    const failed = await app.inject({ method: 'POST', url: '/jobs', payload: first,
      headers: signedHeaders(authorization, '/jobs', first, Date.now(), 'evaluation', 'invalid-snapshot-a') });
    assert.equal(failed.statusCode, 503);
    const second = { ...input, candidate: 'invalid-snapshot-b' };
    const recovered = await app.inject({ method: 'POST', url: '/jobs', payload: second,
      headers: signedHeaders(authorization, '/jobs', second, Date.now(), 'evaluation', 'invalid-snapshot-b') });
    assert.equal(recovered.statusCode, 202);
    assert.equal(snapshots, 2); assert.equal(admissions, 1);
  });

  await t.test('a configured zero admission limit returns 429 without dispatching admission SQL', async t => {
    const previous = process.env.MAX_JOBS_PER_MINUTE;
    process.env.MAX_JOBS_PER_MINUTE = '0';
    t.after(() => {
      if (previous === undefined) delete process.env.MAX_JOBS_PER_MINUTE;
      else process.env.MAX_JOBS_PER_MINUTE = previous;
    });
    process.env.REGISTRY_URL = 'http://synthetic-registry.invalid';
    const queries: string[] = [];
    const app = await evaluationApp(t, async sql => {
      if (!sql.includes('CREATE TABLE')) queries.push(sql);
      return result();
    });
    t.mock.method(globalThis, 'fetch', (async () => Response.json({ application: { data: {} }, suite: { data: { cases: [] } } })) as any);
    const authorization = await userToken();
    const reply = await app.inject({ method: 'POST', url: '/jobs', payload: input, headers: signedHeaders(authorization, '/jobs', input) });
    assert.equal(reply.statusCode, 429);
    assert.equal(queries.length, 1);
    assert.match(queries[0], /SELECT id,status,request_hash FROM jobs/);
  });

  await t.test('evaluation does not retry or claim rejection when the admission acknowledgement is lost', async t => {
    process.env.REGISTRY_URL = 'http://synthetic-registry.invalid';
    let admissions = 0;
    const app = await evaluationApp(t, async sql => {
      if (sql.includes('INSERT INTO jobs') && sql.includes('INSERT INTO outbox')) { admissions++; throw new Error('Synthetic connection lost after dispatch'); }
      return result();
    });
    t.mock.method(globalThis, 'fetch', (async () => Response.json({ application: { data: {} }, suite: { data: { cases: [] } } })) as any);
    const authorization = await userToken();
    const reply = await app.inject({ method: 'POST', url: '/jobs', payload: input, headers: signedHeaders(authorization, '/jobs', input) });
    assert.equal(reply.statusCode, 503);
    assert.equal(reply.json().submissionState, 'unknown');
    assert.equal(reply.json().automaticRetry, false);
    assert.equal(reply.json().doNotResubmit, true);
    assert.equal(admissions, 1);
  });

  await t.test('an idempotency-race lookup finishing after the deadline cannot return a late replay', async t => {
    let monotonic = 0, reads = 0, admissions = 0, snapshots = 0;
    t.mock.method(performance, 'now', () => monotonic);
    process.env.REGISTRY_URL = 'http://synthetic-registry.invalid';
    const app = await evaluationApp(t, async sql => {
      if (sql.includes('SELECT id,status,request_hash')) {
        reads++;
        if (reads === 1) return result();
        // Simulate a competing request's row becoming visible only after the
        // original absolute budget has elapsed while awaiting the lookup.
        monotonic = deadlines.SUBMISSION_BUDGET_MS + 1;
        return result([{ id: jobId, status: 'queued', request_hash: common.digest(input) }]);
      }
      if (sql.includes('INSERT INTO jobs') && sql.includes('INSERT INTO outbox')) {
        admissions++;
        throw Object.assign(new Error('Synthetic concurrent idempotency conflict'), { code: '23505' });
      }
      assert.ok(sql.includes('CREATE TABLE'), 'Only schema initialization, lookup and one admission are expected');
      return result();
    });
    t.mock.method(globalThis, 'fetch', (async () => {
      snapshots++;
      return Response.json({ application: { data: {} }, suite: { data: { cases: [] } } });
    }) as any);
    const authorization = await userToken();
    const reply = await app.inject({ method: 'POST', url: '/jobs', payload: input, headers: signedHeaders(authorization, '/jobs', input) });
    assert.equal(reply.statusCode, 504);
    assert.equal(reply.json().submissionState, 'unknown');
    assert.equal(reply.json().automaticRetry, false);
    assert.equal(reads, 2);
    assert.equal(admissions, 1);
    assert.equal(snapshots, 1);
  });

  await t.test('submission status remains authenticated, read-only and scoped to the caller workspace', async t => {
    const lookups: unknown[][] = [];
    const app = await evaluationApp(t, async (sql, values) => {
      if (sql.includes('CREATE TABLE')) return result();
      assert.match(sql, /SELECT/);
      assert.match(sql, /WHERE workspace=\$1 AND idempotency_key=\$2/);
      lookups.push(values!);
      return values?.[0] === 'workspace-a' ? result([{ id: jobId, status: 'queued', requestHash: 'synthetic-hash', source: 'imported' }]) : result();
    });
    assert.equal((await app.inject({ url: '/jobs/submissions/' + key })).statusCode, 401);
    assert.equal(lookups.length, 0);
    const found = await app.inject({ url: '/jobs/submissions/' + key, headers: { authorization: await userToken() } });
    assert.equal(found.statusCode, 200);
    assert.equal(found.json().submissionState, 'accepted');
    assert.equal(found.json().id, jobId);
    const absent = await app.inject({ url: '/jobs/submissions/' + key, headers: { authorization: await userToken('workspace-b') } });
    assert.equal(absent.statusCode, 404);
    assert.equal(absent.json().definitive, false);
    assert.equal(absent.json().doNotResubmit, true);
    assert.deepEqual(lookups, [['workspace-a', key], ['workspace-b', key]]);
  });
});
