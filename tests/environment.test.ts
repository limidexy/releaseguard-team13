import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { suiteSchema } from '../src/domain.js';
process.env.AUTH_ISSUER = 'https://identity.invalid/realm';
process.env.OIDC_JWKS_URL = 'https://identity.invalid/jwks';
const { gateway } = await import('../src/gateway.js');
test('environment comes from explicit server deployment config and fails to unconfirmed', async () => {
  const savedEnv = process.env.RG_DEPLOYMENT_ENV, savedAuth = process.env.AUTH_MODE;
  const app = Fastify(); await gateway(app);
  try {
    delete process.env.RG_DEPLOYMENT_ENV; process.env.AUTH_MODE = 'oidc';
    assert.equal((await app.inject('/environment.json')).json().environment, 'unconfirmed');
    process.env.AUTH_MODE = 'dev';
    assert.equal((await app.inject('/environment.json')).json().environment, 'local');
    process.env.RG_DEPLOYMENT_ENV = 'gcp-trial';
    const cloud = await app.inject('/environment.json');
    assert.equal(cloud.json().environment, 'gcp-trial');
    assert.equal(cloud.json().provider, 'Google Cloud / GKE');
    assert.equal(cloud.headers['cache-control'], 'no-store');
    assert.equal(JSON.stringify(cloud.json()).includes('MODEL_API_KEY'), false);
  } finally {
    if (savedEnv === undefined) delete process.env.RG_DEPLOYMENT_ENV; else process.env.RG_DEPLOYMENT_ENV = savedEnv;
    if (savedAuth === undefined) delete process.env.AUTH_MODE; else process.env.AUTH_MODE = savedAuth;
    await app.close();
  }
});
test('new suite keeps the same questions, thresholds and critical flags without replacing legacy fixture', async () => {
  const app = Fastify(); await gateway(app);
  try {
    const legacy = (await app.inject('/demo-fixtures.json')).json();
    const revised = (await app.inject('/returns-fixtures-v2.json')).json();
    assert.equal(suiteSchema.safeParse(revised.suite).success, true);
    assert.deepEqual(revised.suite.cases.map((c: any) => [c.id,c.prompt,c.critical]), legacy.suite.cases.map((c: any) => [c.id,c.prompt,c.critical]));
    assert.deepEqual(revised.suite.policy, legacy.suite.policy);
    assert.equal(revised.suite.cases[0].rule, 'returns_policy_v2');
    assert.equal(legacy.suite.cases[0].rule, 'contains');
  } finally { await app.close(); }
});
