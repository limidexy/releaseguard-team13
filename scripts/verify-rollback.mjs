// Isolated artifact rollback drill: replay only, no cloud or database restore.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { contractTarget } from './contract-target.mjs';
import { rollbackTarget, validateRollbackEnvironment } from './rollback-target.mjs';
import { loadRetainedRollbackImage } from './rollback-artifacts.mjs';

function outcome(report) {
  const passed = report.previousVersionReadPassed === true && report.restoredVersionReadPassed === true && !report.error && !report.restoreError;
  return { passedChecks: report.checks.filter(c => c.passed).length, failedChecks: report.checks.filter(c => !c.passed).length,
    notExecutedChecks: report.totalChecks - report.checks.length, passed, status: passed ? 'passed' : 'failed' };
}

// HTTP is an adapter; the same orchestration is used by the CLI and offline
// failure regressions. It never chooses a model, approves a release or retries.
export async function runRollbackVerification({ target, client, identity, application, suite, workspace, report }) {
  const { required, completed, key } = client;
  let before, readEvidence;
  async function check(name, action) {
    try { await action(); report.checks.push({ name, passed: true }); console.log('PASS ' + name); }
    catch (error) { report.checks.push({ name, passed: false, error: String(error) }); throw error; }
  }
  try {
    await check('Current artifact captures immutable replay evidence before rollback', async () => {
      const a = await required('applications', identity, application), s = await required('suites', identity, suite);
      const job = await completed((await required('jobs', identity, {
        appId: a.id, suiteId: s.id, candidate: workspace, commitRef: 'synthetic-artifact-drill',
        source: 'replay', scenario: 'passing', promptVersion: 'v1',
      }, key())).id, identity);
      assert.equal(job.result.gate, 'passed'); assert.equal(job.execution.provenance.source, 'replay');
      const release = await required('releases', identity, { jobId: job.id, note: 'Synthetic pending evidence only; never a human approval' });
      readEvidence = () => required('evidence/' + release.id, identity);
      before = await readEvidence();
      assert.equal(before.release.status, 'pending'); assert.deepEqual(before.audit.map(a => a.action), ['ReleaseRequested']);
      report.releaseId = release.id; report.evidenceDigest = before.evidenceDigest;
    });
    await check('The retained previous artifact reads the exact original snapshot and audit', async () => {
      await target.switchPrevious(); assert.deepEqual(await readEvidence(), before); report.previousVersionReadPassed = true;
    });
  } catch (error) { report.error = String(error); }
  finally {
    try {
      if (target.details.switchAttempted) {
        await check('Exact current artifact is restored with unchanged evidence and dependencies', async () => {
          await target.restoreOriginal();
          assert.equal(target.details.restored, true); assert.deepEqual(await readEvidence(), before);
          report.restoredVersionReadPassed = true;
        });
      } else await target.restoreOriginal();
    } catch (error) { report.restoreError = String(error); }
    report.target = target.details; Object.assign(report, outcome(report));
  }
  return report;
}

async function main() {
  // Reject unsafe targets before tokens, HTTP, process commands or report files.
  const { proofEnv } = validateRollbackEnvironment(process.env);
  const workspace = 'rollback-' + randomUUID(), reportDir = 'evidence/' + workspace;
  await mkdir('evidence', { recursive: true }); await mkdir(reportDir);
  const report = { startedAt: new Date().toISOString(), workspace, environment: 'Disposable Compose / synthetic replay and development identity; not cloud, database recovery, model testing or human acceptance',
    cloud: false, databaseRestore: false, checks: [], passed: false, totalChecks: 3 };
  let target;
  try {
    let env = process.env;
    if (env.RG_ROLLBACK_ARTIFACT_DIR) {
      // Loading the old archive can retarget its tag. Prove the running target,
      // then restore that exact current alias before any service switch.
      const preflight = contractTarget(proofEnv);
      report.preloadContainers = await preflight.prove(); report.preloadHealthObservations = preflight.observations;
      report.retainedArtifact = await loadRetainedRollbackImage(env, report.preloadContainers.governance.image);
      env = { ...env, RG_ROLLBACK_IMAGE: report.retainedArtifact.previousId };
    }
    target = rollbackTarget(env, reportDir); report.target = await target.prove();
    if (report.retainedArtifact) assert.equal(report.target.previous.config, report.retainedArtifact.previousConfig);
    const { token } = await import('./dev-tokens.mjs');
    const client = await import('./client.mjs');
    const { application, suite } = await import('./fixtures.mjs');
    const identity = await token('synthetic-rollback-author', 'contributor', workspace);
    await runRollbackVerification({ target, client, identity, application, suite, workspace, report });
  } catch (error) {
    report.error = String(error); if (error.record) report.retainedArtifactFailure = error.record;
    // Pre-business failures have no switch intent. Never recreate a service.
    if (target && !target.details.switchAttempted) {
      try { await target.restoreOriginal(); } catch (error) { report.restoreError = String(error); }
    }
  } finally {
    if (target) report.target = target.details;
    report.finishedAt = new Date().toISOString(); Object.assign(report, outcome(report));
    report.limits = 'Only this exact retained image/current image and existing snapshot are checked. Not universal schema rollback, a DB restore, HA or a recovery SLA. Image/config/CI receipts are not digital signatures. Restoration intent is in-process, not hard-kill recovery.';
    await writeFile(reportDir + '/rollback.json', JSON.stringify(report, null, 2), { flag: 'wx' });
    console.log(JSON.stringify(report, null, 2)); if (!report.passed) process.exitCode = 1;
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
