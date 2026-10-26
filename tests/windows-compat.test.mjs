import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { npmSpawn, spawnFailure } from '../scripts/npm-command.mjs';

// D-04: npm.cmd cannot be spawned without a shell on Windows (Node CVE-2024-27980 hardening).
test('npmSpawn starts npm.cmd through the shell on Windows with one fixed command line', () => {
  const run = npmSpawn(['test'], { stdio: 'inherit', timeout: 1 }, 'win32');
  assert.equal(run.command, 'npm.cmd test');
  assert.deepEqual(run.args, []);
  assert.equal(run.options.shell, true);
  assert.equal(run.options.timeout, 1);
});

test('npmSpawn runs npm directly elsewhere and keeps the caller options', () => {
  const run = npmSpawn(['audit', '--audit-level=high', '--json'], { encoding: 'utf8' }, 'linux');
  assert.equal(run.command, 'npm');
  assert.deepEqual(run.args, ['audit', '--audit-level=high', '--json']);
  assert.equal(run.options.shell, undefined);
});

test('npmSpawn rejects arguments that a shell could interpret', () => {
  for (const bad of ['test & del x', 'a|b', '"quoted"', '$(x)', '', 'a b']) assert.throws(() => npmSpawn([bad], {}, 'win32'));
});

test('spawnFailure explains a start failure instead of failing silently', () => {
  const error = Object.assign(new Error('spawnSync npm.cmd EINVAL'), { code: 'EINVAL' });
  assert.equal(spawnFailure('npm test', { error, status: null }), 'npm test: could not start (EINVAL): spawnSync npm.cmd EINVAL');
  assert.equal(spawnFailure('npm test', { status: 1 }), 'npm test: exited with 1');
  assert.equal(spawnFailure('npm test', { status: 0 }), null);
});

test('npm actually starts on this platform through npmSpawn', () => {
  const run = npmSpawn(['--version'], { encoding: 'utf8', timeout: 60000 });
  const result = spawnSync(run.command, run.args, run.options);
  assert.equal(spawnFailure('npm --version', result), null);
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+/);
});

// D-03: shell scripts and Git hooks must be checked out with LF even when core.autocrlf=true.
test('.gitattributes pins shell scripts and Git hooks to LF', () => {
  for (const file of ['deploy/postgres/init.sh', '.githooks/pre-push']) {
    const attr = execFileSync('git', ['check-attr', 'eol', '--', file], { encoding: 'utf8' }).trim();
    assert.equal(attr, `${file}: eol: lf`);
  }
});
