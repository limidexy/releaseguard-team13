import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('server logger redacts the submission budget without dropping safe fields', () => {
  const commonUrl = new URL('../src/common.js', import.meta.url).href;
  // A subprocess isolates common.ts's module-level auth/pool configuration.
  // Every value is synthetic; no developer environment or credential is copied.
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import net from 'node:net';
    const forbidden = { listen: 0, connect: 0, fetch: 0, query: 0, poolConnect: 0 };
    net.Server.prototype.listen = function () {
      forbidden.listen++; throw new Error('Network listeners are forbidden in this unit test');
    };
    net.Socket.prototype.connect = function () {
      forbidden.connect++; throw new Error('Network connections are forbidden in this unit test');
    };
    globalThis.fetch = async function () {
      forbidden.fetch++; throw new Error('Fetch is forbidden in this unit test');
    };
    const { server, pool } = await import(${JSON.stringify(commonUrl)});
    pool.query = function () {
      forbidden.query++; throw new Error('Database queries are forbidden in this unit test');
    };
    pool.connect = function () {
      forbidden.poolConnect++; throw new Error('Database acquisition is forbidden in this unit test');
    };
    const app = server();
    try {
      // Default request serialization omits headers. Preserve them only in this
      // test child logger, inheriting the real server logger's redaction rules.
      // Never construct a second logger or supply a test-owned redact array.
      const logger = app.log.child({}, { serializers: { req: value => value } });
      logger.info({ req: { headers: {
        authorization: 'synthetic-auth-redaction-marker',
        cookie: 'synthetic-cookie-redaction-marker',
        'x-rg-submission-budget': 'synthetic-budget-redaction-marker',
        'x-safe-debug': 'retain-safe-header'
      }, marker: 'retain-safe-request-field' } }, 'synthetic server logger regression');
      await new Promise((resolve, reject) => logger.flush(error => error ? reject(error) : resolve()));
      process.stdout.write(JSON.stringify({ kind: 'unit-test-scope', forbidden,
        listening: app.server.listening, poolTotal: pool.totalCount,
        poolIdle: pool.idleCount, poolWaiting: pool.waitingCount }) + '\\n');
    } finally {
      await app.close();
      await pool.end();
    }
  `], {
    encoding: 'utf8', timeout: 10000, maxBuffer: 65536,
    env: {
      AUTH_MODE: 'dev', ALLOW_DEV_AUTH: 'true', SERVICE_ROLE: 'gateway',
      AUTH_SECRET: 'synthetic-logger-unit-test-secret-not-a-real-credential',
      DATABASE_URL: 'postgres://unused:unused@127.0.0.1:1/never_connected',
      NODE_ENV: 'test', TZ: 'UTC'
    }
  });
  assert.equal(child.error, undefined, 'synthetic logger subprocess must finish');
  assert.equal(child.status, 0, 'synthetic logger subprocess must exit successfully: ' + child.stderr);
  assert.equal(child.stderr, '', 'synthetic logger subprocess must not report errors');
  const records = child.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  assert.equal(records.length, 2, 'one real logger record and one scope record are expected');
  const scope = records.find(record => record.kind === 'unit-test-scope');
  assert(scope, 'scope record must be present');
  assert.deepEqual(scope.forbidden, { listen: 0, connect: 0, fetch: 0, query: 0, poolConnect: 0 });
  assert.equal(scope.listening, false);
  assert.equal(scope.poolTotal, 0);
  assert.equal(scope.poolIdle, 0);
  assert.equal(scope.poolWaiting, 0);
  const record = records.find(value => value.msg === 'synthetic server logger regression');
  assert(record, 'the actual server logger record must be present');
  assert.equal(record.req.headers.authorization, '[Redacted]');
  assert.equal(record.req.headers.cookie, '[Redacted]');
  assert.equal(record.req.marker, 'retain-safe-request-field');
  assert.equal(record.req.headers['x-safe-debug'], 'retain-safe-header');
  assert.equal(record.req.headers['x-rg-submission-budget'], '[Redacted]', 'submission budget header must be redacted');
  for (const marker of ['synthetic-auth-redaction-marker', 'synthetic-cookie-redaction-marker', 'synthetic-budget-redaction-marker']) {
    assert.equal(child.stdout.includes(marker), false, 'raw synthetic sensitive marker must not appear');
  }
});
