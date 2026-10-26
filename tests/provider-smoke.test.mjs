import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repo = fileURLToPath(new URL('../', import.meta.url));
const preload = join(repo, 'tests/fixtures/provider-smoke-boundary.mjs');
const key = 'OFFLINE_FAKE_KEY_NOT_A_REAL_CREDENTIAL_123';
const question = 'I bought an unused item 10 days ago and have the receipt. Can I return it?';
async function fixture(t, sentinel = false) {
  const root = await mkdtemp(join(tmpdir(), 'rg-provider-smoke-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const dir of ['scripts', 'dist/src']) await mkdir(join(root, dir), { recursive: true });
  await writeFile(join(root, 'package.json'), '{"type":"module"}');
  await copyFile(join(repo, 'scripts/provider-smoke.mjs'), join(root, 'scripts/provider-smoke.mjs'));
  if (sentinel) await writeFile(join(root, 'dist/src/provider.js'), 'export const providerAnswer=()=>{}; export const promptSnapshot=()=>{}; console.error("BOUNDARY_ATTEMPT:provider-import"); throw Error("provider import before guards");');
  else for (const name of ['provider.js', 'provider-lifecycle.js']) await copyFile(join(repo, 'dist/src', name), join(root, 'dist/src', name));
  await writeFile(join(root, '.env.groq'), 'MODEL_API_KEY=' + key + '\n', { mode: 0o600 });
  const id = randomUUID();
  return { root, id, dir: join(root, 'evidence/private/provider-smoke', id) };
}
function args(f) { return ['--import', preload, join(f.root, 'scripts/provider-smoke.mjs')]; }
function environment(f, mode, changes = {}) {
  return { RG_CONFIRM_REAL_CALLS: '1', RG_CONFIRM_PROVIDER_BUDGET: '1', RG_PROVIDER_SMOKE_RUN_ID: f.id, RG_SMOKE_FIXTURE_ROOT: f.root, RG_SMOKE_FIXTURE_MODE: mode, ...changes };
}
function run(f, mode = 'success', changes = {}) {
  const result = spawnSync(process.execPath, args(f), { cwd: tmpdir(), env: environment(f, mode, changes), encoding: 'utf8', timeout: 10000 });
  assert.equal(result.error, undefined);
  return result;
}
async function count(f) { return (await readFile(join(f.root, 'fake-transport-count.txt'), 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).length; }
async function terminal(f) { return JSON.parse(await readFile(join(f.dir, 'terminal.json'), 'utf8')); }
async function files(root) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  return (await Promise.all(entries.map(async e => e.isDirectory() ? files(join(root, e.name)) : e.isFile() ? [join(root, e.name)] : []))).flat();
}
async function noLeak(f, result) {
  assert.doesNotMatch(result.stdout + result.stderr, /OFFLINE_FAKE_KEY|Synthetic private provider|Private error body/);
  for (const path of await files(join(f.root, 'evidence'))) assert.ok(!(await readFile(path, 'utf8')).includes(key), path);
}
for (const [name, changes] of [
  ['missing explicit real-call opt-in', { RG_CONFIRM_REAL_CALLS: '' }],
  ['missing separate budget acknowledgement', { RG_CONFIRM_PROVIDER_BUDGET: '' }],
  ['missing stable run ID', { RG_PROVIDER_SMOKE_RUN_ID: '' }],
  ['path instead of UUID', { RG_PROVIDER_SMOKE_RUN_ID: '../other' }],
  ['noncanonical uppercase UUID alias', { RG_PROVIDER_SMOKE_RUN_ID: '12345678-ABCD-4ABC-8ABC-123456789ABC' }],
  ['GitHub Actions', { GITHUB_ACTIONS: 'true' }],
  ['generic CI', { CI: 'true' }],
]) test('smoke CLI blocks ' + name + ' before provider import or credential access', async t => {
  const f = await fixture(t, true), result = run(f, 'guard', changes);
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout + result.stderr, /BOUNDARY_ATTEMPT:/);
  assert.equal(await count(f), 0);
  assert.equal((await files(join(f.root, 'evidence'))).length, 0);
});
test('valid offline transport preserves request and extraction, without claiming semantics or Free verification', async t => {
  const f = await fixture(t), result = run(f);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await count(f), 1);
  const request = JSON.parse(await readFile(join(f.dir, 'request.json'), 'utf8'));
  assert.equal(request.body.messages[1].content, question);
  assert.equal(request.body.messages[0].content, (await import('../dist/src/provider.js')).promptSnapshot('v2').text);
  assert.equal(request.body.max_completion_tokens, 1536);
  assert.equal(request.body.model, 'openai/gpt-oss-20b');
  assert.equal(request.headers, undefined);
  const raw = JSON.parse(await readFile(join(f.dir, 'extraction.json'), 'utf8'));
  assert.equal(raw.output, ' \nOriginal synthetic answer. \n');
  assert.equal(raw.metadata.usage.total_tokens, 13);
  const report = await terminal(f);
  assert.equal(report.outcome, 'protocol_success');
  assert.equal(report.semanticResult, 'not_evaluated');
  assert.equal(report.freeEligibility, 'not_verified_by_this_tool');
  assert.equal(report.reservedRequests, 1); assert.equal(report.transportInvocations, 1);
  assert.equal(report.responseObserved, true);
  assert.equal(report.score, undefined);
  assert.ok(Number.isFinite(report.latencyMs) && report.latencyMs >= 0);
  if (process.platform !== 'win32') {
    assert.equal((await stat(f.dir)).mode & 0o777, 0o700);
    for (const path of await files(f.dir)) assert.equal((await stat(path)).mode & 0o777, 0o600);
  }
  await noLeak(f, result);
});
for (const [mode, outcome, responseObserved] of [
  ['http429', 'provider_http_error', true],
  ['network-unknown', 'response_unconfirmed', false],
  ['invalid-json', 'protocol_failure', true],
  ['length', 'protocol_failure', true],
  ['credential-echo', 'credential_echo_withheld', true],
]) test('smoke CLI stops once on ' + mode + ', never leaks or repairs output', async t => {
  const f = await fixture(t), result = run(f, mode);
  assert.notEqual(result.status, 0); assert.equal(await count(f), 1);
  const report = await terminal(f);
  assert.equal(report.outcome, outcome); assert.equal(report.transportInvocations, 1);
  assert.equal(report.responseObserved, responseObserved); assert.equal(report.semanticResult, 'not_evaluated');
  if (mode === 'http429') assert.equal(report.httpStatus, 429);
  if (mode === 'length') assert.equal(JSON.parse(await readFile(join(f.dir, 'extraction.json'), 'utf8')).output, ' \nOriginal synthetic answer. \n');
  if (mode === 'credential-echo') assert.ok(!(await files(f.dir)).some(p => p.endsWith('extraction.json')));
  await noLeak(f, result);
  const before = await Promise.all((await files(f.dir)).map(async path => [path, await readFile(path, 'utf8')]));
  const again = run(f, 'guard');
  assert.notEqual(again.status, 0); assert.equal(await count(f), 1);
  assert.doesNotMatch(again.stdout + again.stderr, /BOUNDARY_ATTEMPT:/);
  for (const [path, content] of before) assert.equal(await readFile(path, 'utf8'), content);
});
test('reserved or interrupted run without terminal blocks before imports and credentials', async t => {
  const f = await fixture(t, true);
  await mkdir(f.dir, { recursive: true });
  await writeFile(join(f.dir, 'attempt.json'), '{"status":"started","result":"unknown"}');
  const result = run(f, 'guard');
  assert.notEqual(result.status, 0); assert.equal(await count(f), 0);
  assert.doesNotMatch(result.stdout + result.stderr, /BOUNDARY_ATTEMPT:/);
  assert.equal(await readFile(join(f.dir, 'attempt.json'), 'utf8'), '{"status":"started","result":"unknown"}');
});
test('ledger ancestor symlink is rejected without touching target', async t => {
  const f = await fixture(t, true), target = join(f.root, 'unrelated');
  await mkdir(target); await mkdir(join(f.root, 'evidence'));
  await symlink(target, join(f.root, 'evidence/private'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = run(f, 'guard');
  assert.notEqual(result.status, 0); assert.equal(await count(f), 0); assert.deepEqual(await readdir(target), []);
  assert.doesNotMatch(result.stdout + result.stderr, /BOUNDARY_ATTEMPT:/);
});
test('credential symlink is rejected and the reserved ID cannot be retried', async t => {
  const f = await fixture(t);
  await rm(join(f.root, '.env.groq'));
  await writeFile(join(f.root, 'dummy-owned-secret'), 'MODEL_API_KEY=' + key);
  await symlink(join(f.root, 'dummy-owned-secret'), join(f.root, '.env.groq'));
  const result = run(f);
  assert.notEqual(result.status, 0); assert.equal(await count(f), 0);
  assert.equal((await terminal(f)).outcome, 'not_sent');
  assert.notEqual(run(f, 'guard').status, 0);
  await noLeak(f, result);
});
test('persist failure before transport reserves the ID and prevents any send or retry', async t => {
  const f = await fixture(t), result = run(f, 'attempt-sync-failure');
  assert.notEqual(result.status, 0); assert.equal(await count(f), 0);
  const report = await terminal(f);
  assert.equal(report.outcome, 'not_sent'); assert.equal(report.transportInvocations, 0);
  assert.equal(report.reservedRequests, 1);
  assert.notEqual(run(f, 'guard').status, 0); assert.equal(await count(f), 0);
  await noLeak(f, result);
});
test('missing compiled provider fails before credential access and consumes only this ID', async t => {
  const f = await fixture(t);
  await rm(join(f.root, 'dist/src/provider.js'));
  const result = run(f, 'guard');
  assert.notEqual(result.status, 0); assert.equal(await count(f), 0);
  assert.equal((await terminal(f)).outcome, 'not_sent');
  assert.doesNotMatch(result.stdout + result.stderr, /BOUNDARY_ATTEMPT:/);
});
test('extraction persistence failure is not misreported as provider protocol success', async t => {
  const f = await fixture(t), result = run(f, 'extraction-sync-failure');
  assert.notEqual(result.status, 0); assert.equal(await count(f), 1);
  const report = await terminal(f);
  assert.equal(report.outcome, 'evidence_persistence_failure');
  assert.equal(report.failurePhase, 'extraction_persistence');
  assert.equal(report.transportInvocations, 1);
  assert.equal(JSON.parse(await readFile(join(f.dir, 'extraction.json'), 'utf8')).output, ' \nOriginal synthetic answer. \n');
  assert.notEqual(run(f, 'guard').status, 0); assert.equal(await count(f), 1);
  await noLeak(f, result);
});
test('existing terminal is never overwritten, even after an observed response', async t => {
  const f = await fixture(t), result = run(f, 'terminal-collision');
  assert.notEqual(result.status, 0); assert.equal(await count(f), 1);
  assert.equal(await readFile(join(f.dir, 'terminal.json'), 'utf8'), 'retained-original-terminal\n');
  assert.match(result.stderr, /persistence failed/);
  assert.notEqual(run(f, 'guard').status, 0); assert.equal(await count(f), 1);
  await noLeak(f, result);
});
test('future duplicate provider invocation cannot invoke a second transport', async t => {
  const f = await fixture(t);
  await copyFile(join(f.root, 'dist/src/provider.js'), join(f.root, 'dist/src/real-provider.js'));
  await writeFile(join(f.root, 'dist/src/provider.js'), `import * as actual from './real-provider.js';
export const promptSnapshot = actual.promptSnapshot;
export async function providerAnswer(...args) { await actual.providerAnswer(...args); return actual.providerAnswer(...args); }`);
  const result = run(f);
  assert.notEqual(result.status, 0); assert.equal(await count(f), 1);
  assert.equal((await terminal(f)).outcome, 'protocol_failure');
  await noLeak(f, result);
});
test('two concurrent processes with one ID invoke the fake transport at most once', async t => {
  const f = await fixture(t);
  const results = await Promise.all([1, 2].map(() => new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, args(f), { cwd: tmpdir(), env: environment(f, 'success'), stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => proc.kill('SIGKILL'), 10000);
    let output = ''; proc.stdout.on('data', b => { output += b; }); proc.stderr.on('data', b => { output += b; });
    proc.once('error', reject); proc.once('close', code => { clearTimeout(timer); resolve({ code, output }); });
  })));
  assert.deepEqual(results.map(r => r.code).sort(), [0, 1]);
  assert.equal(await count(f), 1);
  assert.ok(results.every(r => !r.output.includes(key) && !r.output.includes('BOUNDARY_ATTEMPT:')));
});
