import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { rollbackTarget } from '../scripts/rollback-target.mjs';
import { rollbackFixture, currentId, previousId, foreignId, currentTag, baseHash } from './fixtures/rollback-docker.mjs';
const posix = { skip: process.platform === 'win32' ? 'Actual archive consumer runs on Ubuntu' : false };
const target = f => rollbackTarget(f.env, f.reportDir, f.execute);

test('proven rollback uses distinct archive config identities, not ambiguous image-store IDs', posix, async t => {
  const f = rollbackFixture(t), r = target(f), detail = await r.prove();
  assert.equal(detail.current.id, currentId); assert.equal(detail.previous.id, previousId);
  assert.equal(detail.current.config, f.images.get(currentId).digest); assert.equal(detail.previous.config, f.images.get(previousId).digest);
  assert.notEqual(detail.current.config, currentId); assert.notEqual(detail.previous.config, previousId);
  assert.deepEqual(f.mutations, []);
});

test('an early business-request error cannot trigger any Governance recreation', posix, async t => {
  const f = rollbackFixture(t), r = target(f); await r.prove();
  await r.restoreOriginal();
  assert.deepEqual([...f.states], f.originalStates); assert.deepEqual(f.mutations, []);
  assert.equal(r.details.restorationAttempted, false);
});

test('actual plan files switch only Governance then restore the captured immutable current image', posix, async t => {
  const f = rollbackFixture(t), r = target(f); await r.prove();
  await r.switchPrevious(); assert.equal(f.states.get('governance').Image, previousId);
  assert.deepEqual(JSON.parse(readFileSync(join(f.reportDir, 'previous-image-override.json'))), { services: { governance: { image: previousId } } });
  await r.restoreOriginal(); assert.equal(f.states.get('governance').Image, currentId); assert.equal(r.details.restored, true);
  assert.deepEqual(JSON.parse(readFileSync(join(f.reportDir, 'restore-image-override.json'))), { services: { governance: { image: currentId } } });
  for (const [service, original] of f.originalStates) if (service !== 'governance') assert.deepEqual(f.states.get(service), original);
  assert.deepEqual(f.mutations, [{ kind: 'compose-up', image: previousId }, { kind: 'compose-up', image: currentId }]);
});

for (const [name, mutate, expected] of [
  ['same local image ID', f => f.env.RG_ROLLBACK_IMAGE = currentId, /must change the running image/],
  ['same config under another image ID', f => f.images.get(previousId).archive = f.images.get(currentId).archive, /Retagging the same image/],
  ['running configuration mismatch', f => f.states.get('governance').Labels['com.docker.compose.config-hash'] = 'e'.repeat(64), /does not match this Compose/],
  ['wrong project', f => f.states.get('governance').Labels['com.docker.compose.project'] = 'releaseguard-team13', /project mismatch/],
  ['wrong port', f => f.states.get('gateway').Ports['8080/tcp'][0].HostPort = '5193', /does not belong/],
]) test('rollback proof refuses ' + name + ' without modifying a service', posix, async t => {
  const f = rollbackFixture(t); mutate(f); const r = target(f);
  await assert.rejects(r.prove(), expected); await r.restoreOriginal(); assert.deepEqual(f.mutations, []);
});

test('pre-switch Compose failure leaves an untouched service untouched during cleanup', posix, async t => {
  const f = rollbackFixture(t), r = target(f); await r.prove(); f.faults.beforeSwitch = true;
  await assert.rejects(r.switchPrevious(), /Compose failure/); await r.restoreOriginal();
  assert.equal(r.details.restored, true); assert.equal(r.details.restoredWithoutRecreation, true);
  assert.deepEqual([...f.states], f.originalStates); assert.equal(f.mutations.length, 1);
});

test('a switch that succeeded before throwing still restores the current artifact once', posix, async t => {
  const f = rollbackFixture(t), r = target(f); await r.prove(); f.faults.afterSwitch = true;
  await assert.rejects(r.switchPrevious(), /partial Compose failure/); assert.equal(f.states.get('governance').Image, previousId);
  await r.restoreOriginal(); assert.equal(f.states.get('governance').Image, currentId); assert.equal(r.details.restored, true);
  assert.equal(f.mutations.filter(m => m.kind === 'compose-up').length, 2);
});

