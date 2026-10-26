// Reads a pinned successful run's retained artifacts; never rebuilds an old image.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { lstat, readFile, realpath, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, basename, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateContractEnvironment } from './contract-target.mjs';
import { readArchiveIdentity } from './image-identity.mjs';

const digest = /^sha256:[a-f0-9]{64}$/, sourcePattern = /^[a-f0-9]{40}$/;
export function retainedRequest(env) {
  assert.equal(env.RG_ROLLBACK_INTEGRATION, '1', 'Explicit rollback opt-in required');
  assert.equal(env.GITHUB_ACTIONS, 'true', 'Retained image loading is limited to disposable hosted CI');
  validateContractEnvironment({ ...env, RG_CONTRACTS_INTEGRATION: '1' });
  assert.match(env.REPOSITORY ?? '', /^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/, 'Invalid retained artifact repository');
  assert.ok(!['.', '..'].includes(env.REPOSITORY.split('/')[1]), 'Invalid retained artifact repository');
  assert.equal(env.GITHUB_REPOSITORY, env.REPOSITORY, 'Retained artifacts must belong to this repository');
  assert.match(env.EXPECTED_SHA ?? '', sourcePattern, 'Invalid retained source');
  for (const key of ['RUN_ID', 'RG_ROLLBACK_IMAGE_ARTIFACT_ID', 'RG_ROLLBACK_EVIDENCE_ARTIFACT_ID']) {
    assert.match(env[key] ?? '', /^[1-9][0-9]*$/, 'Invalid retained artifact/run ID');
    assert.ok(Number.isSafeInteger(Number(env[key])), 'Unsafe retained artifact/run ID');
  }
  for (const key of ['RG_ROLLBACK_IMAGE_ARTIFACT_DIGEST', 'RG_ROLLBACK_EVIDENCE_ARTIFACT_DIGEST']) assert.match(env[key] ?? '', digest, 'Invalid pinned artifact ZIP digest');
  return { repository: env.REPOSITORY, source: env.EXPECTED_SHA, run: Number(env.RUN_ID) };
}
async function text(file, limit = 1_000_000) {
  const info = await lstat(file);
  assert.ok(info.isFile() && info.size <= limit, 'Invalid retained metadata file');
  const value = await readFile(file, 'utf8'); assert.ok(Buffer.byteLength(value) <= limit, 'Retained metadata too large'); return value;
}
export async function retainedRun(file, env) {
  const expected = retainedRequest(env); let run;
  try { run = JSON.parse(await text(file)); } catch { throw Error('Invalid retained CI metadata'); }
  assert.ok(run.id === expected.run && run.head_sha === expected.source && run.status === 'completed' && run.conclusion === 'success' &&
    run.path === '.github/workflows/ci.yml' && run.repository?.full_name === expected.repository && run.head_repository?.full_name === expected.repository,
  'Retained run must be the successful verification of the pinned source/repository'); return expected;
}

export async function retainedMetadata(folder, env) {
  const expected = await retainedRun(join(folder, 'run.json'), env);
  let list; try { list = JSON.parse(await text(join(folder, 'artifacts.json'))).artifacts; } catch { throw Error('Invalid retained artifact metadata'); }
  assert.ok(Array.isArray(list), 'Missing retained artifact descriptors'); const artifacts = [];
  for (const [name, idKey, digestKey] of [
    ['tested-image', 'RG_ROLLBACK_IMAGE_ARTIFACT_ID', 'RG_ROLLBACK_IMAGE_ARTIFACT_DIGEST'],
    ['verification-evidence', 'RG_ROLLBACK_EVIDENCE_ARTIFACT_ID', 'RG_ROLLBACK_EVIDENCE_ARTIFACT_DIGEST'],
  ]) {
    const matches = list.filter(a => a.name === name); assert.equal(matches.length, 1, 'Ambiguous retained artifact: ' + name);
    const artifact = matches[0];
    assert.ok(artifact.id === Number(env[idKey]) && artifact.expired === false && artifact.digest === env[digestKey] &&
      artifact.workflow_run?.id === expected.run && artifact.workflow_run?.head_sha === expected.source, 'Retained artifact does not match the pinned run/source/digest');
    artifacts.push({ id: artifact.id, name, zipDigest: artifact.digest, expiresAt: artifact.expires_at ?? null });
  }
  return { ...expected, artifacts };
}

