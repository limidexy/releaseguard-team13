// Bounded local regression only: one real Gateway request; no DB/cloud/5193.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const mode = process.env.RG_DEADLINE_WIRE_MODE ?? 'green';
assert(['red', 'green'].includes(mode));
const root = fileURLToPath(new URL('../', import.meta.url));
const evidence = root + 'evidence/';
await fs.mkdir(evidence, { recursive: true });
await fs.writeFile(evidence + 'deadline-wire-' + mode + '.once', JSON.stringify({ at: new Date().toISOString(), localRequestMaximum: 1, retries: 0 }) + '\n', { flag: 'wx' });
const source = mode === 'red'
  ? fileURLToPath(new URL('../../releaseguard-admission-rootcause-offline-20261025-r9/candidate/source/', import.meta.url))
  : root + 'candidate/source/';
const secret = 'synthetic-deadline-test-secret-not-a-real-credential-20261025';
const syntheticAuthorization = 'Bearer synthetic-wire-regression-not-a-user-token';
process.env.AUTH_MODE = 'dev';
process.env.ALLOW_DEV_AUTH = 'true';
process.env.AUTH_SECRET = 'synthetic-local-auth-test-secret-not-used-for-login';
process.env.INTERNAL_SECRET = secret;
process.env.SERVICE_ROLE = 'gateway';
process.env.DATABASE_URL = 'postgres://unused:unused@127.0.0.1:1/never_connected';

const hash = value => createHash('sha256').update(value).digest('hex');
// Intentionally independent of the production common.digest implementation.
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object' ? '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}'
  : JSON.stringify(value);
const events = [];
after(async () => {
  await fs.writeFile(evidence + 'deadline-wire-' + mode + '-RESULT.json', JSON.stringify({ at: new Date().toISOString(), mode,
    source, events, cloud: 0, databaseQueries: 0, models: 0, docker: 0, site5193: false,
    retries: 0, syntheticSecretsOnly: true, headerOrAuthorizationSaved: false }, null, 2) + '\n', { flag: 'wx' });
});

test('real Gateway replaces a forged client budget with a signed request-bound deadline', async t => {
  const event = { test: 'real_gateway_trusted_header', requests: 0, status: 'STARTED', trustedHeaderObserved: false,
    signatureManuallyVerified: false, correctBindings: false, logsExcludeHeader: null, cleanup: null };
  events.push(event);
  const records = [], sockets = new Set(), logLines = [];
  const upstream = http.createServer((req, res) => {
    event.requests++;
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { body += chunk; });
    req.once('end', () => {
      records.push({ header: req.headers['x-rg-submission-budget'], traceId: req.headers['x-rg-trace-id'],
        authorization: req.headers.authorization, key: req.headers['idempotency-key'], body });
      res.writeHead(202, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ synthetic: true }));
    });
  });
  upstream.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  const Fastify = (await import(pathToFileURL(source + 'node_modules/fastify/fastify.js').href)).default;
  const { gateway } = await import(pathToFileURL(source + 'dist/src/gateway.js').href);
  const { pool } = await import(pathToFileURL(source + 'dist/src/common.js').href);
  const app = Fastify({ logger: { level: 'info', stream: { write: chunk => { logLines.push(String(chunk)); } } } });
  t.after(async () => {
    await app.close();
    await pool.end();
    const closed = [...sockets].map(socket => new Promise(resolve => socket.once('close', resolve)));
    for (const socket of sockets) socket.destroy();
    upstream.closeAllConnections();
    if (upstream.listening) await new Promise(resolve => upstream.close(resolve));
    await Promise.all(closed);
    event.cleanup = { serverListening: upstream.listening, openTrackedSockets: sockets.size, gatewayClosed: true, poolEndedWithoutQuery: true };
    assert.equal(upstream.listening, false);
    assert.equal(sockets.size, 0);
  });
  try {
    await new Promise((resolve, reject) => { upstream.once('error', reject); upstream.listen(0, '127.0.0.1', resolve); });
    const address = upstream.address();
    assert(address && address.address === '127.0.0.1' && address.port !== 5193);
    process.env.EVALUATION_URL = 'http://127.0.0.1:' + address.port;
    await gateway(app);
    const payload = { source: 'replay', candidate: 'synthetic-deadline-wire-local-only', value: { b: 2, a: 1 } };
    const key = 'deadline_wire_' + mode + '_unique';
    const forged = 'client-controlled-forged-budget-must-not-be-trusted';
    const before = Date.now();
    const response = await app.inject({ method: 'POST', url: '/api/v2/jobs', payload,
      headers: { authorization: syntheticAuthorization, 'idempotency-key': key, 'x-rg-submission-budget': forged } });
    const afterWall = Date.now();
    assert.equal(response.statusCode, 202);
    assert.equal(event.requests, 1, 'Exactly one upstream request; no retry');
    const actual = records[0];
    event.trustedHeaderObserved = typeof actual.header === 'string';
    assert.equal(typeof actual.header, 'string', 'Gateway must generate a trusted deadline header, not omit it');
    assert(actual.header !== forged, 'Gateway must replace the client-supplied budget');
    const parts = actual.header.split('.');
    assert.equal(parts.length, 2, 'Expected payloadB64.signatureB64');
    const signature = Buffer.from(parts[1], 'base64url');
    const expectedSignature = createHmac('sha256', secret).update(parts[0]).digest();
    assert(signature.length === expectedSignature.length && timingSafeEqual(signature, expectedSignature), 'Manually verified HMAC must match');
    event.signatureManuallyVerified = true;
    const claims = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const literalExpected = { v: 1, purpose: 'releaseguard.submission-deadline', iss: 'releaseguard-gateway', aud: 'evaluation', caller: 'gateway',
      method: 'POST', route: '/jobs', traceId: actual.traceId, keySha256: hash(key),
      bodySha256: hash(canonical(payload)), authorizationSha256: hash(syntheticAuthorization) };
    for (const [field, expected] of Object.entries(literalExpected)) assert.deepEqual(claims[field], expected, 'Signed binding mismatch: ' + field);
    assert(Number.isSafeInteger(claims.startedAtMs) && claims.startedAtMs >= before && claims.startedAtMs <= afterWall, 'Window starts during the actual Gateway request');
    assert.equal(claims.deadlineAtMs, claims.startedAtMs + 10000, 'Original absolute budget must remain10000ms');
    event.correctBindings = true;
    const logs = logLines.join('');
    event.logsExcludeHeader = !logs.includes(actual.header) && !logs.includes(syntheticAuthorization) && !logs.includes(secret) && !logs.includes(forged);
    assert(event.logsExcludeHeader, 'Logs must exclude the full budget header and synthetic bearer/secret');
    event.status = 'PASS';
  } catch (error) {
    event.status = 'FAIL';
    event.failure = { name: error.name, message: error.message.split('\n')[0] };
    throw error;
  }
});

