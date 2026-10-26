import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { needsRetainedRollback } from '../scripts/rollback-ci-scope.mjs';
for (const path of ['src/governance.ts', 'src/worker.ts', 'src/registry.ts', 'scripts/verify-rollback.mjs', 'scripts/rollback-artifacts.mjs',
  'scripts/image-identity.mjs', 'scripts/contract-target.mjs', 'compose.yaml', 'package-lock.json', 'Dockerfile', '.github/workflows/ci.yml', 'tests/rollback-flow.test.mjs']) {
  test('backend or rollback-affecting change cannot skip the real fixture: ' + path, () => assert.equal(needsRetainedRollback([path]), true));
}
test('unrelated frontend/operator/document changes do not depend on a historical fixture expiry', () => {
  assert.equal(needsRetainedRollback(['public/app.js', 'scripts/provider-smoke.mjs', 'README.md']), false);
  assert.equal(needsRetainedRollback([]), false);
});

function repo(t) {
  const dir = mkdtempSync(join(tmpdir(), 'rg-rollback-scope-'));
  t.after(() => { assert.match(basename(dir), /^rg-rollback-scope-/); rmSync(dir, { recursive: true, force: true }); });
  const hooks = join(dir, 'empty-hooks'); mkdirSync(hooks);
  const config = join(dir, 'empty-gitconfig'); writeFileSync(config, '');
  const gitEnvironment = { PATH: process.env.PATH, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_SYSTEM: config, GIT_TERMINAL_PROMPT: '0', ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) };
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Synthetic offline fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=' + hooks, '-c', 'commit.gpgsign=false', ...args], { cwd: dir, env: gitEnvironment, encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init'); writeFileSync(join(dir, 'README.md'), 'synthetic baseline'); git('add', '.'); git('commit', '-m', 'synthetic base');
  const output = join(dir, 'output'); writeFileSync(output, 'retained=yes\n');
  const execute = (source, changes = {}) => spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/rollback-ci-scope.mjs', import.meta.url))], {
    cwd: dir, env: { ...gitEnvironment, GITHUB_SHA: source, GITHUB_OUTPUT: output, GITHUB_EVENT_NAME: 'pull_request', ...changes }, encoding: 'utf8', timeout: 10000,
  });
  return { dir, git, execute, output };
}
test('actual CLI selects a changed backend file from real Git history', t => {
  const f = repo(t); mkdirSync(join(f.dir, 'src')); writeFileSync(join(f.dir, 'src/governance.ts'), 'synthetic backend');
  f.git('add', 'src/governance.ts'); f.git('commit', '-m', 'synthetic backend change');
  const r = f.execute(f.git('rev-parse', 'HEAD')); assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(f.output, 'utf8'), 'retained=yes\nrequired=true\n');
});
test('actual CLI leaves the old fixture out of an unrelated revision', t => {
  const f = repo(t); writeFileSync(join(f.dir, 'README.md'), 'synthetic unrelated change'); f.git('add', 'README.md'); f.git('commit', '-m', 'synthetic unrelated change');
  const r = f.execute(f.git('rev-parse', 'HEAD')); assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(f.output, 'utf8'), 'retained=yes\nrequired=false\n');
});
test('missing history fails instead of emitting a misleading skip', t => {
  const f = repo(t), r = f.execute(f.git('rev-parse', 'HEAD'));
  assert.notEqual(r.status, 0); assert.equal(readFileSync(f.output, 'utf8'), 'retained=yes\n');
});
test('a mismatching source is refused before a selection output is written', t => {
  const f = repo(t), r = f.execute('a'.repeat(40)); assert.notEqual(r.status, 0);
  assert.match(r.stderr, /checkout\/source mismatch/); assert.equal(readFileSync(f.output, 'utf8'), 'retained=yes\n');
});
test('a multi-commit push includes an earlier backend change even when the last commit is unrelated', t => {
  const f = repo(t), before = f.git('rev-parse', 'HEAD');
  mkdirSync(join(f.dir, 'src')); writeFileSync(join(f.dir, 'src/governance.ts'), 'synthetic backend');
  f.git('add', 'src'); f.git('commit', '-m', 'backend before final commit');
  writeFileSync(join(f.dir, 'README.md'), 'unrelated final commit'); f.git('add', 'README.md'); f.git('commit', '-m', 'unrelated final commit');
  const r = f.execute(f.git('rev-parse', 'HEAD'), { GITHUB_EVENT_NAME: 'push', RG_CI_BEFORE_SHA: before });
  assert.equal(r.status, 0, r.stderr); assert.equal(readFileSync(f.output, 'utf8'), 'retained=yes\nrequired=true\n');
});
test('a manual full verification or first push cannot silently skip the retained-image drill', t => {
  const f = repo(t), source = f.git('rev-parse', 'HEAD');
  const r = f.execute(source, { GITHUB_EVENT_NAME: 'workflow_dispatch' }); assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(f.output, 'utf8'), 'retained=yes\nrequired=true\n');
  writeFileSync(f.output, 'retained=yes\n');
  const first = f.execute(source, { GITHUB_EVENT_NAME: 'push', RG_CI_BEFORE_SHA: '0'.repeat(40) }); assert.equal(first.status, 0, first.stderr);
  assert.equal(readFileSync(f.output, 'utf8'), 'retained=yes\nrequired=true\n');
});
