import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
const id = 'f7df9b5c-08e9-4d1d-9c73-7cbd99bcb50a';
const names = ['unit-tests', 'container-build', 'container-start', 'integration', 'improvements', 'ddd-contracts', 'fault-recovery', 'prompt-replay', 'repeated-scaling', 'mixed-read-write', 'dependency-audit'];
function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'rg-acceptance-full-')));
  for (const dir of ['scripts', 'dist', 'evidence/current', 'dependencies']) fs.mkdirSync(join(root, dir), { recursive: true, mode: 0o700 });
  for (const file of fs.readdirSync('scripts').filter(f => /^acceptance.*\.mjs$/.test(f) || ['contract-target.mjs', 'npm-command.mjs'].includes(f))) fs.copyFileSync(join('scripts', file), join(root, 'scripts', file));
  fs.copyFileSync('compose.yaml', join(root, 'compose.yaml'));
  fs.writeFileSync(join(root, 'package.json'), '{"type":"module","private":true}\n');
  fs.writeFileSync(join(root, 'dist/fixture.js'), 'export const synthetic = true;\n'); fs.symlinkSync(join(root, 'dependencies'), join(root, 'node_modules'), 'dir');
  fs.writeFileSync(join(root, '.env'), ['AUTH_SECRET', 'INTERNAL_SECRET', 'POSTGRES_PASSWORD', 'REGISTRY_DB_PASSWORD', 'EVALUATION_DB_PASSWORD', 'GOVERNANCE_DB_PASSWORD', 'RABBIT_PASSWORD'].map((key, i) => key + '=' + String(i + 1).repeat(64)).join('\n') + '\n', { mode: 0o600 });
  fs.writeFileSync(join(root, 'evidence/current/acceptance.json'), 'retained original report\n'); return root;
}
for (const mode of ['pass', 'foreign-engine', 'model-config', 'model-runtime', 'partial-up', 'missing-report', 'log-sync', 'bad-mixed']) {
  test('actual full CLI/target orchestration with owned fake boundaries: ' + mode,
    { skip: process.platform === 'win32' ? 'Full local acceptance is explicitly POSIX-only' : false }, () => {
      const root = fixture();
      try {
        const r = spawnSync(process.execPath, ['--import', resolve('tests/fixtures/acceptance-full-boundary.mjs'), 'scripts/acceptance.mjs', '--full'], {
          cwd: root, env: { PATH: process.env.PATH, RG_ACCEPTANCE_RUN_ID: id, RG_ACCEPTANCE_INTEGRATION: '1', RELEASEGUARD_URL: 'http://127.0.0.1:5189',
            RG_ACCEPTANCE_FULL_FIXTURE_ROOT: root, RG_ACCEPTANCE_FULL_FIXTURE_MODE: mode }, encoding: 'utf8', timeout: 30000 });
        assert.equal(r.error, undefined); assert.equal(r.status, mode === 'pass' ? 0 : 1, r.stderr);
        const events = fs.readFileSync(join(root, 'evidence/full-boundary.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
        assert.equal(events[0].ready, true); assert.equal(events.some(e => e.denied), false, 'a boundary wiring failure is not a passing guard');
        const report = JSON.parse(fs.readFileSync(join(root, 'evidence/private/acceptance', id, 'report.json'), 'utf8'));
        assert.deepEqual(report.plannedSteps.map(s => s.name), names);
        assert.equal(report.allPlannedLocalStepsPassed, mode === 'pass'); assert.equal(report.sourceUnchangedDuringRun, true);
        assert.equal(fs.readFileSync(join(root, 'evidence/current/acceptance.json'), 'utf8'), 'retained original report\n');
        assert.equal(events.some(e => e.docker?.some(x => ['down', 'rm', 'prune', 'rmi'].includes(x))), false);
        assert.doesNotMatch(r.stdout + r.stderr + JSON.stringify(report.target), /PRIVATE_DUMMY_DIAGNOSTIC|1111111111111111111111111111111111111111111111111111111111111111/);
        if (mode === 'pass') { assert.deepEqual(events.filter(e => e.step).map(e => e.step), names); assert.equal(report.lifecycle.cleanup, 'stopped_and_verified'); }
        if (mode === 'foreign-engine') { assert.equal(events.some(e => e.credentialReadAfterProof), false); assert.deepEqual(events.filter(e => e.step).map(e => e.step), ['unit-tests']); }
        if (['model-config', 'model-runtime', 'partial-up', 'log-sync'].includes(mode)) assert.equal(events.some(e => e.step === 'integration'), false);
        if (mode === 'partial-up') { assert.equal(report.steps.at(-1).exitCode, 17); assert.equal(report.lifecycle.cleanup, 'unknown'); }
        if (mode === 'log-sync') { assert.equal(report.steps.at(-1).exitCode, 0); assert.equal(report.steps.at(-1).status, 'evidence_unknown'); }
        if (mode === 'missing-report') { assert.equal(report.steps.at(-1).status, 'evidence_invalid'); assert.equal(events.some(e => e.step === 'improvements'), false); }
        if (mode === 'bad-mixed') { assert.equal(report.steps.at(-1).status, 'evidence_invalid'); assert.equal(events.some(e => e.step === 'dependency-audit'), false); }
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });
}
