import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Exercise Git's checkout conversion, rather than merely checking rule text.
test('a fresh autocrlf checkout preserves executable inputs as LF and binary bytes unchanged', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'rg-tooling-eol-'));
  try {
    const repo = path.join(tmp, 'repo'), checkout = path.join(tmp, 'checkout');
    mkdirSync(repo); mkdirSync(checkout);
    const config = path.join(tmp, 'empty-config');
    writeFileSync(config, '');
    const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: config };
    const git = args => execFileSync('git', args, { cwd: repo, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    git(['init', '--quiet']);
    const inputs = new Map([
      ['deploy/postgres/init.sh', readFileSync('deploy/postgres/init.sh')],
      ['Dockerfile', readFileSync('Dockerfile')],
      ['.githooks/pre-push', Buffer.from('#!/bin/sh\nexec node scripts/prepush.mjs\n')],
      ['fixture.png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 13, 10])],
    ]);
    for (const [file, bytes] of inputs) {
      mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
      writeFileSync(path.join(repo, file), bytes);
    }
    if (existsSync('.gitattributes')) writeFileSync(path.join(repo, '.gitattributes'), readFileSync('.gitattributes'));
    git(['-c', 'core.autocrlf=true', 'add', '.']);
    git(['-c', 'core.autocrlf=true', 'checkout-index', '--all', '--prefix=' + checkout.replaceAll('\\', '/') + '/']);
    for (const [file, bytes] of inputs) {
      assert.deepEqual(readFileSync(path.join(checkout, file)), bytes, file + ' must survive Windows-style checkout byte-for-byte');
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
