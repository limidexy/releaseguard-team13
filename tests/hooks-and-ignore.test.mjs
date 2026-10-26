import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, delimiter, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const source = fileURLToPath(new URL('../', import.meta.url));
const find = name => execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', [name], { encoding: 'utf8' }).trim().split(/\r?\n/)[0];
function fixture(t, exitCode = 0) {
  const tmp = mkdtempSync(join(tmpdir(), 'rg-hook-')), repo = join(tmp, 'repo');
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  mkdirSync(join(repo, 'scripts'), { recursive: true }); mkdirSync(join(repo, '.githooks'));
  const empty = join(tmp, 'empty-config'), emptyGlobal = join(tmp, 'empty-global');
  writeFileSync(empty, ''); writeFileSync(emptyGlobal, '');
  const env = {
    PATH: [dirname(process.execPath), dirname(find('npm')), dirname(find('git')),
      ...(process.platform === 'win32' ? [join(process.env.SystemRoot, 'System32')] : ['/usr/bin', '/bin'])].join(delimiter),
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: empty, GIT_TEMPLATE_DIR: join(tmp, 'empty-template'), GIT_TERMINAL_PROMPT: '0',
    npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false',
    npm_config_cache: join(tmp, 'npm-cache'), npm_config_userconfig: empty, npm_config_globalconfig: emptyGlobal,
    CI: 'true', ALLOW_REAL_MODEL: 'false', RG_HOOK_FIXTURE_ROOT: repo,
  };
  for (const name of ['SystemRoot', 'ComSpec', 'COMSPEC', 'SYSTEMDRIVE', 'PATHEXT', 'TEMP', 'TMP']) if (process.env[name]) env[name] = process.env[name];
  mkdirSync(env.GIT_TEMPLATE_DIR);
  const git = args => spawnSync('git', args, { cwd: repo, env, encoding: 'utf8', timeout: 10000 });
  assert.equal(git(['init', '--quiet']).status, 0);
  for (const name of ['prepush.mjs', 'npm-command.mjs']) copyFileSync(join(source, 'scripts', name), join(repo, 'scripts', name));
  const hook = join(repo, '.githooks/pre-push');
  if (existsSync(join(source, '.githooks/pre-push'))) { copyFileSync(join(source, '.githooks/pre-push'), hook); chmodSync(hook, 0o755); }
  copyFileSync(join(source, '.gitignore'), join(repo, '.gitignore'));
  const preload = join(repo, 'boundary.mjs'); copyFileSync(join(source, 'tests/fixtures/prepush-offline-boundary.mjs'), preload);
  writeFileSync(join(repo, 'package.json'), '{"name":"owned-hook-offline-fixture","private":true,"type":"module","scripts":{"test":"node unit.mjs"}}');
  writeFileSync(join(repo, 'unit.mjs'), `import { appendFileSync } from 'node:fs'; appendFileSync('unit-count.txt','1\\n'); console.error('Controlled offline unit exit ${exitCode}'); process.exit(${exitCode});\n`);
  writeFileSync(join(repo, '.env.example'), 'ALLOW_REAL_MODEL=false\n');
  for (const args of [['add', '.'], ['-c', 'user.name=Offline Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=' + join(tmp, 'no-hooks'), 'commit', '--quiet', '-m', 'Synthetic fixture only']]) {
    const r = git(args); assert.equal(r.status, 0, r.stderr);
  }
  // The absolute preload follows the hook's Node process into npm and its unit child.
  const guarded = { ...env, NODE_OPTIONS: '--import=' + JSON.stringify(pathToFileURL(preload).href) };
  function invoke(cwd = repo, active = true) {
    return spawnSync('git', [...(active ? ['-c', 'core.hooksPath=.githooks'] : []), 'hook', 'run', 'pre-push'], {
      cwd, env: guarded, encoding: 'utf8', timeout: 30000,
    });
  }
  return { tmp, repo, env, guarded, git, invoke, config: join(repo, '.git/config'), marker: join(repo, 'forbidden-boundary') };
}
function unitCount(f) { return existsSync(join(f.repo, 'unit-count.txt')) ? readFileSync(join(f.repo, 'unit-count.txt'), 'utf8').trim().split('\n').length : 0; }
function assertNoBoundary(f, r) {
  assert.equal(r.error, undefined);
  assert.equal(existsSync(f.marker), false, 'no network, cloud, Docker or extra command may be reached');
  assert.doesNotMatch(r.stdout + r.stderr, /BOUNDARY_ATTEMPT:/);
}
test('a fresh checkout does not enable the optional hook or change Git configuration', t => {
  const f = fixture(t), before = readFileSync(f.config);
  assert.equal(f.git(['config', '--local', '--get', 'core.hooksPath']).status, 1);
  const result = f.invoke(f.repo, false);
  assert.notEqual(result.status, 0); assert.equal(unitCount(f), 0); assertNoBoundary(f, result);
  assert.deepEqual(readFileSync(f.config), before);
});
for (const exitCode of [0, 23]) test('Git invokes the real optional hook and preserves unit exit ' + exitCode, t => {
  const f = fixture(t, exitCode), before = readFileSync(f.config);
  const result = f.invoke(); assertNoBoundary(f, result);
  assert.equal(result.status, exitCode === 0 ? 0 : 1, result.stderr);
  assert.equal(unitCount(f), 1);
  const report = JSON.parse(readFileSync(join(f.repo, 'evidence/git/pre-push.json'), 'utf8'));
  assert.equal(report.unitExitCode, exitCode); assert.equal(report.startError, null); assert.equal(report.hostedCI, false);
  if (exitCode) assert.match(result.stderr, /exited with 23/);
  assert.deepEqual(readFileSync(f.config), before, 'per-invocation opt-in must not persist into local/global configuration');
});
test('Git normalizes a subdirectory invocation to the fixture repository root', t => {
  const f = fixture(t), subdir = join(f.repo, 'subdir'); mkdirSync(subdir);
  const result = f.invoke(subdir); assertNoBoundary(f, result);
  assert.equal(result.status, 0, result.stderr); assert.equal(unitCount(f), 1);
});
for (const [name, path, value] of [
  ['tracked local env', '.env.groq', 'MODEL_API_KEY=synthetic-not-used'],
  ['tracked SSH key file', 'id_ed25519', 'synthetic-not-a-real-key'],
  ['token pattern in code', 'unsafe.mjs', 'gsk_' + 'A'.repeat(40)],
]) test('optional hook blocks ' + name + ' before npm, without printing the value', t => {
  const f = fixture(t); writeFileSync(join(f.repo, path), value);
  assert.equal(f.git(['add', '-f', '--', path]).status, 0);
  const result = f.invoke(); assertNoBoundary(f, result);
  assert.equal(result.status, 1); assert.equal(unitCount(f), 0);
  assert.match(result.stderr, /Push blocked: sensitive files\/patterns/);
  assert.ok(!(result.stdout + result.stderr).includes(value));
  assert.equal(existsSync(join(f.repo, 'evidence/git/pre-push.json')), false);
});
test('missing Node fails closed without changing configuration or starting checks', t => {
  const f = fixture(t), before = readFileSync(f.config);
  // The hook sees only an empty executable path, not the developer's PATH.
  // Call Git by its absolute path so failure is at the real hook, not test startup.
  const bin = join(f.tmp, 'empty-bin'); mkdirSync(bin);
  const result = spawnSync(find('git'), ['-c', 'core.hooksPath=.githooks', 'hook', 'run', 'pre-push'], {
    cwd: f.repo, env: { ...f.guarded, PATH: bin }, encoding: 'utf8', timeout: 10000,
  });
  assert.notEqual(result.status, 0); assert.equal(unitCount(f), 0); assertNoBoundary(f, result);
  assert.match(result.stderr, /node.*(?:not found|no such file|not recognized)|(?:not found|no such file|not recognized).*node/i);
  assert.deepEqual(readFileSync(f.config), before);
});
test('credential and generated output patterns are ignored, project sources remain visible', t => {
  const f = fixture(t);
  const ignored = ['gha-creds-fixture.json', 'nested/gha-creds-fixture.json', '.env', '.env.groq', 'node_modules/package/index.js', 'dist/src/main.js', 'evidence/current/result.json', 'evidence/private/token.json', 'nested/evidence/private/token.json', 'deploy/k8s/rendered/services.yaml', '.DS_Store', 'recording.zip', 'check.log'];
  const visible = ['.env.example', 'src/provider.ts', 'tests/hooks-and-ignore.test.mjs', '.githooks/pre-push', '.github/workflows/ci.yml', 'deploy/gcp/worker-autoscale.yaml', 'deploy/postgres/init.sh', 'deploy/k8s/base/services.yaml'];
  for (const path of ignored) assert.equal(f.git(['check-ignore', '--no-index', '-q', '--', path]).status, 0, path + ' must be ignored');
  for (const path of visible) assert.equal(f.git(['check-ignore', '--no-index', '-q', '--', path]).status, 1, path + ' must remain visible');
});
test('new ignore rules retain existing tracked evidence and exact original bytes', t => {
  const f = fixture(t), originals = ['evidence/retained.json', 'deploy/k8s/rendered/retained.yaml', 'docs/evidence/retained.log'];
  // Stage original content under the old rules, then apply the new ignore file.
  writeFileSync(join(f.repo, '.gitignore'), '');
  for (const path of originals) {
    mkdirSync(dirname(join(f.repo, path)), { recursive: true }); writeFileSync(join(f.repo, path), 'original:' + path + '\n');
    assert.equal(f.git(['add', '--', path]).status, 0);
  }
  copyFileSync(join(source, '.gitignore'), join(f.repo, '.gitignore'));
  const result = f.invoke(); assertNoBoundary(f, result); assert.equal(result.status, 0, result.stderr);
  const tracked = f.git(['ls-files', '-z']).stdout.split('\0');
  for (const path of originals) { assert.ok(tracked.includes(path)); assert.equal(readFileSync(join(f.repo, path), 'utf8'), 'original:' + path + '\n'); }
  assert.equal(f.git(['diff', '--name-only', '--diff-filter=D']).stdout, '');
});
for (const [name, code] of [
  ['fetch', "fetch('https://example.invalid').catch(()=>{process.exitCode=1})"],
  ['TCP', "import('node:net').then(net=>net.connect(5193,'127.0.0.1'))"],
  ['process', "import('node:child_process').then(cp=>cp.execFileSync('docker',['version']))"],
]) test('offline fixture hard boundary rejects ' + name + ' before any target access', t => {
  const f = fixture(t);
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: f.repo, env: f.guarded, encoding: 'utf8', timeout: 10000 });
  assert.notEqual(result.status, 0); assert.equal(existsSync(f.marker), true); assert.match(result.stderr, /BOUNDARY_ATTEMPT:/);
});
