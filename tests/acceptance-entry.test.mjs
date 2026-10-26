import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const source = resolve('scripts');
const boundary = pathToFileURL(resolve('tests/fixtures/acceptance-boundary.mjs')).href;
const id = 'f7df9b5c-08e9-4d1d-9c73-7cbd99bcb50a';
const planned = ['unit-tests', 'container-build', 'container-start', 'integration', 'improvements', 'ddd-contracts',
  'fault-recovery', 'prompt-replay', 'repeated-scaling', 'mixed-read-write', 'dependency-audit'];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'rg-acceptance-'));
  mkdirSync(join(root, 'scripts')); mkdirSync(join(root, 'evidence/current'), { recursive: true });
  for (const file of readdirSync(source).filter(x => /^acceptance.*\.mjs$/.test(x) || x === 'npm-command.mjs')) {
    writeFileSync(join(root, 'scripts', file), readFileSync(join(source, file)));
  }
  writeFileSync(join(root, 'package.json'), '{"type":"module","private":true}\n');
  writeFileSync(join(root, 'source.txt'), 'original source\n');
  writeFileSync(join(root, '.env'), 'AUTH_SECRET=owned-synthetic-key\nALLOW_REAL_MODEL=false\n', { mode: 0o600 });
  writeFileSync(join(root, 'evidence/current/acceptance.json'), 'original retained report\n');
  return root;
}
function run(root, { args = [], env = {}, imported = false } = {}) {
  return spawnSync(process.execPath, ['--import', boundary,
    ...(imported ? ['--input-type=module', '-e', "await import('./scripts/acceptance.mjs')"] : ['scripts/acceptance.mjs', ...args])], {
    cwd: root, encoding: 'utf8', timeout: 15000,
    env: { PATH: process.env.PATH, RG_ACCEPTANCE_FIXTURE_ROOT: root, RG_ACCEPTANCE_RUN_ID: id,
      RG_ACCEPTANCE_FIXTURE_NPM_EXIT: '0', RELEASEGUARD_URL: 'http://127.0.0.1:5189',
      ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot } : {}), ...env },
  });
}
function commands(root) {
  const events = readFileSync(join(root, 'evidence/boundary.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  assert.equal(events[0].ready, true, 'the intended boundary must initialize; a failed preload is not a passing guard');
  assert.equal(events.some(x => x.denied), false, 'an unhandled external fallback is not the expected product rejection');
  return events.filter(x => x.command);
}
test('importing acceptance never runs a unit gate or service command and preserves the retained report', () => {
  const root = fixture();
  try { const r = run(root, { imported: true }); assert.equal(r.status, 0, r.stderr); assert.deepEqual(commands(root), []);
    assert.equal(readFileSync(join(root, 'evidence/current/acceptance.json'), 'utf8'), 'original retained report\n');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
for (const [name, args, env] of [
  ['unknown operator argument', ['--execute-everything'], {}],
  ['missing full-mode opt-in', ['--full'], {}],
  ['hosted CI cannot activate local full acceptance', ['--full'], { RG_ACCEPTANCE_INTEGRATION: '1', CI: 'true' }],
  ['classroom endpoint is never a full target', ['--full'], { RG_ACCEPTANCE_INTEGRATION: '1', RELEASEGUARD_URL: 'http://127.0.0.1:5193' }],
  ['remote endpoint is not disposable local acceptance', ['--full'], { RG_ACCEPTANCE_INTEGRATION: '1', RELEASEGUARD_URL: 'https://example.invalid' }],
  ['Docker host override cannot redirect full operations', ['--full'], { RG_ACCEPTANCE_INTEGRATION: '1', DOCKER_HOST: 'tcp://127.0.0.1:2375' }],
  ['classroom Compose project cannot be adopted', ['--full'], { RG_ACCEPTANCE_INTEGRATION: '1', COMPOSE_PROJECT_NAME: 'releaseguard-team13' }],
  ['ambiguous run identifier cannot be reused', ['--full'], { RG_ACCEPTANCE_INTEGRATION: '1', RG_ACCEPTANCE_RUN_ID: '../old-run' }],
]) test(name + ' is denied before any command', () => {
  const root = fixture();
  try { const r = run(root, { args, env }); assert.equal(r.status, 1); assert.deepEqual(commands(root), []);
    assert.equal(readFileSync(join(root, 'evidence/current/acceptance.json'), 'utf8'), 'original retained report\n');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('default unit-only profile preserves a real nonzero exit and makes the ten unexecuted steps visible', () => {
  const root = fixture();
  try {
    const r = run(root, { env: { RG_ACCEPTANCE_FIXTURE_NPM_EXIT: '23' } });
    assert.equal(r.status, 1); assert.match(r.stderr, /exited with 23/);
    const report = JSON.parse(readFileSync(join(root, 'evidence/private/acceptance', id, 'report.json'), 'utf8'));
    assert.deepEqual(report.plannedSteps.map(x => x.name), planned);
    assert.equal(report.steps.length, 1); assert.equal(report.steps[0].exitCode, 23);
    assert.equal(report.plannedSteps.slice(1).every(x => x.status === 'not_run'), true);
    assert.equal(report.allPlannedLocalStepsPassed, false); assert.equal(report.sourceUnchangedDuringRun, true);
    assert.equal(commands(root).some(c => /docker/.test(c.command ?? '')), false);
    assert.equal(readFileSync(join(root, 'evidence/current/acceptance.json'), 'utf8'), 'original retained report\n');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('a passed unit gate is explicitly unit_only_completed, not eleven-step acceptance', () => {
  const root = fixture();
  try {
    const r = run(root); assert.equal(r.status, 0, r.stderr);
    const report = JSON.parse(readFileSync(join(root, 'evidence/private/acceptance', id, 'report.json'), 'utf8'));
    assert.equal(report.status, 'unit_only_completed'); assert.equal(report.allPlannedLocalStepsPassed, false);
    assert.equal(report.steps.length, 1); assert.equal(report.plannedSteps[0].status, 'passed');
    assert.equal(report.plannedSteps.slice(1).every(x => x.status === 'not_run'), true);
    assert.equal(commands(root).some(c => /docker/.test(c.command)), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('a reserved run ID cannot overwrite prior terminal evidence or launch another unit gate', () => {
  const root = fixture();
  try {
    assert.equal(run(root).status, 0);
    const file = join(root, 'evidence/private/acceptance', id, 'terminal.json'), original = readFileSync(file, 'utf8');
    const before = commands(root).length;
    assert.equal(run(root).status, 1); assert.equal(commands(root).length, before);
    assert.equal(readFileSync(file, 'utf8'), original);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('operational unit logs redact bearer and named credential values without changing the observed exit', () => {
  const root = fixture();
  try {
    const r = run(root, { env: { RG_ACCEPTANCE_FIXTURE_NPM_EXIT: '23',
      RG_ACCEPTANCE_FIXTURE_STDOUT: 'Bearer OWNED_BEARER_VALUE\nAUTH_SECRET=OWNED_NAMED_VALUE\nplain diagnostic\n' } });
    assert.equal(r.status, 1);
    const log = readFileSync(join(root, 'evidence/private/acceptance', id, 'logs/unit-tests.log'), 'utf8');
    assert.doesNotMatch(log + r.stdout + r.stderr, /OWNED_BEARER_VALUE|OWNED_NAMED_VALUE/);
    assert.match(log, /plain diagnostic/);
    const report = JSON.parse(readFileSync(join(root, 'evidence/private/acceptance', id, 'report.json'), 'utf8'));
    assert.equal(report.steps[0].exitCode, 23);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
