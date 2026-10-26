import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const allowed = { RG_CONTRACTS_INTEGRATION: '1', COMPOSE_PROJECT_NAME: 'rg-ci-offline-guard', RELEASEGUARD_URL: 'http://127.0.0.1:5189' };
for (const [name, changes, error] of [
  ['missing explicit opt-in', { RG_CONTRACTS_INTEGRATION: '' }, /explicit disposable integration opt-in/i],
  ['classroom project', { COMPOSE_PROJECT_NAME: 'releaseguard-team13' }, /disposable.*project/i],
  ['classroom endpoint', { RELEASEGUARD_URL: 'http://127.0.0.1:5193' }, /classroom endpoint/i],
  ['remote endpoint', { RELEASEGUARD_URL: 'http://example.com:5189' }, /loopback|Local contract verification only/i],
  ['implicit endpoint', { RELEASEGUARD_URL: '' }, /explicit.*endpoint|Invalid URL/i],
  ['missing explicit port', { RELEASEGUARD_URL: 'http://localhost' }, /explicit.*port/i],
  ['endpoint credentials', { RELEASEGUARD_URL: 'http://fake:fake@localhost:5189' }, /credentials.*path.*query.*fragment/i],
  ['endpoint path', { RELEASEGUARD_URL: 'http://localhost:5189/history' }, /credentials.*path.*query.*fragment/i],
  ['endpoint query', { RELEASEGUARD_URL: 'http://localhost:5189/?token=synthetic' }, /credentials.*path.*query.*fragment/i],
  ['endpoint fragment', { RELEASEGUARD_URL: 'http://localhost:5189/#history' }, /credentials.*path.*query.*fragment/i],
  ['TLS endpoint', { RELEASEGUARD_URL: 'https://localhost:5189' }, /plain HTTP/i],
  ['remote Docker override', { DOCKER_HOST: 'tcp://example.com:2376' }, /Docker.*override/i],
  ['context override', { DOCKER_CONTEXT: 'production' }, /Docker.*override/i],
]) {
  test('contract CLI refuses ' + name + ' before credentials, processes or network', () => {
    const result = spawnSync(process.execPath, ['--import', './tests/fixtures/contracts-safety-preload.mjs', './scripts/verify-contracts.mjs'], {
      cwd: root, env: { ...allowed, ...changes }, encoding: 'utf8', timeout: 10000,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, error);
    assert.doesNotMatch(result.stdout + result.stderr, /BOUNDARY_ATTEMPT:/);
    assert.equal(result.error, undefined);
  });
}
