import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { Socket } from 'node:net';
import Fastify from 'fastify';

// Inject the real route; no running classroom, cloud, database or model service.
mock.method(Socket.prototype, 'connect', () => { throw Error('Environment regression forbids TCP'); });
mock.method(globalThis, 'fetch', async () => { throw Error('Environment regression forbids external fetch'); });
Object.assign(process.env, { AUTH_MODE: 'dev', ALLOW_DEV_AUTH: 'true', AUTH_SECRET: 'synthetic-environment-test-secret-only',
  DATABASE_URL: 'postgresql://offline:offline@127.0.0.1:1/offline', AMQP_URL: 'amqp://offline:offline@127.0.0.1:1' });
const { gateway } = await import('../src/gateway.js');
const keys = ['AUTH_MODE', 'RG_DEPLOYMENT_ENV', 'RG_DEPLOYMENT_REGION', 'MODEL_API_KEY'] as const;
async function inspect(configuration: Record<string, string | undefined>, url = '/environment.json', headers = {}) {
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) { const value = configuration[key]; if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  const app = Fastify(); await gateway(app);
  try { return await app.inject({ url, headers }); }
  finally { await app.close(); for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } }
}
for (const [configuration, environment] of [
  [{ AUTH_MODE: 'oidc' }, 'unconfirmed'],
  [{ AUTH_MODE: 'dev' }, 'local'],
  [{ AUTH_MODE: 'oidc', RG_DEPLOYMENT_ENV: 'local' }, 'local'],
  [{ AUTH_MODE: 'dev', RG_DEPLOYMENT_ENV: 'gcp-trial' }, 'gcp-trial'],
  [{ AUTH_MODE: 'dev', RG_DEPLOYMENT_ENV: 'production' }, 'unconfirmed'],
  [{ AUTH_MODE: 'dev', RG_DEPLOYMENT_ENV: '' }, 'unconfirmed'],
] as const) {
  test('public environment is a declaration, not deployment evidence: ' + JSON.stringify(configuration), async () => {
    const response = await inspect(configuration);
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers['referrer-policy'], 'no-referrer');
    assert.match(response.headers['content-security-policy'] ?? '', /connect-src 'self'/);
    assert.deepEqual(response.json(), { environment, configurationOnly: true,
      provider: environment === 'gcp-trial' ? 'Google Cloud / GKE' : null, region: null,
      modelApproval: 'See each job; human review required' });
  });
}
test('host, forwarded headers and query parameters cannot assert a cloud deployment', async () => {
  const response = await inspect({ AUTH_MODE: 'oidc' }, '/environment.json?environment=gcp-trial', { host: 'cloud.example', 'x-forwarded-host': 'gcp-trial.example', 'x-rg-environment': 'gcp-trial' });
  assert.equal(response.json().environment, 'unconfirmed');
});
test('region is explicit, bounded configuration only, never a hardcoded location or secret dump', async () => {
  for (const region of [undefined, 'asia-southeast1', 'https://user:secret@host.invalid', 'secret\nvalue', 'x'.repeat(100)]) {
    const response = await inspect({ RG_DEPLOYMENT_ENV: 'gcp-trial', RG_DEPLOYMENT_REGION: region, MODEL_API_KEY: 'synthetic-private-must-not-echo' });
    assert.equal(response.json().region, region === 'asia-southeast1' ? region : null);
    assert.equal(response.json().configurationOnly, true);
    assert.deepEqual(Object.keys(response.json()).sort(), ['environment', 'configurationOnly', 'provider', 'region', 'modelApproval'].sort());
    assert.ok(!response.body.includes('synthetic-private')); assert.ok(!response.body.includes('user:secret'));
  }
  assert.equal((await inspect({ RG_DEPLOYMENT_ENV: 'local', RG_DEPLOYMENT_REGION: 'asia-southeast1' })).json().region, null);
});
