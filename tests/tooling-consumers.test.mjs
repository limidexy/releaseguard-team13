import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const findCommand = name => execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', [name], { encoding: 'utf8' }).trim().split(/\r?\n/)[0];

function fixture(script) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'rg-tooling-consumer-'));
  const repo = path.join(tmp, 'repo'), bin = path.join(tmp, 'bin');
  mkdirSync(path.join(repo, 'scripts'), { recursive: true }); mkdirSync(bin);
  const marker = path.join(tmp, 'forbidden-command');
  const emptyConfig = path.join(tmp, 'empty-config'), emptyGlobal = path.join(tmp, 'empty-global');
  writeFileSync(emptyConfig, ''); writeFileSync(emptyGlobal, '');
  writeFileSync(path.join(repo, 'package.json'), JSON.stringify({
    name: 'releaseguard-offline-tooling-fixture', private: true, type: 'module',
    scripts: { test: 'node reject-test.mjs' },
  }));
  writeFileSync(path.join(repo, 'reject-test.mjs'), "console.error('Controlled offline unit failure'); process.exit(23);\n");
  writeFileSync(path.join(repo, '.env'), 'ALLOW_REAL_MODEL=false\n');
  for (const file of [script, 'npm-command.mjs']) writeFileSync(path.join(repo, 'scripts', file), readFileSync(path.join('scripts', file)));
  // No real Docker or other service can be reached if a fail-fast regression occurs.
  writeFileSync(path.join(bin, 'docker'), '#!' + process.execPath + '\n' +
    "require('node:fs').writeFileSync(process.env.RG_FORBIDDEN_COMMAND_MARKER,'called');process.exit(97);\n", { mode: 0o755 });
  writeFileSync(path.join(bin, 'docker.cmd'), '@echo off\r\necho called>"%RG_FORBIDDEN_COMMAND_MARKER%"\r\nexit /b 97\r\n');
  const env = {
    PATH: [bin, path.dirname(process.execPath), path.dirname(findCommand('npm')), path.dirname(findCommand('git')),
      ...(process.platform === 'win32' ? [path.join(process.env.SystemRoot, 'System32')] : ['/usr/bin', '/bin'])].join(path.delimiter),
    CI: 'true', ALLOW_REAL_MODEL: 'false', RELEASEGUARD_URL: 'http://127.0.0.1:1',
    DOCKER_HOST: 'tcp://127.0.0.1:1', RG_FORBIDDEN_COMMAND_MARKER: marker,
    npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false',
    npm_config_cache: path.join(tmp, 'npm-cache'), npm_config_userconfig: emptyConfig, npm_config_globalconfig: emptyGlobal,
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyConfig,
  };
  for (const key of ['SystemRoot', 'ComSpec', 'COMSPEC', 'SYSTEMDRIVE', 'PATHEXT', 'TEMP', 'TMP']) if (process.env[key]) env[key] = process.env[key];
  const git = args => execFileSync('git', args, { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
  git(['init', '--quiet']);
  git(['add', 'package.json', 'reject-test.mjs', 'scripts']);
  git(['-c', 'user.name=Offline Test Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false',
    '-c', 'core.hooksPath=' + path.join(tmp, 'no-hooks'), 'commit', '--quiet', '-m', 'Synthetic local fixture only']);
  return { tmp, repo, env, marker };
}

for (const script of ['acceptance.mjs', 'prepush.mjs']) {
  test(script + ' actually starts npm and preserves its failure without running any later service command', () => {
    let f;
    try {
      f = fixture(script);
      const result = spawnSync(process.execPath, [path.join('scripts', script)], {
        cwd: f.repo, env: f.env, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024,
      });
      assert.equal(result.error, undefined, 'the isolated consumer process must start and finish');
      assert.equal(result.status, 1, 'a rejected unit gate must keep the consumer unsuccessful');
      assert.ok(!existsSync(f.marker), 'no Docker/service command may run after the failed unit gate');
      assert.match(result.stderr, /exited with 23/, 'the real npm exit must be reported, not an EINVAL/ENOENT start error');
      const file = script === 'acceptance.mjs' ? 'evidence/current/acceptance.json' : 'evidence/git/pre-push.json';
      const report = JSON.parse(readFileSync(path.join(f.repo, file), 'utf8'));
      if (script === 'acceptance.mjs') {
        assert.equal(report.steps.length, 1);
        assert.equal(report.steps[0].exitCode, 23);
        assert.equal(report.steps[0].error, null);
        assert.equal(report.allPlannedLocalStepsPassed, false);
        assert.equal(report.sourceUnchangedDuringRun, true);
        assert.equal(report.cloudDeployed, false);
        assert.equal(report.realModelExecuted, false);
      } else {
        assert.equal(report.unitExitCode, 23);
        assert.equal(report.startError, null);
        assert.equal(report.hostedCI, false);
      }
    } finally {
      if (f) rmSync(f.tmp, { recursive: true, force: true });
    }
  });
}