export async function loadRetainedRollbackImage(env, expectedCurrent, execute = execFileSync) {
  const expected = retainedRequest(env); assert.match(expectedCurrent, digest, 'Invalid current running image');
  assert.ok(env.RG_ROLLBACK_ARTIFACT_DIR, 'Explicit retained artifact directory is required');
  const folder = resolve(env.RG_ROLLBACK_ARTIFACT_DIR ?? '');
  const record = { ...expected, currentTag: 'releaseguard-course-v2:local', currentId: expectedCurrent, loaded: false, currentTagRestored: false };
  let temp, loadAttempted = false, sequence = 0;
  const run = (...args) => execute('docker', ['--context', 'default', ...args], { env, encoding: 'utf8', stdio: 'pipe', timeout: 120000, maxBuffer: 1024 * 1024 }).trim();
  const inspect = ref => { const id = run('image', 'inspect', ref, '--format', '{{.Id}}'); assert.match(id, digest, 'Invalid loaded image identity'); return id; };
  const config = id => { const archive = join(temp, 'inspect-' + sequence++ + '.tar'); run('image', 'save', id, '-o', archive); return readArchiveIdentity(archive).digest; };
  try {
    record.artifacts = (await retainedMetadata(folder, env)).artifacts;
    const savedSource = (await text(join(folder, 'verification-evidence/source-commit.txt'), 128)).trim();
    assert.equal(savedSource, expected.source, 'Retained source receipt mismatch');
    const archive = join(folder, 'tested-image/image.tar'), info = await lstat(archive);
    assert.ok(info.isFile(), 'Retained image must be a regular file');
    assert.ok((await realpath(archive)).startsWith((await realpath(folder)) + sep), 'Retained archive escapes its directory');
    const retained = readArchiveIdentity(archive); assert.deepEqual(retained.repoTags, [record.currentTag], 'Refuse an archive that would retag another image');
    record.previousConfig = retained.digest;
    temp = await mkdtemp(join(tmpdir(), 'rg-rollback-load-'));
    assert.equal(inspect(record.currentTag), expectedCurrent, 'Current image alias does not match the proven running Governance');
    record.currentConfig = config(expectedCurrent);
    assert.notEqual(record.currentConfig, retained.digest, 'Retagging the same image is not a rollback');
    loadAttempted = true; // A failed load may nevertheless have changed this one alias.
    run('image', 'load', '--input', archive);
    record.previousId = inspect(record.currentTag);
    assert.notEqual(record.previousId, expectedCurrent, 'Retained image did not change the artifact');
    assert.equal(config(record.previousId), retained.digest, 'Loaded image config does not match the retained archive');
    record.loaded = true;
  } catch (error) { record.error = String(error); }
  finally {
    if (loadAttempted) {
      try {
        const now = inspect(record.currentTag);
        if (now !== expectedCurrent) {
          assert.equal(config(now), record.previousConfig, 'Refuse to overwrite a foreign image alias after load');
          run('image', 'tag', expectedCurrent, record.currentTag); // Restore once, never retry uncertain tagging.
        }
        assert.equal(inspect(record.currentTag), expectedCurrent, 'Current image alias restoration is unconfirmed');
        record.currentTagRestored = true;
      } catch (error) { record.restoreError = String(error); }
    }
    if (temp) {
      try { assert.match(basename(temp), /^rg-rollback-load-/); await rm(temp, { recursive: true }); }
      catch (error) { record.cleanupError = String(error); }
    }
  }
  if (record.error || record.restoreError || record.cleanupError || !record.loaded || !record.currentTagRestored) {
    const error = Error('Retained image preparation failed; no service switch is permitted'); error.record = record; throw error;
  }
  return record;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv[2] === 'request' && process.argv.length === 3) retainedRequest(process.env);
    else if (process.argv[2] === 'run' && process.argv.length === 4) await retainedRun(process.argv[3], process.env);
    else if (process.argv[2] === 'metadata' && process.argv.length === 4) await retainedMetadata(process.argv[3], process.env);
    else throw Error('Usage: rollback-artifacts.mjs request | run <run.json> | metadata <directory>');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
