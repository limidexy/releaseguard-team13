import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import child from 'node:child_process';
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { targetFixture } from './fixtures/acceptance-target-fixture.mjs';
child.execFileSync = () => { throw Error('REAL_PROCESS_DENIED'); };
net.Socket.prototype.connect = () => { throw Error('REAL_TCP_DENIED'); };
globalThis.fetch = () => { throw Error('REAL_FETCH_DENIED'); };
syncBuiltinESMExports();
const { acceptanceTarget } = await import('../scripts/acceptance-target.mjs');
function make(f) { return acceptanceTarget(f.options, f.execute); }
async function started(f) {
  const t = make(f); await t.prepare(); await t.beforeStep({ name: 'container-build' }); f.build();
  await t.afterStep({ name: 'container-build' }, { status: 0 }); await t.beforeStep({ name: 'container-start' }); f.start();
  await t.afterStep({ name: 'container-start' }, { status: 0 }); return t;
}
test('private source and compiled copies preserve bytes and do not overwrite retained source evidence', async () => {
  const f = targetFixture();
  try {
    fs.mkdirSync(join(f.root, 'evidence/current'), { recursive: true }); fs.writeFileSync(join(f.root, 'evidence/current/original.json'), 'original\n');
    const t = make(f); await t.prepare();
    assert.equal(fs.readFileSync(join(t.cwd, 'compose.yaml'), 'utf8'), fs.readFileSync(join(f.root, 'compose.yaml'), 'utf8'));
    assert.equal(fs.readFileSync(join(t.cwd, 'dist/fixture.js'), 'utf8'), 'export const fixture = true;\n');
    assert.equal(fs.readFileSync(join(f.root, 'evidence/current/original.json'), 'utf8'), 'original\n');
    assert.equal(t.summary.sourceCopyVerified, true); assert.equal(t.summary.compiledFiles.length, 1);
    assert.equal(t.env.COMPOSE_PROJECT_NAME, 'rg-contracts-f7df9b5c-08e9-4d1d-9c73-7cbd99bcb50a');
    assert.equal(t.env.RG_MIXED_LOAD_RUN_ID, 'f7df9b5c-08e9-4d1d-9c73-7cbd99bcb50a');
    assert.equal(t.env.RG_LOAD_SECONDS, '20'); assert.equal(t.env.RG_JOBS, '120');
    assert.equal(t.env.MODEL_API_KEY, ''); assert.equal(t.env.ALLOW_REAL_MODEL, 'false');
    assert.doesNotMatch(JSON.stringify(t.summary), /1111111111111111111111111111111111111111111111111111111111111111/);
    assert.equal(f.calls.some(c => ['stop', 'up', 'build', 'exec'].includes(c[0])), false);
  } finally { f.cleanup(); }
});
for (const resource of ['containers', 'images', 'volumes', 'networks']) test('pre-existing ' + resource + ' prevent adoption before credential access or build', async () => {
  const f = targetFixture();
  try {
    fs.unlinkSync(join(f.root, '.env')); // Reading credentials first would fail before the required engine observation.
    if (resource === 'containers') f.states.set('f'.repeat(64), {});
    if (resource === 'images') f.engine.images = ['foreign-image'];
    if (resource === 'volumes') f.engine.volumes = ['foreign-volume'];
    if (resource === 'networks') f.engine.networks.push('foreign-network');
    await assert.rejects(make(f).prepare(), /Acceptance target denied/);
    assert.equal(f.calls.some(c => c[0] === 'ps'), true);
    assert.equal(fs.existsSync(f.cwd), false);
    assert.equal(f.calls.some(c => c[0] === 'compose'), false);
  } finally { f.cleanup(); }
});
for (const patch of [c => { c.services.support.environment.ALLOW_REAL_MODEL = 'true'; },
  c => { c.services.gateway.ports[0].published = '5193'; }, c => { c.services.registry.build.context = '/another-project'; },
  c => { c.services.postgres.volumes[0] = { type: 'bind', source: '/existing/database', target: '/var/lib/postgresql/data' }; },
  c => { c.networks.default.external = true; }]) test('unsafe effective Compose configuration stops before container build', async () => {
  const f = targetFixture();
  try { patch(f.config); await assert.rejects(make(f).prepare(), /Acceptance target denied/); assert.equal(f.calls.some(c => c[0] === 'stop'), false); }
  finally { f.cleanup(); }
});
test('source hash mismatch cannot silently copy a later modified source version', async () => {
  const f = targetFixture();
  try { fs.appendFileSync(join(f.root, 'compose.yaml'), '# changed\n'); await assert.rejects(make(f).prepare(), /Acceptance target denied/); }
  finally { f.cleanup(); }
});
test('private credential symlinks are refused without modifying the target file', async () => {
  const f = targetFixture();
  try {
    const original = fs.readFileSync(join(f.root, '.env')); fs.renameSync(join(f.root, '.env'), join(f.root, 'retained-env'));
    fs.symlinkSync(join(f.root, 'retained-env'), join(f.root, '.env'));
    await assert.rejects(make(f).prepare(), /Acceptance target denied/);
    assert.deepEqual(fs.readFileSync(join(f.root, 'retained-env')), original);
  } finally { f.cleanup(); }
});
test('runtime proof binds eight services, exact images, loopback endpoint and disabled model', async () => {
  const f = targetFixture();
  try { const t = await started(f); assert.equal(t.summary.runtimeProofs.length, 1);
    assert.equal(Object.keys(t.summary.runtimeProofs[0].containers).length, 8);
    assert.equal(f.calls.some(c => c[0] === 'exec' && c.at(-1).includes('ALLOW_REAL_MODEL')), true);
    const r = await t.cleanup(); assert.equal(r.stoppedAndVerified, true);
    assert.equal([...f.states.values()].every(s => !s.State.Running), true);
    assert.equal(f.calls.filter(c => c[0] === 'stop').length, 8);
    assert.equal(f.calls.some(c => ['rm', 'prune', 'down', 'rmi'].includes(c[0])), false);
  } finally { f.cleanup(); }
});
for (const mode of ['foreign-project', 'wrong-image', 'wrong-binding', 'model-enabled']) test('runtime ' + mode + ' cannot start HTTP-consuming child steps', async () => {
  const f = targetFixture();
  try {
    const t = await started(f), registry = [...f.states.values()].find(s => s.Labels['com.docker.compose.service'] === 'registry');
    if (mode === 'foreign-project') registry.Labels['com.docker.compose.project'] = 'releaseguard-team13';
    if (mode === 'wrong-image') registry.Image = 'sha256:' + 'd'.repeat(64);
    if (mode === 'wrong-binding') [...f.states.values()].find(s => s.Labels['com.docker.compose.service'] === 'gateway').Ports['8080/tcp'][0].HostPort = '5193';
    if (mode === 'model-enabled') f.engine.modelDisabled = false;
    await assert.rejects(t.beforeStep({ name: 'integration' }));
    assert.equal(f.calls.some(c => c[0] === 'stop'), false);
  } finally { f.cleanup(); }
});
test('retagging a shared application image alias is detected before another child command', async () => {
  const f = targetFixture();
  try { const t = await started(f); f.aliases.set('releaseguard-course-v2:local', 'sha256:' + 'd'.repeat(64)); await assert.rejects(t.beforeStep({ name: 'integration' })); }
  finally { f.cleanup(); }
});
test('engine identity changes stop later commands rather than adopting a new daemon', async () => {
  const f = targetFixture();
  try { const t = await started(f); f.engine.id = 'another-engine'; await assert.rejects(t.beforeStep({ name: 'integration' })); }
  finally { f.cleanup(); }
});
test('unknown mutating child result stays unverified even when observed containers can be stopped', async () => {
  const f = targetFixture();
  try { const t = await started(f); t.observeOutcome({ name: 'integration' }, { status: null, error: { code: 'ETIMEDOUT' } });
    assert.equal((await t.cleanup()).stoppedAndVerified, false); assert.equal(t.summary.unknownMutation, true);
    assert.equal([...f.states.values()].every(s => !s.State.Running), true);
  } finally { f.cleanup(); }
});
test('cleanup refuses foreign containers instead of stopping a classroom or another task', async () => {
  const f = targetFixture();
  try { const t = await started(f); [...f.states.values()][0].Labels['com.docker.compose.project'] = 'releaseguard-team13';
    await assert.rejects(t.cleanup()); assert.equal(f.calls.some(c => c[0] === 'stop'), false);
  } finally { f.cleanup(); }
});
test('original work deadline expiry does not remove the separate bounded cleanup budget', async () => {
  const f = targetFixture();
  try { const t = await started(f); f.engine.expired = true;
    assert.equal((await t.cleanup()).stoppedAndVerified, true);
    assert.equal(f.calls.filter(c => c[0] === 'stop').length, 8);
  } finally { f.cleanup(); }
});
test('comparison compatibility inputs are created only after runtime proof and bind this run source/image/workspace', async () => {
  const f = targetFixture();
  try { const t = await started(f); await t.beforeStep({ name: 'prompt-replay' });
    const c = JSON.parse(fs.readFileSync(t.env.RG_COMPARISON_CONFIG_FILE)), a = JSON.parse(fs.readFileSync(t.env.RG_COMPARISON_AUTH_FILE));
    assert.equal(c.targetKind, 'isolated-acceptance'); assert.equal(c.source, 'replay'); assert.equal(c.suiteRevision, 'legacy');
    assert.equal(c.image, f.ids.app); assert.equal(c.commit, 'a'.repeat(40)); assert.equal(c.workspace, 'comparison-' + f.options.runId);
    assert.equal(c.modelRequestBudget, 0); assert.equal(a.secret, '1'.repeat(64)); assert.equal(a.subject, 'comparison-local-acceptance');
    assert.equal(fs.statSync(t.env.RG_COMPARISON_AUTH_FILE).mode & 0o777, 0o600);
    assert.equal(t.env.RG_COMPARISON_ACCEPTANCE_RUN_ID, f.options.runId);
    assert.doesNotMatch(JSON.stringify(t.summary), /1111111111111111111111111111111111111111111111111111111111111111/);
  } finally { f.cleanup(); }
});
