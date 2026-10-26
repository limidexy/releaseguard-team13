import assert from 'node:assert/strict';
import test from 'node:test';
import { runRollbackVerification } from '../scripts/verify-rollback.mjs';
import { rollbackTarget } from '../scripts/rollback-target.mjs';
import { rollbackFixture, currentId, previousId } from './fixtures/rollback-docker.mjs';
const posix = { skip: process.platform === 'win32' ? 'Hosted rollback flow runs on Ubuntu' : false };
async function flow(t, faults = {}) {
  const f = rollbackFixture(t), target = rollbackTarget(f.env, f.reportDir, f.execute); await target.prove();
  Object.assign(f.faults, faults.docker);
  const original = { release: { id: 'release', status: 'pending', evidence: { outputs: [{ output: 'Original synthetic answer' }] } }, evidenceDigest: 'retained-digest', audit: [{ action: 'ReleaseRequested' }] };
  let evidenceReads = 0; const sent = [];
  const client = {
    key: () => 'one-synthetic-key',
    async required(path, identity, body, key) {
      assert.equal(identity, 'synthetic-identity'); sent.push({ path, body: structuredClone(body), key });
      if (path === 'applications') { if (faults.earlyHTTP) throw Error('Synthetic HTTP failure before capture'); return { id: 'application' }; }
      if (path === 'suites') return { id: 'suite' };
      if (path === 'jobs') {
        assert.equal(body.source, 'replay'); assert.equal(body.scenario, 'passing'); assert.equal(key, 'one-synthetic-key'); return { id: 'job' };
      }
      if (path === 'releases') { assert.equal(body.jobId, 'job'); return { id: 'release' }; }
      assert.equal(path, 'evidence/release', 'No approval, other HTTP endpoint or provider is allowed'); evidenceReads++;
      const result = structuredClone(original);
      if (faults.changedOldEvidence && evidenceReads === 2) result.release.evidence.outputs[0].output = 'Changed answer';
      if (faults.finalReadFailure && evidenceReads === 3) throw Error('Synthetic read failure after restoration');
      return result;
    },
    async completed(id, identity) { assert.equal(id, 'job'); assert.equal(identity, 'synthetic-identity'); return { id, result: { gate: 'passed' }, execution: { provenance: { source: 'replay' } } }; },
  };
  const report = { totalChecks: 3, checks: [] };
  await runRollbackVerification({ target, client, identity: 'synthetic-identity', application: { name: 'synthetic' }, suite: { name: 'synthetic' }, workspace: 'synthetic-workspace', report });
  return { f, target, report, original, sent };
}

test('actual orchestration switches/restores only after capture and retains the original pending evidence', posix, async t => {
  const { f, report, original, sent } = await flow(t);
  assert.equal(report.passed, true); assert.equal(report.passedChecks, 3); assert.equal(report.failedChecks, 0); assert.equal(report.notExecutedChecks, 0);
  assert.equal(f.states.get('governance').Image, currentId); assert.equal(original.release.status, 'pending');
  assert.deepEqual(f.mutations.map(m => m.image), [previousId, currentId]);
  assert.equal(sent.filter(r => r.path === 'jobs').length, 1); assert.equal(sent.filter(r => r.path.startsWith('evidence/')).length, 3);
});

test('actual early HTTP failure records one failure and never recreates Governance', posix, async t => {
  const { f, report, sent } = await flow(t, { earlyHTTP: true });
  assert.equal(report.passed, false); assert.equal(report.failedChecks, 1); assert.equal(report.notExecutedChecks, 2);
  assert.deepEqual([...f.states], f.originalStates); assert.deepEqual(f.mutations, []); assert.equal(sent.length, 1);
});

test('changed evidence under the old image fails the drill but exact current restoration still executes', posix, async t => {
  const { f, report, original } = await flow(t, { changedOldEvidence: true });
  assert.equal(report.passed, false); assert.equal(report.failedChecks, 1); assert.equal(report.passedChecks, 2); assert.equal(report.notExecutedChecks, 0);
  assert.equal(f.states.get('governance').Image, currentId); assert.equal(report.restoredVersionReadPassed, true);
  assert.equal(original.release.evidence.outputs[0].output, 'Original synthetic answer');
});

test('uncertain restore is counted as an attempted failed phase, not an unexecuted or successful check', posix, async t => {
  const { f, report } = await flow(t, { docker: { afterRestore: true } });
  assert.equal(report.passed, false); assert.equal(report.failedChecks, 1); assert.equal(report.passedChecks, 2); assert.equal(report.notExecutedChecks, 0);
  assert.match(report.restoreError, /partial Compose failure/); assert.equal(report.target.restored, false);
  assert.equal(f.mutations.filter(m => m.image === currentId).length, 1);
});

test('an unsuccessful switch and unsuccessful restore remain two distinct failed phases', posix, async t => {
  const { report, f } = await flow(t, { docker: { afterSwitch: true, beforeRestore: true } });
  assert.equal(report.passed, false); assert.equal(report.failedChecks, 2); assert.equal(report.passedChecks, 1); assert.equal(report.notExecutedChecks, 0);
  assert.match(report.error, /partial Compose failure/); assert.match(report.restoreError, /Compose failure/);
  assert.equal(f.states.get('governance').Image, previousId); assert.equal(f.mutations.length, 2);
});

test('restoring the process without a successful final evidence read is never accepted as a passing drill', posix, async t => {
  const { report, f } = await flow(t, { finalReadFailure: true });
  assert.equal(report.target.restored, true); assert.equal(f.states.get('governance').Image, currentId);
  assert.equal(report.passed, false); assert.equal(report.failedChecks, 1); assert.equal(report.notExecutedChecks, 0);
  assert.match(report.restoreError, /read failure after restoration/);
});
