import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import assert from 'node:assert/strict';
import { execFile, fork } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes, randomUUID, createHash, createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from '../../releaseguard-v23-v6-20261015.41NMNE/ReleaseGuard/node_modules/pg/lib/index.js';
import { SignJWT } from '../../releaseguard-v23-v6-20261015.41NMNE/ReleaseGuard/node_modules/jose/dist/webapi/index.js';

const root = fileURLToPath(new URL('../', import.meta.url)), mode = process.argv[2];
assert(['baseline', 'green'].includes(mode));
const runLabel = process.argv[3] ?? 'initial'; assert(/^[a-z0-9-]+$/.test(runLabel));
const onlySupplement = process.argv[4] === 'registry-close-only';
assert(process.argv[4] === undefined || onlySupplement);
const evidencePrefix = 'http-' + mode + '-' + runLabel;
const source = mode === 'baseline' ? root + '../releaseguard-admission-rootcause-offline-20261025-r9/candidate/source' : root + 'candidate/source';
const tag = randomBytes(5).toString('hex'), label = 'releaseguard.r10.http=' + tag;
const pgName = 'rg-r10-http-pg-' + tag, mqName = 'rg-r10-http-mq-' + tag;
const password = randomBytes(24).toString('hex'), secret = randomBytes(32).toString('hex'), internal = randomBytes(32).toString('hex');
const exec = promisify(execFile), sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const docker = async args => (await exec('docker', args, { timeout: 60000, maxBuffer: 1e6,
  env: { ...process.env, POSTGRES_PASSWORD: password, RABBITMQ_DEFAULT_PASS: password } })).stdout;
const children = [], owned = [], sockets = new Set(), proxies = [], result = { mode, runLabel, at: new Date().toISOString(), source,
  scope: 'isolated local PG/Rabbit and Gateway/Evaluation/Registry only; fault injection is not a cloud root-cause proof', tests: [], skipped: [], attempts: [], startup: [], cloudActions: 0, modelCalls: 0, retries: 0 };
let admin, dbUrl, commonEnv, registry, evaluation, gateway, token, workspace, appId, suiteId, registryProxy, evaluationProxy;
const sha = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : value && typeof value === 'object'
  ? '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, x]) => JSON.stringify(key) + ':' + canonical(x)).join(',') + '}' : JSON.stringify(value);
