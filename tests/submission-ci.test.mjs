import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const workflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const block = workflow.split('      - name: Submission deadlines and database atomicity integration\n')[1]?.split('\n      - ')[0];
assert.ok(block, 'The dedicated submission integration step must exist');
const inlineRun = block.match(/^        run: ([^|\n].*)$/m)?.[1];
const multilineRun = block.split('        run: |\n')[1]?.split('\n').filter(line => line.startsWith('          ')).map(line => line.slice(10)).join('\n');
const command = multilineRun ?? inlineRun;
assert.ok(command, 'The dedicated step must contain an executable command');

test('submission CI uses explicit bash pipefail and runner-isolated Compose', () => {
  assert.match(block, /^        shell: bash$/m);
  assert.match(block, /RG_SUBMISSION_INTEGRATION: '1'/);
  assert.match(block, /RELEASEGUARD_URL: http:\/\/127\.0\.0\.1:5189/);
  assert.match(workflow, /COMPOSE_PROJECT_NAME: rg-ci-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
});

// Execute only the workflow wrapper with a synthetic node executable. No Docker,
// network, existing evidence, database or service is accessed by these tests.
for (const exitCode of [0, 17]) {
  test(`submission CI preserves output and exit ${exitCode} from a clean directory`, { skip: process.platform === 'win32' }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'rg-submission-ci-'));
    try {
      const bin = join(root, 'bin'); await mkdir(bin);
      await writeFile(join(bin, 'node'), '#!/bin/sh\nprintf "synthetic-submission-result\\n"\nexit ' + exitCode + '\n', { mode: 0o700 });
      const result = spawnSync('/bin/bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', command], {
        cwd: root, encoding: 'utf8', timeout: 5000,
        env: { PATH: bin + ':/usr/bin:/bin', LANG: 'C' },
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, exitCode, result.stderr);
      assert.equal(await readFile(join(root, 'evidence/submission-integration.log'), 'utf8'), 'synthetic-submission-result\n');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}
