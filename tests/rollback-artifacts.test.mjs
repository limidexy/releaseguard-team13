import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { copyFileSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRetainedRollbackImage, retainedRequest } from '../scripts/rollback-artifacts.mjs';
import { rollbackFixture, currentId, previousId, foreignId, currentTag, previousSource } from './fixtures/rollback-docker.mjs';
const posix = { skip: process.platform === 'win32' ? 'Hosted artifact consumer runs on Ubuntu' : false };
const prepare = f => loadRetainedRollbackImage(f.env, currentId, f.execute);

test('load the pinned retained config, preserve archive bytes and restore the current tag before returning', posix, async t => {
  const f = rollbackFixture(t), archive = join(f.artifactDir, 'tested-image/image.tar'), before = readFileSync(archive);
  const record = await prepare(f);
  assert.equal(record.previousId, previousId); assert.equal(record.previousConfig, f.images.get(previousId).digest);
  assert.equal(record.currentConfig, f.images.get(currentId).digest); assert.equal(record.currentTagRestored, true);
  assert.equal(record.source, previousSource); assert.equal(record.run, 1001);
  assert.deepEqual(record.artifacts.map(a => a.id), [2001, 2002]);
  assert.equal(f.tags.get(currentTag), currentId); assert.deepEqual(readFileSync(archive), before);
  assert.deepEqual([...f.states], f.originalStates);
  assert.deepEqual(f.mutations, [{ kind: 'load' }, { kind: 'tag', id: currentId }]);
});

for (const [name, changes] of [
  ['outside hosted CI', { GITHUB_ACTIONS: 'false' }], ['missing explicit opt-in', { RG_ROLLBACK_INTEGRATION: '' }],
  ['another repository', { GITHUB_REPOSITORY: 'other/repo' }], ['traversal repository', { REPOSITORY: 'owner/..', GITHUB_REPOSITORY: 'owner/..' }],
  ['unsafe numeric run ID', { RUN_ID: '9999999999999999999999999' }], ['invalid source revision', { EXPECTED_SHA: 'not-a-source' }],
  ['unscoped Docker context', { DOCKER_CONTEXT: 'production' }], ['classroom project', { COMPOSE_PROJECT_NAME: 'releaseguard-team13' }],
]) test('retained request refuses ' + name + ' before any process boundary', posix, t => {
  const f = rollbackFixture(t); Object.assign(f.env, changes);
  assert.throws(() => retainedRequest(f.env)); assert.deepEqual(f.calls, []);
});

for (const [name, mutate] of [
  ['failed CI', f => f.run.conclusion = 'failure'], ['unfinished CI', f => f.run.status = 'in_progress'],
  ['wrong source revision', f => f.run.head_sha = 'a'.repeat(40)], ['wrong workflow', f => f.run.path = '.github/workflows/cd.yml'],
  ['foreign run repository', f => f.run.repository.full_name = 'other/repo'], ['foreign head repository', f => f.run.head_repository.full_name = 'other/repo'],
]) test('retained loader refuses ' + name + ' without Docker or raw metadata disclosure', posix, async t => {
  const f = rollbackFixture(t); mutate(f); writeFileSync(join(f.artifactDir, 'run.json'), JSON.stringify(f.run));
  await assert.rejects(prepare(f), error => { assert.match(error.record.error, /successful verification/); return true; });
  assert.deepEqual(f.calls, []);
});

test('invalid private metadata is never echoed in the retained error record', posix, async t => {
  const f = rollbackFixture(t); writeFileSync(join(f.artifactDir, 'run.json'), 'PRIVATE-RAW-CI-TEXT');
  await assert.rejects(prepare(f), error => { assert.doesNotMatch(JSON.stringify(error.record), /PRIVATE-RAW-CI-TEXT/); return true; });
  assert.deepEqual(f.calls, []);
});

for (const [name, mutate] of [
  ['expired image artifact', f => f.artifacts.artifacts[0].expired = true],
  ['wrong artifact ID', f => f.artifacts.artifacts[0].id = 9001],
  ['wrong pinned ZIP digest', f => f.artifacts.artifacts[1].digest = 'sha256:' + '9'.repeat(64)],
  ['artifact from another run', f => f.artifacts.artifacts[0].workflow_run.id = 2000],
  ['artifact from another source', f => f.artifacts.artifacts[0].workflow_run.head_sha = 'a'.repeat(40)],
  ['ambiguous artifact name', f => f.artifacts.artifacts.push(structuredClone(f.artifacts.artifacts[0]))],
]) test('retained loader refuses ' + name + ' before reading an image into Docker', posix, async t => {
  const f = rollbackFixture(t); mutate(f); writeFileSync(join(f.artifactDir, 'artifacts.json'), JSON.stringify(f.artifacts));
  await assert.rejects(prepare(f)); assert.deepEqual(f.calls, []); assert.deepEqual(f.mutations, []);
});