const wait = async (predicate, timeoutMs = 7000) => {
  const end = performance.now() + timeoutMs;
  while (performance.now() < end) { if (await predicate()) return; await sleep(10); }
  throw Error('Controlled HTTP boundary not reached');
};
const hasCredential = text => [password, secret, internal, token].filter(Boolean).some(value => text.includes(value));
async function captureContainer(own, phase) {
  const info = JSON.parse(await docker(['inspect', own.id ?? own.name]))[0];
  assert.equal(info.Config.Labels['releaseguard.r10.http'], tag); if (own.id) assert.equal(info.Id, own.id);
  const stamp = { at: new Date().toISOString(), name: own.name, id: info.Id, phase, state: info.State };
  const logs = await exec('docker', ['logs', info.Id], { timeout: 10000, maxBuffer: 1e6 });
  for (const channel of ['stdout', 'stderr']) {
    const raw = logs[channel] ?? '', basename = evidencePrefix + '-' + (own.name === mqName ? 'mq' : 'pg') + '-' + phase + '.' + channel + '.txt';
    const matched = hasCredential(raw);
    stamp[channel] = { bytes: Buffer.byteLength(raw), sha256: sha(raw), rawLogSaved: !matched, credentialMatch: matched, path: matched ? null : basename };
    if (!matched) await fs.writeFile(root + 'evidence/' + basename, raw, { flag: 'wx', mode: 0o600 });
  }
  assert(!hasCredential(JSON.stringify(stamp)), 'Credential must not enter container state evidence');
  result.startup.push(stamp); return { info, logs: logs.stdout + '\n' + logs.stderr };
}
async function tcpReady(port) {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port });
    let settled = false;
    const finish = value => { if (settled) return; settled = true; socket.destroy(); resolve(value); };
    socket.once('connect', () => finish(true)); socket.once('error', () => finish(false)); socket.setTimeout(500, () => finish(false));
  });
}
async function rabbitReady(own, port) {
  const samples = []; let lastLogs = '';
  for (let i = 0; i < 60; i++) {
    const info = JSON.parse(await docker(['inspect', own.id]))[0]; assert.equal(info.Config.Labels['releaseguard.r10.http'], tag);
    const logs = await exec('docker', ['logs', own.id], { timeout: 10000, maxBuffer: 1e6 });
    lastLogs = logs.stdout + '\n' + logs.stderr;
    const announced = /Server startup complete/i.test(lastLogs), listening = announced && await tcpReady(port);
    samples.push({ at: new Date().toISOString(), running: info.State.Running, status: info.State.Status, exitCode: info.State.ExitCode, oomKilled: info.State.OOMKilled, startupCompleteLog: announced, tcpReady: listening });
    if (listening && info.State.Running) { result.rabbitReadiness = { intervalMs: 500, samples, method: 'container State plus Server startup complete log plus loopback TCP; no Erlang diagnostic process' }; await captureContainer(own, 'startup'); return; }
    if (!info.State.Running) { result.rabbitReadiness = { intervalMs: 500, samples }; await captureContainer(own, 'startup-failure'); throw Error('Temporary RabbitMQ exited before startup readiness'); }
    await sleep(500);
  }
  result.rabbitReadiness = { intervalMs: 500, samples }; await captureContainer(own, 'startup-timeout'); throw Error('Temporary RabbitMQ startup readiness timeout');
}
async function command(child, action) {
  const id = randomUUID(); child.p.send({ id, action });
  await wait(() => child.events.some(event => event.id === id));
  const event = child.events.find(event => event.id === id);
  if (event.event === 'control_error') throw Error(event.message);
  return event;
}
async function start(role, overrides = {}) {
  const child = { role, events: [], stdout: '', stderr: '', exit: null, signal: null };
  child.p = fork(root + 'tests/http-chain-bootstrap.mjs', [], { execPath: process.execPath, silent: true,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, TZ: 'UTC' } });
  children.push(child);
  child.p.on('message', event => child.events.push({ observedAtMs: performance.now(), ...event }));
  child.p.stdout.on('data', bytes => child.stdout += bytes); child.p.stderr.on('data', bytes => child.stderr += bytes);
  child.p.on('exit', (code, signal) => { child.exit = code; child.signal = signal; });
  child.p.send({ source, role, env: { ...commonEnv, ...overrides } });
  await wait(() => child.events.some(event => event.event === 'ready'), 25000);
  child.port = child.events.find(event => event.event === 'ready').port;
  return child;
}
async function proxyFor(targetPort) {
  const state = { gateNext: false, delayNextMs: 0, held: null, gateReached: 0, received: [], droppedResponses: 0, propagateClose: true };
  const server = http.createServer((req, reply) => {
    let body = ''; req.setEncoding('utf8'); req.on('data', bytes => body += bytes);
    req.on('end', () => {
      const delay = state.delayNextMs; state.delayNextMs = 0;
      const gate = state.gateNext; state.gateNext = false;
      state.received.push({ keySha256: typeof req.headers['idempotency-key'] === 'string' ? sha(req.headers['idempotency-key']) : null,
        atMs: performance.now(), path: req.url, delayedMs: delay, gated: gate });
      const dispatch = () => {
        if (reply.destroyed && state.propagateClose) return;
        const upstream = http.request({ hostname: '127.0.0.1', port: targetPort, path: req.url, method: req.method, headers: req.headers }, response => {
          const chunks = []; response.on('data', bytes => chunks.push(bytes));
          response.on('end', () => {
            const forward = () => {
              if (!reply.destroyed) { reply.writeHead(response.statusCode, response.headers); reply.end(Buffer.concat(chunks)); }
              else state.droppedResponses++;
            };
            if (gate) { state.gateReached++; state.held = forward; } else forward();
          });
        });
        reply.once('close', () => { if (!reply.writableFinished && state.propagateClose) upstream.destroy(); });
        upstream.on('error', () => { if (!reply.destroyed) { reply.writeHead(502); reply.end('{}'); } });
        upstream.end(body);
      };
      if (delay) setTimeout(dispatch, delay); else dispatch();
    });
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); proxies.push(server);
  return { server, state, port: server.address().port, release() { const fn = state.held; state.held = null; fn?.(); } };
}
function once(port, path, body, key, extra = {}) {
  let request; const began = performance.now();
  const promise = new Promise(resolve => {
    const headers = { authorization: 'Bearer ' + token, 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}), ...extra };
    request = http.request({ hostname: '127.0.0.1', port, path, method: body === undefined ? 'GET' : 'POST', headers }, response => {
      const chunks = []; response.on('data', bytes => chunks.push(bytes));
      response.on('end', () => { const raw = Buffer.concat(chunks).toString('utf8'); let json; try { json = JSON.parse(raw); } catch {} resolve({ status: response.statusCode, raw, json, elapsedMs: performance.now() - began }); });
      response.on('aborted', () => resolve({ status: null, error: 'incomplete_response', elapsedMs: performance.now() - began }));
    });
    request.on('error', error => resolve({ status: null, error: error.code ?? error.message, elapsedMs: performance.now() - began }));
    request.setTimeout(20000, () => request.destroy(Error('test-observer-timeout')));
    request.end(body === undefined ? undefined : JSON.stringify(body));
  });
  return { promise, destroy() { request.destroy(Error('controlled-client-close')); } };
}
const input = name => ({ appId, suiteId, candidate: 'http-' + mode + '-' + name + '-' + tag,
  commitRef: 'isolated-http-r10', source: 'replay', promptVersion: 'v1', scenario: 'passing' });
