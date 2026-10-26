// Do not make unrelated CI depend forever on an expiring historical artifact.
// Any backend/build/rollback change still requires the real retained-image drill.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
export function needsRetainedRollback(paths) {
  return paths.some(path => path.startsWith('src/') || path.startsWith('scripts/rollback-') || path.startsWith('tests/rollback-') ||
    ['scripts/verify-rollback.mjs', 'scripts/image-identity.mjs', 'scripts/contract-target.mjs', 'tests/fixtures/rollback-docker.mjs',
      'tests/fixtures/contracts-safety-preload.mjs', 'public/demo-fixtures.json', 'package.json', 'package-lock.json',
      'compose.yaml', 'Dockerfile', '.dockerignore', 'tsconfig.json', '.github/workflows/ci.yml'].includes(path) || path.startsWith('deploy/postgres/'));
}
async function main() {
  assert.match(process.env.GITHUB_SHA ?? '', /^[a-f0-9]{40}$/, 'CI source revision is required');
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', timeout: 10000, maxBuffer: 2e6, stdio: 'pipe' });
  assert.equal(git('rev-parse', 'HEAD').trim(), process.env.GITHUB_SHA, 'CI checkout/source mismatch');
  // Pushes may contain several commits. Never check only the last one and miss
  // an earlier backend change. Unknown history fails, never becomes a skip.
  let required;
  if (process.env.GITHUB_EVENT_NAME === 'workflow_dispatch') required = true;
  else {
    let base = 'HEAD^1';
    if (process.env.GITHUB_EVENT_NAME === 'push') {
      assert.match(process.env.RG_CI_BEFORE_SHA ?? '', /^[a-f0-9]{40}$/, 'Push base revision is required');
      base = process.env.RG_CI_BEFORE_SHA;
    } else assert.equal(process.env.GITHUB_EVENT_NAME, 'pull_request', 'Unsupported CI change context');
    if (base === '0'.repeat(40)) required = true;
    else required = needsRetainedRollback(git('diff', '--no-ext-diff', '--no-textconv', '--name-only', '-z', '--no-renames', base, 'HEAD', '--').split('\0').filter(Boolean));
  }
  assert.ok(process.env.GITHUB_OUTPUT, 'GitHub output file is required');
  await appendFile(process.env.GITHUB_OUTPUT, 'required=' + required + '\n');
  console.log('Retained-image rollback required by this change:', required);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
