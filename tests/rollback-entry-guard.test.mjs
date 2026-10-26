import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
const root = fileURLToPath(new URL('../', import.meta.url));
const valid = { RG_ROLLBACK_INTEGRATION: '1', COMPOSE_PROJECT_NAME: 'rg-ci-rollback-offline', RELEASEGUARD_URL: 'http://127.0.0.1:5189', RG_ROLLBACK_IMAGE: 'sha256:' + 'a'.repeat(64) };
for (const [name, changes, error] of [
  ['missing opt-in', { RG_ROLLBACK_INTEGRATION: '' }, /explicit.*rollback.*opt-in/i],
  ['classroom project', { COMPOSE_PROJECT_NAME: 'releaseguard-team13' }, /disposable.*project/i],
  ['classroom endpoint', { RELEASEGUARD_URL: 'http://localhost:5193' }, /classroom endpoint/i],
  ['remote endpoint', { RELEASEGUARD_URL: 'http://example.com:5189' }, /loopback/i],
  ['implicit endpoint', { RELEASEGUARD_URL: '' }, /explicit.*endpoint|Invalid URL/i],
  ['implicit port', { RELEASEGUARD_URL: 'http://localhost' }, /explicit.*port/i],
  ['URL credentials', { RELEASEGUARD_URL: 'http://fake:fake@localhost:5189' }, /credentials.*path.*query.*fragment/i],
  ['URL path', { RELEASEGUARD_URL: 'http://localhost:5189/history' }, /credentials.*path.*query.*fragment/i],
  ['URL query', { RELEASEGUARD_URL: 'http://localhost:5189/?synthetic=true' }, /credentials.*path.*query.*fragment/i],
  ['URL fragment', { RELEASEGUARD_URL: 'http://localhost:5189/#history' }, /credentials.*path.*query.*fragment/i],
  ['TLS endpoint', { RELEASEGUARD_URL: 'https://localhost:5189' }, /plain HTTP/i],
  ['remote Docker host', { DOCKER_HOST: 'tcp://example.com:2376' }, /Docker.*override/i],
  ['Docker context override', { DOCKER_CONTEXT: 'production' }, /Docker.*override/i],
  ['missing image and archive', { RG_ROLLBACK_IMAGE: '' }, /existing.*local image|retained artifact/i],
  ['image credentials', { RG_ROLLBACK_IMAGE: 'https://fake:fake@example.com/image' }, /image reference|existing.*local image/i],
]) test('rollback CLI rejects ' + name + ' before any credential/process/network boundary', () => {
  const result = spawnSync(process.execPath, ['--import', './tests/fixtures/contracts-safety-preload.mjs', './scripts/verify-rollback.mjs'], {
    cwd: root, env: { ...valid, ...changes }, encoding: 'utf8', timeout: 10000,
  });
  assert.notEqual(result.status, 0); assert.equal(result.error, undefined);
  assert.match(result.stderr, error); assert.doesNotMatch(result.stdout + result.stderr, /BOUNDARY_ATTEMPT:/);
});
