// Local artifact rollback drill. Requires a retained, schema-compatible local image.
// It does not restore a database, delete volumes, pull an image, or touch other projects.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { token } from './dev-tokens.mjs';
import { base, required, completed, key } from './client.mjs';
import { application, suite } from './fixtures.mjs';

if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw Error('Loopback rollback drill only');
const previousImage = process.env.RG_ROLLBACK_IMAGE;
if (!previousImage || !/^[a-zA-Z0-9./:_-]+$/.test(previousImage)) throw Error('Set RG_ROLLBACK_IMAGE to an existing, schema-compatible local image');
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: 'pipe', timeout: 120000 }).trim();
const previousId = docker('image', 'inspect', previousImage, '--format', '{{.Id}}');
const originalContainer = docker('compose', 'ps', '-q', 'governance');
const currentId = docker('inspect', originalContainer, '--format', '{{.Image}}');
assert.notEqual(previousId, currentId, 'Rollback must change the running artifact');
const temp = await mkdtemp(path.join(tmpdir(), 'releaseguard-rollback-'));
const override = path.join(temp, 'compose.json');
const report = { startedAt: new Date().toISOString(), cloud: false, databaseRestore: false, currentImageId: currentId, previousImage, previousImageId: previousId, passed: false, notes: 'Changes only governance service in this Compose project; image IDs prove artifact switch, not hosted CI lineage. Schema compatibility limited to this tested change.' };
const identity = await token('rollback-author', 'contributor', 'rollback-' + Date.now());
try {
  const a = await required('applications', identity, application), s = await required('suites', identity, suite);
  const j = await completed((await required('jobs', identity, { appId: a.id, suiteId: s.id, candidate: 'rollback-probe', commitRef: 'course-local', source: 'replay' }, key())).id, identity);
  const r = await required('releases', identity, { jobId: j.id, note: 'Persist before rollback; verify retained audit and evidence' });
  const before = await required('evidence/' + r.id, identity);
  await writeFile(override, JSON.stringify({ services: { governance: { image: previousImage } } }));
  docker('compose', '-f', 'compose.yaml', '-f', override, 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--wait', 'governance');
  const rollbackId = docker('inspect', docker('compose', 'ps', '-q', 'governance'), '--format', '{{.Image}}');
  assert.equal(rollbackId, previousId);
  const oldRead = await required('evidence/' + r.id, identity);
  assert.equal(oldRead.evidenceDigest, before.evidenceDigest); assert.deepEqual(oldRead.audit, before.audit);
  report.releaseId = r.id; report.evidenceDigest = before.evidenceDigest; report.previousVersionReadPassed = true;
} catch (error) { report.error = String(error); process.exitCode = 1; }
finally {
  try {
    // Restore the exact captured image ID, not a mutable tag.
    await writeFile(override, JSON.stringify({ services: { governance: { image: currentId } } }));
    docker('compose', '-f', 'compose.yaml', '-f', override, 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--wait', 'governance');
    report.restoredImageId = docker('inspect', docker('compose', 'ps', '-q', 'governance'), '--format', '{{.Image}}');
    assert.equal(report.restoredImageId, currentId);
    if (report.releaseId) assert.equal((await required('evidence/' + report.releaseId, identity)).evidenceDigest, report.evidenceDigest);
    report.passed = report.previousVersionReadPassed === true && !report.error;
  } catch (error) { report.restoreError = String(error); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  await mkdir('evidence/current', { recursive: true });
  await writeFile('evidence/current/rollback-local.json', JSON.stringify(report, null, 2));
  await rm(temp, { recursive: true });
  console.log(JSON.stringify(report, null, 2));
}