test('wrong source receipt cannot be rescued by a legacy image-id receipt', posix, async t => {
  const f = rollbackFixture(t); writeFileSync(join(f.artifactDir, 'verification-evidence/source-commit.txt'), 'a'.repeat(40));
  writeFileSync(join(f.artifactDir, 'verification-evidence/image-id.txt'), previousId);
  await assert.rejects(prepare(f), error => { assert.match(error.record.error, /source receipt mismatch/); return true; });
  assert.deepEqual(f.calls, []);
});

test('retained archive cannot retag an unrelated image alias', posix, async t => {
  const f = rollbackFixture(t), folder = join(f.dir, 'actual-previous-test-config'), config = f.images.get(previousId).digest.slice(7) + '.json';
  writeFileSync(join(folder, 'manifest.json'), JSON.stringify([{ Config: config, RepoTags: [currentTag, 'unrelated:keep'], Layers: [] }]));
  execFileSync('/usr/bin/tar', ['-cf', join(f.artifactDir, 'tested-image/image.tar'), '-C', folder, 'manifest.json', config]);
  await assert.rejects(prepare(f), error => { assert.match(error.record.error, /retag another image/); return true; });
  assert.deepEqual(f.calls, []);
});

test('the same config under a different name is not accepted as a previous release', posix, async t => {
  const f = rollbackFixture(t); copyFileSync(f.images.get(currentId).archive, join(f.artifactDir, 'tested-image/image.tar'));
  await assert.rejects(prepare(f), error => { assert.match(error.record.error, /Retagging the same image/); return true; });
  assert.deepEqual(f.mutations, []); assert.equal(f.tags.get(currentTag), currentId);
});

test('a preexisting wrong current tag is not silently overwritten', posix, async t => {
  const f = rollbackFixture(t); f.tags.set(currentTag, foreignId);
  await assert.rejects(prepare(f), error => { assert.match(error.record.error, /proven running Governance/); return true; });
  assert.deepEqual(f.mutations, []); assert.equal(f.tags.get(currentTag), foreignId);
});

test('a load that fails before changing the alias causes no unnecessary retag', posix, async t => {
  const f = rollbackFixture(t); f.faults.beforeLoad = true;
  await assert.rejects(prepare(f), error => { assert.match(error.record.error, /load failure/); assert.equal(error.record.currentTagRestored, true); return true; });
  assert.deepEqual(f.mutations, [{ kind: 'load' }]); assert.equal(f.tags.get(currentTag), currentId);
});

test('a partially successful load restores the captured current alias but still fails the preparation', posix, async t => {
  const f = rollbackFixture(t); f.faults.afterLoad = true;
  await assert.rejects(prepare(f), error => { assert.match(error.record.error, /partial load failure/); assert.equal(error.record.currentTagRestored, true); return true; });
  assert.equal(f.tags.get(currentTag), currentId); assert.equal(f.mutations.filter(m => m.kind === 'tag').length, 1);
  assert.deepEqual([...f.states], f.originalStates);
});

for (const [name, fault, observed] of [['failed retag', 'beforeTag', previousId], ['uncertain retag', 'afterTag', currentId]]) {
  test(name + ' is reported without retry or a usable successful result', posix, async t => {
    const f = rollbackFixture(t); f.faults[fault] = true;
    await assert.rejects(prepare(f), error => { assert.ok(error.record.restoreError); assert.equal(error.record.currentTagRestored, false); return true; });
    assert.equal(f.tags.get(currentTag), observed); assert.equal(f.mutations.filter(m => m.kind === 'tag').length, 1);
  });
}

test('a foreign alias observed after loading is not clobbered by cleanup', posix, async t => {
  const f = rollbackFixture(t); f.faults.foreignAfterLoad = true;
  await assert.rejects(prepare(f), error => { assert.match(error.record.restoreError, /foreign image alias/); return true; });
  assert.equal(f.tags.get(currentTag), foreignId); assert.equal(f.mutations.filter(m => m.kind === 'tag').length, 0);
  assert.deepEqual([...f.states], f.originalStates);
});

test('metadata symlinks are rejected without reading the target or touching Docker', posix, async t => {
  const f = rollbackFixture(t); const path = join(f.artifactDir, 'run.json');
  // Replace only this test's own metadata file with a test-owned link.
  const { unlinkSync } = await import('node:fs'); unlinkSync(path); symlinkSync(join(f.artifactDir, 'artifacts.json'), path);
  await assert.rejects(prepare(f)); assert.deepEqual(f.calls, []);
});