if (mode === 'green') {
  const deadline = await import(pathToFileURL(source + 'dist/src/submission-deadline.js').href);
  const { createSubmissionDeadline, receiveSubmissionDeadline, configuredClockSkewBound,
    InvalidSubmissionDeadlineError, SubmissionDeadlineConfigurationError } = deadline;
  const { databaseQuery } = await import(pathToFileURL(source + 'dist/src/database-evidence.js').href);
  const WALL = 1800000000000;
  const binding = Object.freeze({ traceId: '11111111-1111-4111-8111-111111111111', method: 'POST', route: '/jobs',
    keySha256: 'a'.repeat(64), bodySha256: 'b'.repeat(64), authorizationSha256: 'c'.repeat(64) });
  const literalClaims = Object.freeze({ v: 1, purpose: 'releaseguard.submission-deadline', iss: 'releaseguard-gateway',
    aud: 'evaluation', caller: 'gateway', ...binding, startedAtMs: WALL - 200, deadlineAtMs: WALL + 9800 });
  const manualSign = (claims, key = secret) => {
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    return payload + '.' + createHmac('sha256', key).update(payload).digest('base64url');
  };
  const clock = (wall = WALL, mono = 500) => ({ wallNow: () => wall, monotonicNow: () => mono });
  const invalid = (header, bound = binding, target = 'evaluation') => assert.throws(
    () => receiveSubmissionDeadline(header, bound, secret, 100, clock(), target), InvalidSubmissionDeadlineError);
  const pure = (name, fn) => test(name, async t => {
    const event = { test: name, status: 'STARTED', actualHttpRequests: 0, actualDbQueries: 0 };
    events.push(event);
    try { await fn(t); event.status = 'PASS'; }
    catch (error) { event.status = 'FAIL'; event.failure = { name: error.name, message: error.message.split('\n')[0] }; throw error; }
  });

  pure('independent hand-signed literal evaluation claims are accepted with conservative skew deduction', t => {
    const receiver = receiveSubmissionDeadline(manualSign(literalClaims), binding, secret, 100, clock());
    t.after(receiver.dispose);
    assert.equal(receiver.startedAtMs, WALL - 200);
    assert.equal(receiver.deadlineAtMs, WALL + 9800);
    assert.equal(receiver.remainingMs(), 9700);
    assert.equal(receiver.expired(), false);
    assert.equal(receiver.signal.aborted, false);
    assert.deepEqual(receiver.publicState(), { mode: 'authenticated_shared_internal_context', originalBudgetMs: 10000,
      clockSkewBoundMs: 100, receivedRemainingMs: 9700, remainingMs: 9700 });
  });
  pure('creator claims and HMAC match an independent literal vector', () => {
    const signed = createSubmissionDeadline(binding, secret, WALL - 200);
    const [payload, signature] = signed.split('.');
    assert.deepEqual(JSON.parse(Buffer.from(payload, 'base64url').toString()), literalClaims);
    assert.equal(signature, createHmac('sha256', secret).update(payload).digest('base64url'));
  });
  pure('canonical body test vector is independent and common digest preserves key-order equivalence', async () => {
    const { digest } = await import(pathToFileURL(source + 'dist/src/common.js').href);
    const expectedLiteral = '{"a":1,"b":[2,{"a":3,"z":4}]}';
    const input = { b: [2, { z: 4, a: 3 }], a: 1 };
    assert.equal(canonical(input), expectedLiteral);
    assert.equal(digest(input), hash(expectedLiteral));
  });

  const changedBindings = { traceId: '22222222-2222-4222-8222-222222222222', method: 'GET', route: '/other',
    keySha256: 'd'.repeat(64), bodySha256: 'e'.repeat(64), authorizationSha256: 'f'.repeat(64) };
  for (const [field, value] of Object.entries(changedBindings)) {
    pure('reject signed claim with altered ' + field, () => invalid(manualSign({ ...literalClaims, [field]: value })));
    pure('reject expected request binding with altered ' + field, () => invalid(manualSign(literalClaims), { ...binding, [field]: value }));
  }
  for (const [field, value] of Object.entries({ v: 2, purpose: 'some-other-purpose', iss: 'other-issuer', aud: 'registry', caller: 'evaluation' })) {
    pure('reject signed wrong protocol claim ' + field, () => invalid(manualSign({ ...literalClaims, [field]: value })));
  }
  pure('reject changed signature', () => {
    const [payload] = manualSign(literalClaims).split('.');
    invalid(payload + '.' + Buffer.alloc(32, 1).toString('base64url'));
  });
  pure('reject claims signed with a different synthetic secret', () => invalid(manualSign(literalClaims, 'another-synthetic-deadline-secret-not-a-credential')));
  pure('reject unsigned payload modification without re-signing', () => {
    const original = manualSign(literalClaims).split('.');
    const changedPayload = Buffer.from(JSON.stringify({ ...literalClaims, deadlineAtMs: WALL + 19800 })).toString('base64url');
    invalid(changedPayload + '.' + original[1]);
  });
  const malformedHeaders = [undefined, null, '', 123, ['not-a-string'], 'one-part', 'a.b.c', '*.*', 'a.', '.b', 'x'.repeat(6001)];
  for (let index = 0; index < malformedHeaders.length; index++) pure('reject malformed/missing header vector ' + index, () => invalid(malformedHeaders[index]));
  for (const [label, claims] of [
    ['started-as-string', { ...literalClaims, startedAtMs: String(literalClaims.startedAtMs) }],
    ['started-fraction', { ...literalClaims, startedAtMs: WALL - 199.5, deadlineAtMs: WALL + 9800.5 }],
    ['started-zero', { ...literalClaims, startedAtMs: 0, deadlineAtMs: 10000 }],
    ['started-negative', { ...literalClaims, startedAtMs: -1, deadlineAtMs: 9999 }],
    ['deadline-as-string', { ...literalClaims, deadlineAtMs: String(literalClaims.deadlineAtMs) }],
    ['deadline-null', { ...literalClaims, deadlineAtMs: null }],
    ['window9999', { ...literalClaims, deadlineAtMs: literalClaims.startedAtMs + 9999 }],
    ['window10001', { ...literalClaims, deadlineAtMs: literalClaims.startedAtMs + 10001 }],
    ['future-beyond-skew', { ...literalClaims, startedAtMs: WALL + 101, deadlineAtMs: WALL + 10101 }],
  ]) pure('reject invalid signed time ' + label, () => invalid(manualSign(claims)));
  pure('receiver rejects a non-finite wall clock', () => assert.throws(
    () => receiveSubmissionDeadline(manualSign(literalClaims), binding, secret, 100, clock(NaN)), InvalidSubmissionDeadlineError));

  for (const raw of [undefined, '', '-1', '1.5', '+1', 'NaN', 'Infinity', '1e2', '10000', '9007199254740992']) {
    pure('missing/invalid configured skew fails closed: ' + String(raw), () => assert.throws(() => configuredClockSkewBound(raw), SubmissionDeadlineConfigurationError));
  }
  pure('explicit valid skew strings are accepted, with no implicit default', () => {
    assert.equal(configuredClockSkewBound('0'), 0);
    assert.equal(configuredClockSkewBound('100'), 100);
    assert.equal(configuredClockSkewBound('9999'), 9999);
  });
  for (const skew of [undefined, null, -1, 0.5, NaN, Infinity, '0', 10000]) {
    pure('receiver rejects invalid skew value: ' + String(skew), () => assert.throws(
      () => receiveSubmissionDeadline(manualSign(literalClaims), binding, secret, skew, clock()), SubmissionDeadlineConfigurationError));
  }
  for (const badSecret of [undefined, '', 'short']) pure('secret configuration fails closed: ' + String(badSecret), () => {
    assert.throws(() => createSubmissionDeadline(binding, badSecret, WALL), SubmissionDeadlineConfigurationError);
    assert.throws(() => receiveSubmissionDeadline(manualSign(literalClaims), binding, badSecret, 100, clock()), SubmissionDeadlineConfigurationError);
  });
  pure('remaining time uses monotonic elapsed time after receipt despite wall-clock rollback', t => {
    let wall = WALL, mono = 500;
    const receiver = receiveSubmissionDeadline(manualSign(literalClaims), binding, secret, 100,
      { wallNow: () => wall, monotonicNow: () => mono });
    t.after(receiver.dispose);
    assert.equal(receiver.remainingMs(), 9700);
    wall -= 3600000; mono += 2300;
    assert.equal(receiver.remainingMs(), 7400);
    wall += 7200000; mono += 7400;
    assert.equal(receiver.remainingMs(), 0);
    assert.equal(receiver.expired(), true);
  });
  pure('expired signed deadline aborts before any actual database helper acquisition or SQL dispatch', async t => {
    const claims = { ...literalClaims, startedAtMs: WALL - 10000, deadlineAtMs: WALL };
    const receiver = receiveSubmissionDeadline(manualSign(claims), binding, secret, 0, clock());
    t.after(receiver.dispose);
    assert.equal(receiver.remainingMs(), 0);
    assert.equal(receiver.signal.aborted, true);
    let acquisitions = 0, queries = 0;
    const poolDouble = { totalCount: 0, idleCount: 0, waitingCount: 0,
      connect: async () => { acquisitions++; return { query: async () => { queries++; throw new Error('Unreachable SQL'); } }; } };
    await assert.rejects(databaseQuery(poolDouble, 'existing_lookup', 'SELECT 1', [], { isAbandoned: () => receiver.expired() }),
      error => error.code === 'RG_SUBMISSION_ABANDONED');
    assert.equal(acquisitions, 0);
    assert.equal(queries, 0);
  });
  pure('public state is safe for logs and contains neither signed header nor binding data', t => {
    const signed = manualSign(literalClaims);
    const receiver = receiveSubmissionDeadline(signed, binding, secret, 100, clock());
    t.after(receiver.dispose);
    const logged = JSON.stringify(receiver.publicState());
    for (const raw of [signed, secret, syntheticAuthorization, binding.traceId, binding.keySha256, binding.bodySha256, binding.authorizationSha256])
      assert(!logged.includes(raw), 'Public state leaked context/signature/binding');
  });
  pure('registry audience and caller are independently bound and cannot be used as an evaluation deadline', t => {
    const registryBinding = { ...binding, method: 'GET', route: '/internal/snapshot/app/suite?workspace=synthetic' };
    const signed = createSubmissionDeadline(registryBinding, secret, WALL - 200, 'registry');
    const claims = JSON.parse(Buffer.from(signed.split('.')[0], 'base64url').toString());
    assert.equal(claims.aud, 'registry'); assert.equal(claims.caller, 'evaluation');
    const receiver = receiveSubmissionDeadline(signed, registryBinding, secret, 100, clock(), 'registry');
    t.after(receiver.dispose);
    assert.equal(receiver.remainingMs(), 9700);
    invalid(signed, registryBinding, 'evaluation');
    assert.throws(() => receiveSubmissionDeadline(manualSign({ ...claims, caller: 'gateway' }), registryBinding, secret, 100, clock(), 'registry'), InvalidSubmissionDeadlineError);
    assert.throws(() => receiveSubmissionDeadline(manualSign(literalClaims), binding, secret, 100, clock(), 'registry'), InvalidSubmissionDeadlineError);
  });
  pure('registry child context keeps the original start rather than resetting the budget', t => {
    const parent = receiveSubmissionDeadline(manualSign(literalClaims), binding, secret, 100, clock());
    t.after(parent.dispose);
    const childBinding = { ...binding, method: 'GET', route: '/internal/snapshot/app/suite?workspace=synthetic' };
    const childHeader = createSubmissionDeadline(childBinding, secret, parent.startedAtMs, 'registry');
    const child = receiveSubmissionDeadline(childHeader, childBinding, secret, 100, clock(WALL + 1000, 1500), 'registry');
    t.after(child.dispose);
    assert.equal(child.startedAtMs, WALL - 200);
    assert.equal(child.deadlineAtMs, WALL + 9800);
    assert.equal(child.remainingMs(), 8700);
  });
}
