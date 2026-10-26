// Opt-in artifact drill only. This does not restore a database or contact cloud.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contractTarget, validateContractEnvironment, waitForContractHealth } from './contract-target.mjs';
import { readArchiveIdentity } from './image-identity.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const imageId = /^sha256:[a-f0-9]{64}$/;
const imageRef = /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[0-9]+)?(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}|@sha256:[a-f0-9]{64})?$/;
const inspectFormat = '{"Id":{{json .Id}},"Image":{{json .Image}},"Labels":{{json .Config.Labels}},"State":{{json .State}}}';
export function validateRollbackEnvironment(env) {
  assert.equal(env.RG_ROLLBACK_INTEGRATION, '1', 'Explicit disposable rollback opt-in required');
  const proofEnv = { ...env, RG_CONTRACTS_INTEGRATION: '1' };
  const scope = validateContractEnvironment(proofEnv);
  if (env.RG_ROLLBACK_IMAGE) assert.ok(imageId.test(env.RG_ROLLBACK_IMAGE) || imageRef.test(env.RG_ROLLBACK_IMAGE), 'Invalid existing local image reference');
  else assert.ok(env.RG_ROLLBACK_ARTIFACT_DIR && env.GITHUB_ACTIONS === 'true', 'An existing local image or explicit retained artifact is required');
  return { ...scope, proofEnv };
}