test('a failed switch that left Governance missing restores only this captured service', posix, async t => {
  const f = rollbackFixture(t), r = target(f); await r.prove(); f.faults.afterSwitch = true;
  await assert.rejects(r.switchPrevious(), /partial Compose failure/); f.states.delete('governance');
  await r.restoreOriginal(); assert.equal(f.states.get('governance').Image, currentId);
  for (const [service, original] of f.originalStates) if (service !== 'governance') assert.deepEqual(f.states.get(service), original);
});

test('a partially successful restore is recorded unconfirmed and is not automatically retried', posix, async t => {
  const f = rollbackFixture(t), r = target(f); await r.prove(); await r.switchPrevious(); f.faults.afterRestore = true;
  await assert.rejects(r.restoreOriginal(), /partial Compose failure/);
  assert.equal(f.states.get('governance').Image, currentId); assert.equal(r.details.restored, false);
  await assert.rejects(r.restoreOriginal(), /unconfirmed; do not retry/);
  assert.equal(f.mutations.filter(m => m.image === currentId).length, 1);
});

test('a changed mutable image tag cannot redirect restoration away from the captured current ID', posix, async t => {
  const f = rollbackFixture(t), r = target(f); await r.prove(); await r.switchPrevious();
  f.tags.set(currentTag, foreignId); await r.restoreOriginal();
  assert.equal(f.states.get('governance').Image, currentId); assert.equal(f.tags.get(currentTag), foreignId);
});

test('old override evidence is not overwritten and cannot cause an unrecorded switch', posix, async t => {
  const f = rollbackFixture(t), r = target(f); await r.prove();
  const file = join(f.reportDir, 'previous-image-override.json'); writeFileSync(file, 'retained evidence');
  await assert.rejects(r.switchPrevious(), { code: 'EEXIST' }); await r.restoreOriginal();
  assert.equal(readFileSync(file, 'utf8'), 'retained evidence'); assert.deepEqual(f.mutations, []);
});

for (const [name, mutate, expected] of [
  ['unrelated image', f => f.states.get('governance').Image = foreignId, /unrelated Governance/],
  ['foreign container project', f => f.states.get('governance').Labels['com.docker.compose.project'] = 'other', /project mismatch/],
  ['unexpected service config', f => f.states.get('governance').Labels['com.docker.compose.config-hash'] = 'e'.repeat(64), /unrelated Governance/],
  ['changed base Compose configuration', f => f.faults.baseChanged = true, /configuration changed/],
]) test('restore refuses ' + name + ' rather than overwriting another change', posix, async t => {
  const f = rollbackFixture(t), r = target(f); await r.prove(); await r.switchPrevious(); mutate(f);
  await assert.rejects(r.restoreOriginal(), expected);
  assert.equal(f.mutations.length, 1); assert.equal(r.details.restored, false);
});

test('another dependency changing cannot prevent scoped Governance recovery or get overwritten', posix, async t => {
  const f = rollbackFixture(t), r = target(f); await r.prove(); await r.switchPrevious();
  f.states.get('registry').Image = foreignId;
  await assert.rejects(r.restoreOriginal(), /Dependency image changed/);
  assert.equal(f.states.get('governance').Image, currentId); assert.equal(f.states.get('registry').Image, foreignId);
  assert.equal(r.details.restored, false); // Whole drill still fails, never a silent success.
});

test('service identity drift before switch fails before any fault command', posix, async t => {
  const f = rollbackFixture(t), r = target(f); await r.prove(); f.states.get('registry').Id = 'f'.repeat(64);
  await assert.rejects(r.switchPrevious(), /Original container missing/); await r.restoreOriginal(); assert.deepEqual(f.mutations, []);
});

test('neither the switch nor a confirmed restoration can be executed twice', posix, async t => {
  const f = rollbackFixture(t), r = target(f); await r.prove(); await r.switchPrevious();
  await assert.rejects(r.switchPrevious(), /must not be retried/); await r.restoreOriginal(); await r.restoreOriginal();
  assert.equal(f.mutations.length, 2); assert.equal(r.details.originalConfigHash, baseHash);
});
