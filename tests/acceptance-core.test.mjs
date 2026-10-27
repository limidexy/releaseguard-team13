import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptanceOptions, acceptancePlan, runAcceptance } from '../scripts/acceptance-core.mjs';
const id = 'f7df9b5c-08e9-4d1d-9c73-7cbd99bcb50a';
const names = ['unit-tests', 'container-build', 'container-start', 'integration', 'improvements', 'ddd-contracts',
  'fault-recovery', 'prompt-replay', 'repeated-scaling', 'mixed-read-write', 'dependency-audit'];
function harness(overrides = {}) {
  const events = [], effects = []; let now = 10;
  const deps = { profile: 'full', runId: id, node: '/owned/node', deadlineMs: 100000,
    clock: { now: () => now++ },
    record: async e => events.push(JSON.parse(JSON.stringify(e))),
    prepare: async () => effects.push('prepare'), beforeStep: async () => {},
    run: async step => { effects.push(step.name); return { status: 0, signal: null }; },
    afterStep: async () => {}, cleanup: async () => { effects.push('cleanup'); return { stoppedAndVerified: true }; },
    verifySource: async () => true, ...overrides };
  return { deps, events, effects };
}
test('full protocol actually coordinates all eleven original command contracts in source order', async () => {
  const h = harness(), seen = [];
  h.deps.run = async (s, options) => { seen.push([s.name, s.command, s.args]); assert.ok(options.timeoutMs <= 600000); return { status: 0 }; };
  const r = await runAcceptance(h.deps);
  assert.deepEqual(seen, [
    ['unit-tests', 'npm', ['test']], ['container-build', 'docker', ['compose', 'build', 'gateway', 'postgres']],
    ['container-start', 'docker', ['compose', 'up', '-d', '--no-build', '--wait']],
    ['integration', '/owned/node', ['scripts/verify.mjs', '--restart']],
    ['improvements', '/owned/node', ['scripts/verify-improvements.mjs']],
    ['ddd-contracts', '/owned/node', ['scripts/verify-contracts.mjs']],
    ['fault-recovery', '/owned/node', ['scripts/fault-test.mjs']],
    ['prompt-replay', '/owned/node', ['scripts/compare-prompts.mjs', '--execute-comparison', 'replay']],
    ['repeated-scaling', '/owned/node', ['scripts/benchmark-repeated.mjs']],
    ['mixed-read-write', '/owned/node', ['scripts/mixed-load.mjs']],
    ['dependency-audit', 'npm', ['audit', '--audit-level=high', '--json']],
  ]);
  assert.deepEqual(r.steps.map(s => s.name), names); assert.equal(r.status, 'completed');
  assert.equal(r.allPlannedLocalStepsPassed, true); assert.equal(r.lifecycle.cleanup, 'stopped_and_verified');
});
for (const failure of names) test('failure at ' + failure + ' preserves its exit and never starts the remaining steps', async () => {
  const h = harness();
  h.deps.run = async step => { h.effects.push(step.name); return { status: step.name === failure ? 23 : 0 }; };
  const r = await runAcceptance(h.deps), n = names.indexOf(failure);
  assert.deepEqual(r.steps.map(s => s.name), names.slice(0, n + 1));
  assert.equal(r.steps.at(-1).exitCode, 23); assert.equal(r.steps.at(-1).status, 'failed');
  assert.equal(r.plannedSteps.slice(n + 1).every(x => x.status === 'not_run'), true);
  assert.equal(r.allPlannedLocalStepsPassed, false);
  assert.equal(h.effects.includes('cleanup'), n >= 1);
});
for (const result of [{ status: null, signal: 'SIGTERM' }, { status: null, error: { code: 'ETIMEDOUT', message: 'PRIVATE_SECRET' } },
  { status: 0, error: { code: 'ENOBUFS' } }, {}]) test('unknown process outcome is not a passed step: ' + JSON.stringify(result), async () => {
  const h = harness({ run: async () => result }); const r = await runAcceptance(h.deps);
  assert.equal(r.steps.length, 1); assert.equal(r.steps[0].status, 'unknown');
  assert.equal(r.allPlannedLocalStepsPassed, false); assert.doesNotMatch(JSON.stringify(r), /PRIVATE_SECRET/);
});
test('a persisted command intent must precede the actual command, including failure handling', async () => {
  const h = harness();
  h.deps.run = async step => {
    assert.deepEqual(h.events.at(-1), { kind: 'command_intent', name: step.name, command: step.command, args: step.args,
      exitCode: null, signal: null, error: null, errorCode: null, status: 'started_or_unknown' });
    return { status: 0 };
  };
  assert.equal((await runAcceptance(h.deps)).status, 'completed');
});
test('intent persistence failure cannot start that command or any later step', async () => {
  const h = harness(); h.deps.record = async e => { if (e.kind === 'command_intent' && e.name === 'ddd-contracts') throw Error('disk'); };
  const r = await runAcceptance(h.deps);
  assert.deepEqual(r.steps.map(s => s.name), names.slice(0, 5));
  assert.equal(r.plannedSteps[5].status, 'not_run'); assert.equal(h.effects.includes('ddd-contracts'), false);
});
test('a result journal failure retains the observed exit zero but does not call it successful evidence', async () => {
  const h = harness(); h.deps.record = async e => { if (e.kind === 'command_result') throw Error('disk'); };
  const r = await runAcceptance(h.deps);
  assert.equal(r.steps.length, 1); assert.equal(r.steps[0].exitCode, 0); assert.equal(r.steps[0].status, 'evidence_unknown');
  assert.equal(r.allPlannedLocalStepsPassed, false);
});
test('exit zero with missing or invalid child evidence stops before the next command', async () => {
  const h = harness({ afterStep: async s => { if (s.name === 'prompt-replay') throw Error('missing report'); } });
  const r = await runAcceptance(h.deps);
  assert.equal(r.steps.at(-1).name, 'prompt-replay'); assert.equal(r.steps.at(-1).exitCode, 0);
  assert.equal(r.steps.at(-1).status, 'evidence_invalid'); assert.equal(h.effects.includes('repeated-scaling'), false);
});
test('unit-only pass is not complete local acceptance and the remaining ten steps stay not_run', async () => {
  const h = harness({ profile: 'unit_only' }); const r = await runAcceptance(h.deps);
  assert.deepEqual(h.effects, ['unit-tests']); assert.equal(r.status, 'unit_only_completed');
  assert.equal(r.allPlannedLocalStepsPassed, false); assert.equal(r.plannedSteps.slice(1).every(x => x.status === 'not_run'), true);
});
test('source change fails the final gate even when all commands exit zero', async () => {
  const h = harness({ verifySource: async () => false }); const r = await runAcceptance(h.deps);
  assert.equal(r.sourceUnchangedDuringRun, false); assert.equal(r.allPlannedLocalStepsPassed, false);
});
for (const outcome of ['unknown', 'throws']) test('unverified cleanup cannot be counted as full acceptance: ' + outcome, async () => {
  let cleanups = 0;
  const h = harness({ cleanup: async () => { cleanups++; if (outcome === 'throws') throw Error('PRIVATE_SECRET'); return { stoppedAndVerified: false }; } });
  const r = await runAcceptance(h.deps);
  assert.equal(cleanups, 1); assert.equal(r.lifecycle.cleanup, 'unknown'); assert.equal(r.allPlannedLocalStepsPassed, false);
});
test('preparation failure runs no build and gives the lifecycle one chance to prove it is stopped', async () => {
  const h = harness({ prepare: async () => { throw Error('unsafe engine'); } }); const r = await runAcceptance(h.deps);
  assert.deepEqual(h.effects, ['unit-tests', 'cleanup']); assert.equal(r.lifecycle.preparation, 'started_or_unknown');
  assert.equal(r.allPlannedLocalStepsPassed, false);
});
test('expired deadline runs no command and cannot turn a not_run step into a pass', async () => {
  const h = harness({ deadlineMs: 1 }); const r = await runAcceptance(h.deps);
  assert.deepEqual(h.effects, []); assert.equal(r.steps.length, 0); assert.equal(r.allPlannedLocalStepsPassed, false);
});
test('negative raw coordinator duration is preserved, invalid and never clamped to zero', async () => {
  const values = [0, 1, 2, 10, 11, 12, 2, 3]; let index = 0;
  const h = harness({ profile: 'unit_only', clock: { now: () => values[index++] ?? 3 } });
  const r = await runAcceptance(h.deps);
  assert.equal(r.steps[0].durationMs, -8); assert.equal(r.steps[0].status, 'invalid_timing');
  assert.equal(r.allPlannedLocalStepsPassed, false); assert.equal(r.status, 'failed_or_incomplete');
});
test('strict full-mode configuration does not change or adopt the classroom project', () => {
  const env = { RG_ACCEPTANCE_RUN_ID: id, RG_ACCEPTANCE_INTEGRATION: '1', RELEASEGUARD_URL: 'http://127.0.0.1:5189' };
  assert.deepEqual(acceptanceOptions(['--full'], env, 'linux'), { profile: 'full', id, project: 'rg-contracts-' + id });
  for (const patch of [{ CI: 'true' }, { DOCKER_CONTEXT: 'remote' }, { COMPOSE_FILE: '/other.yaml' },
    { ALLOW_REAL_MODEL: 'true' }, { MODEL_API_KEY: 'PRIVATE_SECRET' }, { RELEASEGUARD_TOKEN: 'PRIVATE_SECRET' },
    { RELEASEGUARD_URL: 'http://user:pass@127.0.0.1:5189' }, { RELEASEGUARD_URL: 'http://127.0.0.1:5189/other' }]) {
    assert.throws(() => acceptanceOptions(['--full'], { ...env, ...patch }, 'linux'), /^Error: Acceptance denied$/);
  }
  assert.throws(() => acceptanceOptions(['--full'], env, 'win32'));
  assert.equal(acceptancePlan().length, 11);
});
test('an arbitrary error code is not a channel for raw credentials', async () => {
  const h = harness({ run: async () => ({ status: null, error: { code: 'PRIVATE_SECRET', message: 'PRIVATE_SECRET' } }) });
  const r = await runAcceptance(h.deps);
  assert.equal(r.steps[0].errorCode, 'UNKNOWN'); assert.doesNotMatch(JSON.stringify(r), /PRIVATE_SECRET/);
});
test('failed private log persistence retains the observed exit but cannot pass the command', async () => {
  const h = harness({ run: async () => ({ status: 0, signal: null, evidenceError: true }) });
  const r = await runAcceptance(h.deps);
  assert.equal(r.steps[0].exitCode, 0); assert.equal(r.steps[0].status, 'evidence_unknown');
  assert.equal(r.steps.length, 1); assert.equal(r.allPlannedLocalStepsPassed, false);
});
test('cancellation after the unit result starts no preparation or later command', async () => {
  let cancelled = false;
  const h = harness({ cancelled: () => cancelled, record: async e => { if (e.kind === 'command_result') cancelled = true; } });
  const r = await runAcceptance(h.deps);
  assert.equal(r.cancelled, true); assert.deepEqual(r.steps.map(s => s.name), ['unit-tests']);
  assert.equal(h.effects.includes('prepare'), false); assert.equal(r.allPlannedLocalStepsPassed, false);
});