export function rollbackTarget(env, reportDir, execute = execFileSync) {
  const { project, proofEnv } = validateRollbackEnvironment(env);
  assert.ok(env.RG_ROLLBACK_IMAGE, 'Resolve the retained artifact to an existing local image first');
  const proof = contractTarget(proofEnv, execute);
  const details = { project, healthObservations: proof.observations, switchAttempted: false, restorationAttempted: false, restored: false };
  const run = (...args) => execute('docker', ['--context', 'default', ...args], {
    cwd: root, env, encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024, stdio: 'pipe',
  }).trim();
  const compose = (override, ...args) => run('compose', '--project-name', project, '--project-directory', root,
    '--file', root + 'compose.yaml', ...(override ? ['--file', override] : []), ...args);
  const inspect = id => JSON.parse(run('inspect', '--format', inspectFormat, id));
  let originals, baseHash, previousHash, restoreHash, originalGovernance;
  function owned(service, state) {
    assert.equal(state.Labels?.['com.docker.compose.project'], project, 'Container project mismatch: ' + service);
    assert.equal(state.Labels?.['com.docker.compose.service'], service, 'Container service mismatch: ' + service);
    assert.match(state.Id, /^[a-f0-9]{64}$/, 'Invalid container ID'); assert.match(state.Image, imageId, 'Invalid container image');
  }
  function configHash(override) {
    const lines = compose(override, 'config', '--hash', 'governance').split(/\r?\n/).filter(Boolean);
    assert.equal(lines.length, 1, 'Expected one Governance configuration hash');
    const match = lines[0].match(/^governance ([a-f0-9]{64})$/);
    assert.ok(match, 'Invalid Governance configuration hash'); return match[1];
  }
  function baseUnchanged() { assert.equal(configHash(), baseHash, 'Compose configuration changed during drill'); }
  function governance() {
    const ids = compose(null, 'ps', '--all', '--quiet', 'governance').split(/\s+/).filter(Boolean);
    assert.ok(ids.length <= 1, 'Ambiguous Governance target');
    if (!ids.length) return null;
    const state = inspect(ids[0]); owned('governance', state); assert.equal(state.Id, ids[0]); return state;
  }
  function known(state) {
    if (!state) return;
    const hash = state.Labels['com.docker.compose.config-hash'];
    assert.ok((state.Id === originalGovernance.Id && state.Image === details.current.id && hash === baseHash) ||
      (state.Image === details.previous.id && hash === previousHash) ||
      (state.Image === details.current.id && restoreHash && hash === restoreHash), 'Refuse to overwrite an unrelated Governance artifact or configuration');
  }
  function unchangedDependencies() {
    for (const [service, original] of Object.entries(originals)) {
      if (service === 'governance') continue;
      const state = inspect(original.id); owned(service, state);
      assert.equal(state.Id, original.id, 'Dependency container changed: ' + service);
      assert.equal(state.Image, original.image, 'Dependency image changed: ' + service);
    }
  }
  async function identity(reference) {
    const info = JSON.parse(run('image', 'inspect', reference, '--format', '{"Id":{{json .Id}},"Labels":{{json .Config.Labels}}}'));
    assert.match(info.Id, imageId, 'Invalid retained local image identity');
    const temp = await mkdtemp(join(tmpdir(), 'rg-rollback-inspect-'));
    try {
      const archive = join(temp, 'image.tar'); run('image', 'save', info.Id, '-o', archive);
      const config = readArchiveIdentity(archive).digest;
      const revision = info.Labels?.['org.opencontainers.image.revision'];
      return { id: info.Id, config, embeddedSource: /^[a-f0-9]{40}$/.test(revision ?? '') ? revision : null };
    } finally {
      assert.match(basename(temp), /^rg-rollback-inspect-/); await rm(temp, { recursive: true });
    }
  }
  const plan = async (name, id) => {
    const file = join(reportDir, name);
    await writeFile(file, JSON.stringify({ services: { governance: { image: id } } }), { flag: 'wx' }); return file;
  };
  return {
    details,
    async prove() {
      assert.equal(originals, undefined, 'Rollback target can be proven only once');
      originals = await proof.prove();
      originalGovernance = governance(); assert.ok(originalGovernance, 'Governance must already exist');
      assert.equal(originalGovernance.Id, originals.governance.id);
      baseHash = configHash();
      assert.equal(originalGovernance.Labels['com.docker.compose.config-hash'], baseHash, 'Running Governance does not match this Compose configuration');
      details.current = await identity(originalGovernance.Image);
      assert.equal(details.current.id, originalGovernance.Image, 'Ambiguous current image-store identity');
      details.previous = await identity(env.RG_ROLLBACK_IMAGE);
      assert.notEqual(details.previous.id, details.current.id, 'Rollback must change the running image');
      assert.notEqual(details.previous.config, details.current.config, 'Retagging the same image is not an artifact rollback');
      details.originalContainer = originalGovernance.Id; details.originalConfigHash = baseHash; details.containers = originals;
      return details;
    },
    async switchPrevious() {
      assert.ok(details.current && details.previous, 'Rollback ownership and images must be proven first');
      assert.equal(details.switchAttempted, false, 'Rollback switch must not be retried');
      baseUnchanged(); unchangedDependencies();
      const before = governance(); assert.ok(before, 'Original Governance is missing'); known(before);
      assert.equal(before.Id, originalGovernance.Id, 'Governance changed before switch');
      const override = await plan('previous-image-override.json', details.previous.id); previousHash = configHash(override);
      details.switchAttempted = true; // Before the potentially partial Compose command.
      compose(override, 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--wait', 'governance');
      const after = governance(); assert.ok(after, 'Rollback did not create Governance'); known(after);
      assert.equal(after.Image, details.previous.id); assert.equal(after.Labels['com.docker.compose.config-hash'], previousHash);
      await waitForContractHealth('governance', () => {
        const current = governance(); assert.ok(current); known(current); assert.equal(current.Id, after.Id); return current;
      }, { observe: entry => details.healthObservations.push(entry) });
      unchangedDependencies(); details.previousContainer = after.Id; details.previousConfigHash = previousHash;
    },
    async restoreOriginal() {
      if (!details.switchAttempted) return; // An early HTTP/credential error must never recreate a service.
      if (details.restorationAttempted) { assert.equal(details.restored, true, 'Previous restoration is unconfirmed; do not retry'); return; }
      details.restorationAttempted = true;
      baseUnchanged();
      const before = governance(); known(before);
      const untouched = before && before.Id === originalGovernance.Id && before.Image === details.current.id && before.State.Running && !before.State.Paused;
      let expectedHash = baseHash;
      if (!untouched) {
        const override = await plan('restore-image-override.json', details.current.id); restoreHash = configHash(override); expectedHash = restoreHash;
        compose(override, 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--wait', 'governance');
      }
      const after = governance(); assert.ok(after, 'Restored Governance is missing'); known(after);
      assert.equal(after.Image, details.current.id); assert.equal(after.Labels['com.docker.compose.config-hash'], expectedHash);
      await waitForContractHealth('governance', () => {
        const current = governance(); assert.ok(current); known(current); assert.equal(current.Id, after.Id); return current;
      }, { observe: entry => details.healthObservations.push(entry) });
      unchangedDependencies(); details.restored = true; details.restoredContainer = after.Id; details.restoredImage = after.Image;
      details.restoredWithoutRecreation = Boolean(untouched);
    },
  };
}
