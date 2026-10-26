import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// These subprocesses must reject unsafe targets before loading any credential or
// running Docker/network operations. No .env is created in this offline stage.
for (const scenario of [
  { name: 'missing opt-in', env: {}, reason: /Explicit disposable integration opt-in required/ },
  { name: 'classroom Compose project', env: { RG_LINEAGE_INTEGRATION: '1', COMPOSE_PROJECT_NAME: 'releaseguard-team13' }, reason: /disposable rg-ci\/rg-lineage Compose project is required/ },
  { name: 'classroom endpoint', env: { RG_LINEAGE_INTEGRATION: '1', COMPOSE_PROJECT_NAME: 'rg-lineage-synthetic', RELEASEGUARD_URL: 'http://localhost:5193' }, reason: /classroom endpoint is forbidden/ },
  { name: 'remote endpoint', env: { RG_LINEAGE_INTEGRATION: '1', COMPOSE_PROJECT_NAME: 'rg-lineage-synthetic', RELEASEGUARD_URL: 'https://example.invalid' }, reason: /Only a loopback endpoint is allowed/ },
]) {
  test(`lineage integration rejects ${scenario.name} before reading credentials`, () => {
    const child = spawnSync(process.execPath, ['scripts/verify-lineage.mjs'], {
      cwd: new URL('../..', import.meta.url), encoding: 'utf8', timeout: 5000,
      env: { ...scenario.env },
    });
    assert.equal(child.error, undefined); assert.notEqual(child.status, 0);
    assert.match(child.stderr, scenario.reason);
    assert.doesNotMatch(child.stderr, /ENOENT|AUTH_SECRET|could not connect/);
    assert.equal(child.stdout, '');
  });
}