const recordAttempt = (scenario, key) => result.attempts.push({ scenario, keySha256: sha(key), sent: 1, retries: 0 });
async function counts(key) {
  return (await admin.query("SELECT (SELECT count(*) FROM jobs WHERE workspace=$1 AND idempotency_key=$2) jobs,(SELECT count(*) FROM outbox WHERE job_id IN(SELECT id FROM jobs WHERE workspace=$1 AND idempotency_key=$2)) outbox,(SELECT coalesce(sum(count),0) FROM admission_limits WHERE key LIKE $3) reservations", [workspace, key, workspace + ':%'])).rows[0];
}
async function test(name, fn) {
  if (onlySupplement && name !== 'active Registry GET close propagates across all three HTTP services before read SQL dispatch') { result.skipped.push(name); return; }
  try { const actual = await fn(); result.tests.push({ name, passed: true, ...actual }); }
  catch (error) { result.tests.push({ name, passed: false, error: error.message, actual: error.actual ?? null }); }
}
function check(ok, message, actual) { if (!ok) { const error = Error(message); error.actual = actual; throw error; } }
function signedBudget(body, key, traceId, startedAtMs) {
  const claims = { v: 1, purpose: 'releaseguard.submission-deadline', iss: 'releaseguard-gateway', aud: 'evaluation', caller: 'gateway',
    method: 'POST', route: '/jobs', traceId, startedAtMs, deadlineAtMs: startedAtMs + 10000,
    keySha256: sha(key), bodySha256: sha(canonical(body)), authorizationSha256: sha('Bearer ' + token) };
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return payload + '.' + createHmac('sha256', internal).update(payload).digest('base64url');
}
try {
  for (const spec of [{ name: pgName, image: 'postgres:16-alpine', args: ['--tmpfs', '/var/lib/postgresql/data:rw', '-e', 'POSTGRES_USER=rg_test', '-e', 'POSTGRES_PASSWORD', '-p', '127.0.0.1::5432'] },
    { name: mqName, image: 'rabbitmq:4-management-alpine', args: ['--tmpfs', '/var/lib/rabbitmq:rw,uid=999,gid=999', '-e', 'RABBITMQ_DEFAULT_USER=rg_test', '-e', 'RABBITMQ_DEFAULT_PASS', '-p', '127.0.0.1::5672'] }]) {
    owned.push({ name: spec.name, id: null });
    // Keep the stopped test container long enough to retain failure State/logs.
    // Cleanup later validates its unique ID+label before stopping/removing it.
    const id = (await docker(['run', '-d', '--pull=never', '--name', spec.name, '--label', label, ...spec.args, spec.image])).trim(); owned.at(-1).id = id;
  }
  const inspect = async name => JSON.parse(await docker(['inspect', name]))[0];
  const pgInfo = await inspect(pgName), mqInfo = await inspect(mqName);
  for (const info of [pgInfo, mqInfo]) assert.equal(info.Config.Labels['releaseguard.r10.http'], tag);
  const pgMap = pgInfo.NetworkSettings.Ports['5432/tcp'][0], mqMap = mqInfo.NetworkSettings.Ports['5672/tcp'][0];
  assert.equal(pgMap.HostIp, '127.0.0.1'); assert.equal(mqMap.HostIp, '127.0.0.1');
  dbUrl = 'postgres://rg_test:' + password + '@127.0.0.1:' + pgMap.HostPort + '/postgres';
  await wait(async () => { const c = new pg.Client({ connectionString: dbUrl }); try { await c.connect(); await c.end(); return true; } catch { await c.end().catch(() => {}); return false; } }, 20000);
  admin = new pg.Client({ connectionString: dbUrl }); await admin.connect();
  commonEnv = { DATABASE_URL: dbUrl, AMQP_URL: 'amqp://rg_test:' + password + '@127.0.0.1:' + mqMap.HostPort,
    AUTH_MODE: 'dev', ALLOW_DEV_AUTH: 'true', AUTH_SECRET: secret, INTERNAL_SECRET: internal,
    PUBLIC_ORIGIN: 'http://localhost:5189', RUNNER_ORIGINS: 'http://support:8080', MAX_JOBS_PER_MINUTE: '1000',
    SUBMISSION_CLOCK_SKEW_BOUND_MS: '0', ALLOW_REAL_MODEL: 'false', MODEL_API_KEY: '', MODEL_API_URL: '', MODEL_ID: '' };
  registry = await start('registry'); registryProxy = await proxyFor(registry.port);
  await rabbitReady(owned.find(own => own.name === mqName), Number(mqMap.HostPort));
  evaluation = await start('evaluation', { REGISTRY_URL: 'http://127.0.0.1:' + registryProxy.port });
  evaluationProxy = await proxyFor(evaluation.port);
  gateway = await start('gateway', { REGISTRY_URL: 'http://127.0.0.1:' + registry.port, EVALUATION_URL: 'http://127.0.0.1:' + evaluationProxy.port });
  workspace = 'http-r10-' + mode + '-' + tag;
  token = await new SignJWT({ sub: 'http-contributor', workspace, role: 'contributor', service: false }).setProtectedHeader({ alg: 'HS256' }).setIssuer('releaseguard-local').setAudience('releaseguard').setIssuedAt().setExpirationTime('10m').sign(new TextEncoder().encode(secret));
  const fixture = JSON.parse(await fs.readFile(root + '../releaseguard-v23-v6-20261015.41NMNE/ReleaseGuard/public/demo-fixtures.json'));
  const app = await once(gateway.port, '/api/v2/applications', fixture.application).promise;
  const suite = await once(gateway.port, '/api/v2/suites', fixture.suite).promise;
  assert.equal(app.status, 201); assert.equal(suite.status, 201); appId = app.json.id; suiteId = suite.json.id;

  await test('normal one-shot Gateway submission remains202 and retains job/outbox', async () => {
    const key = 'r10_normal_' + tag; recordAttempt('normal', key);
    const wire = await once(gateway.port, '/api/v2/jobs', input('normal'), key).promise, actual = { wire, counts: await counts(key) };
    check(wire.status === 202 && Number(actual.counts.jobs) === 1 && Number(actual.counts.outbox) === 1, 'Normal submission failed', actual); return actual;
  });
  await test('actual client close propagates Gateway→Evaluation; pool-queued admission dispatches no SQL', async () => {
    const key = 'r10_cancel_' + tag, hash = sha(key), before = await counts(key), marker = evaluation.events.length;
    registryProxy.state.gateNext = true; const reached = registryProxy.state.gateReached;
    recordAttempt('pool-close', key); const call = once(gateway.port, '/api/v2/jobs', input('cancel'), key);
    await wait(() => registryProxy.state.gateReached > reached);
    let wire;
    try {
      await command(evaluation, 'hold_pool'); registryProxy.release();
      await wait(() => evaluation.events.slice(marker).some(e => e.event === 'admission_pool_requested'));
      await wait(async () => (await command(evaluation, 'pool_stats')).waiting > 0);
      call.destroy();
      await wait(() => gateway.events.some(e => e.event === 'http_close' && e.keySha256 === hash && !e.writableFinished)
        && evaluation.events.some(e => e.event === 'http_close' && e.keySha256 === hash && !e.writableFinished));
      wire = await call.promise;
    } finally { registryProxy.release(); await command(evaluation, 'release_pool'); }
    await wait(async () => (await command(evaluation, 'pool_stats')).waiting === 0); await sleep(100);
    const actual = { wire, before, counts: await counts(key), closesObserved: ['gateway', 'evaluation'], sqlDispatches: evaluation.events.slice(marker).filter(e => e.event === 'admission_sql_dispatch').length };
    check(wire.status === null && Number(actual.counts.jobs) === 0 && Number(actual.counts.outbox) === 0 && actual.counts.reservations === before.reservations && actual.sqlDispatches === 0, 'Closed request mutated state', actual); return actual;
  });
  await test('SQL already dispatched remains wire-unknown after actual close; no automatic resubmission', async () => {
    const key = 'r10_after_' + tag, hash = sha(key), marker = evaluation.events.length;
    const rateKey = workspace + ':http-contributor:' + Math.floor(Date.now() / 60000);
    await admin.query("INSERT INTO admission_limits VALUES($1,0,now()+interval '2 minutes') ON CONFLICT(key) DO NOTHING", [rateKey]);
    await admin.query('BEGIN'); await admin.query('SELECT key FROM admission_limits WHERE key=$1 FOR UPDATE', [rateKey]);
    recordAttempt('close-after-dispatch', key); const call = once(gateway.port, '/api/v2/jobs', input('after'), key);
    try {
      await wait(() => evaluation.events.slice(marker).some(e => e.event === 'admission_sql_dispatch'));
      await wait(async () => (await admin.query("SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%INSERT INTO admission_limits%'")).rowCount > 0);
      call.destroy(); await wait(() => evaluation.events.some(e => e.event === 'http_close' && e.keySha256 === hash && !e.writableFinished));
      await admin.query('COMMIT');
    } finally { await admin.query('ROLLBACK').catch(() => {}); }
    const wire = await call.promise; await wait(async () => Number((await counts(key)).jobs) === 1);
    const actual = { wire, counts: await counts(key), sqlDispatches: evaluation.events.slice(marker).filter(e => e.event === 'admission_sql_dispatch').length, postAttempts: 1 };
    check(wire.status === null && Number(actual.counts.jobs) === 1 && Number(actual.counts.outbox) === 1 && actual.sqlDispatches === 1, 'After-dispatch semantics changed', actual); return actual;
  });
  await test('independently signed expired deadline cannot dispatch a job with connection still open', async () => {
    const key = 'r10_expired_' + tag, body = input('expired'), traceId = randomUUID(); recordAttempt('expired-budget', key);
    const wire = await once(evaluation.port, '/jobs', body, key, { 'x-rg-trace-id': traceId, 'x-rg-submission-budget': signedBudget(body, key, traceId, Date.now() - 11000) }).promise;
    const actual = { wire, counts: await counts(key) }; check(wire.status === 504 && Number(actual.counts.jobs) === 0, 'Expired deadline accepted or wrong response', actual); return actual;
  });
  await test('tampered deadline cannot fall back to legacy direct Evaluation', async () => {
    const key = 'r10_tamper_' + tag, body = input('tamper'), traceId = randomUUID(); recordAttempt('tampered-budget', key);
    const original = signedBudget(body, key, traceId, Date.now()), [payload, mac] = original.split('.'), claims = JSON.parse(Buffer.from(payload, 'base64url'));
    claims.deadlineAtMs += 1000; const tampered = Buffer.from(JSON.stringify(claims)).toString('base64url') + '.' + mac;
    const wire = await once(evaluation.port, '/jobs', body, key, { 'x-rg-trace-id': traceId, 'x-rg-submission-budget': tampered }).promise;
    const actual = { wire, counts: await counts(key) }; check(wire.status === 401 && Number(actual.counts.jobs) === 0, 'Tampered deadline accepted or fell back', actual); return actual;
  });
  await test('10s original wire timeout plus injected9200+1100ms cannot become late pre-dispatch commit', async () => {
    const key = 'r10_late_' + tag, before = await counts(key); recordAttempt('late-budget-with-delayed-close', key);
    evaluationProxy.state.delayNextMs = 9200; evaluationProxy.state.propagateClose = false;
    registryProxy.state.gateNext = true; const reached = registryProxy.state.gateReached;
    const call = once(gateway.port, '/api/v2/jobs', input('late'), key);
    let wire;
    try { await wait(() => registryProxy.state.gateReached > reached, 15000); await sleep(1100); registryProxy.release(); wire = await call.promise; await sleep(200); }
    finally { registryProxy.release(); evaluationProxy.state.propagateClose = true; }
    const actual = { wire, counts: await counts(key), before, injectedEvaluationForwardDelayMs: 9200, injectedRegistryHoldMs: 1100, deliberatelySuppressedGatewayToEvaluationClose: true };
    check(wire.status === 504 && Number(actual.counts.jobs) === 0 && actual.counts.reservations === before.reservations, 'Budget expired but a new job was admitted', actual); return actual;
  });
  await test('actual Registry pool acquisition delay is distinct from SQL round-trip', async () => {
    const key = 'r10_registry_' + tag; await command(registry, 'hold_pool'); recordAttempt('registry-pool-wait', key);
    const call = once(gateway.port, '/api/v2/jobs', input('registry'), key);
    try { await wait(async () => (await command(registry, 'pool_stats')).waiting > 0); await sleep(150); }
    finally { await command(registry, 'release_pool'); }
    const wire = await call.promise; await sleep(50);
    const rows = registry.stdout.trim().split('\n').map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(row => row?.event === 'submission_registry_timing');
    const span = rows.flatMap(row => row.databaseSpans ?? []).find(s => s.operation === 'registry_application' && s.poolWaitMs >= 100);
    const actual = { wire, registrySpan: span ?? null, counts: await counts(key) };
    check(wire.status === 202 && span?.databaseRoundTripMs >= 0 && span.queryDispatchedMs >= span.acquiredMs, 'Registry timing not separated', actual); return actual;
  });
  if (onlySupplement) await test('active Registry GET close propagates across all three HTTP services before read SQL dispatch', async () => {
    const key = 'r10_registryclose_' + tag, hash = sha(key), before = await counts(key), registryMarker = registry.events.length;
    await command(registry, 'hold_pool'); recordAttempt('active-registry-close', key);
    const call = once(gateway.port, '/api/v2/jobs', input('registry-close'), key);
    let wire, traceId;
    try {
      await wait(() => registry.events.slice(registryMarker).some(event => event.event === 'http_request' && event.kind === 'registry_snapshot' && event.keySha256 === hash));
      traceId = registry.events.slice(registryMarker).find(event => event.event === 'http_request' && event.keySha256 === hash).traceId;
      assert.equal(typeof traceId, 'string');
      await wait(async () => (await command(registry, 'pool_stats')).waiting > 0);
      call.destroy();
      await wait(() => [gateway, evaluation, registry].every(child => child.events.some(event => event.event === 'http_close' && event.keySha256 === hash && !event.writableFinished)));
      wire = await call.promise;
    } finally { await command(registry, 'release_pool'); }
    await wait(async () => (await command(registry, 'pool_stats')).waiting === 0); await sleep(100);
    const rows = registry.stdout.trim().split('\n').map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(row => row?.event === 'submission_registry_timing' && row.traceId === traceId);
    const registrySpan = rows.flatMap(row => row.databaseSpans ?? []).find(span => span.operation === 'registry_application');
    const closes = [gateway, evaluation, registry].map(child => ({ role: child.role, ...child.events.find(event => event.event === 'http_close' && event.keySha256 === hash && !event.writableFinished) }));
    const actual = { wire, traceId, keySha256: hash, before, counts: await counts(key), closes, registrySpan: registrySpan ?? null,
      registryApplicationSqlDispatches: registry.events.slice(registryMarker).filter(event => event.event === 'registry_application_sql_dispatch').length };
    check(wire.status === null && Number(actual.counts.jobs) === 0 && Number(actual.counts.outbox) === 0 && actual.counts.reservations === before.reservations
      && actual.registryApplicationSqlDispatches === 0 && registrySpan?.queryDispatchedMs === null && registrySpan?.outcome === 'cancelled_before_dispatch'
      && closes.slice(1).every(event => event.traceId === traceId), 'Active Registry closure did not cancel before read dispatch', actual);
    return actual;
  });
} catch (error) { result.fatal = { name: error.name, message: error.message }; }
finally {
  // Release test holds before stopping only our own application processes.
  for (const child of children) if (child.p.exitCode === null && child.p.signalCode === null) {
    await command(child, 'release_pool').catch(() => {}); child.p.kill('SIGTERM');
    try { await wait(() => child.exit !== null || child.signal !== null, 5000); } catch { child.p.kill('SIGKILL'); await wait(() => child.exit !== null || child.signal !== null, 5000).catch(() => {}); }
  }
  for (const proxy of proxies) proxy.closeAllConnections(); for (const socket of sockets) socket.destroy();
  for (const proxy of proxies) await new Promise(resolve => proxy.close(resolve));
  await admin?.query('ROLLBACK').catch(() => {}); await admin?.end().catch(() => {});
  result.processes = children.map(child => ({ role: child.role, pid: child.p.pid, exit: child.exit, signal: child.signal }));
  result.cleanup = [];
  for (const own of owned.reverse()) {
    const row = { ...own, removed: false };
    try {
      const info = JSON.parse(await docker(['inspect', own.name]))[0]; assert.equal(info.Config.Labels['releaseguard.r10.http'], tag);
      if (own.id) assert.equal(info.Id, own.id); row.id = info.Id;
      try { await captureContainer(own, 'final'); } catch (error) { row.diagnosticCaptureError = error.message; }
      await docker(['stop', '--timeout', '3', own.name]);
      await docker(['rm', info.Id]);
      const absent = async identity => {
        try { const after = JSON.parse(await docker(['inspect', identity])); return Array.isArray(after) && after.length === 0; }
        catch (error) { if (/no such (object|container)/i.test(error.stderr ?? error.message)) return true; throw error; }
      };
      await wait(async () => (await absent(own.name)) && (await absent(info.Id)), 5000);
      row.nameAbsent = await absent(own.name); row.idAbsent = await absent(info.Id);
      row.removed = row.nameAbsent && row.idAbsent;
    } catch (error) { row.error = error.message; }
    result.cleanup.push(row);
  }
  try { result.remainingLabelledContainers = (await docker(['ps', '-aq', '--filter', 'label=' + label])).trim().split('\n').filter(Boolean); } catch (error) { result.cleanupReadbackError = error.message; }
  for (const child of children) {
    const combined = child.stdout + child.stderr;
    assert(![password, secret, internal, token].filter(Boolean).some(value => combined.includes(value)), 'Credentials cannot enter persisted child logs');
    await fs.writeFile(root + 'evidence/' + evidencePrefix + '-' + child.role + '-' + child.p.pid + '.stdout.txt', child.stdout, { flag: 'wx', mode: 0o600 });
    await fs.writeFile(root + 'evidence/' + evidencePrefix + '-' + child.role + '-' + child.p.pid + '.stderr.txt', child.stderr, { flag: 'wx', mode: 0o600 });
    await fs.writeFile(root + 'evidence/' + evidencePrefix + '-' + child.role + '-' + child.p.pid + '.events.json', JSON.stringify(child.events, null, 2), { flag: 'wx', mode: 0o600 });
  }
  result.passed = result.tests.filter(test => test.passed).length; result.failed = result.tests.filter(test => !test.passed).length;
  result.status = result.fatal ? 'INFRASTRUCTURE_FAILURE' : result.failed ? 'REGRESSION_FAILED' : 'REGRESSIONS_PASSED';
  await fs.writeFile(root + 'evidence/' + evidencePrefix + '-result.json', JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ mode, status: result.status, passed: result.passed, failed: result.failed, cleanup: result.cleanup, remainingLabelledContainers: result.remainingLabelledContainers, tests: result.tests.map(test => ({ name: test.name, passed: test.passed, error: test.error })) }));
  if (result.fatal || result.failed || result.cleanup.some(row => !row.removed) || result.remainingLabelledContainers?.length || result.processes.some(child => child.exit === null && child.signal === null)) process.exitCode = 1;
}
