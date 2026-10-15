import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { token } from './dev-tokens.mjs';
import { base, required, request, completed, key } from './client.mjs';
import { application, suite } from './fixtures.mjs';
import { returnsSuiteV22 } from '../dist/src/returns-policy.js';

if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw Error('Local contract verification only');
const workspace = 'contracts-' + Date.now();
const author = await token('author', 'contributor', workspace);
const requester = await token('requester', 'owner', workspace);
const reviewer = await token('independent-reviewer', 'reviewer', workspace);
const reviewer2 = await token('second-reviewer', 'reviewer', workspace);
const viewer = await token('observer', 'viewer', workspace);
const outsider = await token('outsider', 'owner', 'other-' + workspace);
const report = { startedAt: new Date().toISOString(), workspace, environment: 'Local Docker / real HTTP and database / replay answers / development identities', checks: [] };
const docker = (...args) => execFileSync('docker', ['compose', ...args], { encoding: 'utf8', timeout: 120000, stdio: 'pipe' });
let registryStopped = false, evaluationStopped = false, workerPaused = false;
async function check(name, fn) {
  const start = performance.now();
  try { await fn(); report.checks.push({ name, passed: true, durationMs: performance.now() - start }); console.log('PASS ' + name); }
  catch (e) { report.checks.push({ name, passed: false, error: String(e) }); throw e; }
}
try {
  const app = await required('applications', author, application), s = await required('suites', author, suite);
  const input = { appId: app.id, suiteId: s.id, candidate: 'ddd-contract', commitRef: 'course-local', source: 'replay', scenario: 'passing' };
  await check('Assets cannot be referenced from another workspace, including suite parents', async () => {
    assert.equal((await request('jobs', outsider, input, key())).status, 404);
    assert.equal((await request('suites', outsider, { ...suite, parentId: s.id })).status, 404);
  });
  const retryKey = key(), queued = await required('jobs', author, input, retryKey);
  const job = await completed(queued.id, author);
  assert.equal(job.result.gate, 'passed');
  await check('Idempotent retries preserve one job and one outbox record; conflicts do not mutate input', async () => {
    const retries = await Promise.all(Array.from({ length: 6 }, () => required('jobs', author, input, retryKey)));
    assert.ok(retries.every(r => r.id === job.id && r.replayed === true));
    assert.equal((await request('jobs', author, { ...input, candidate: 'changed-candidate' }, retryKey)).status, 409);
    const retained = await required('jobs/' + job.id, author);
    assert.deepEqual(retained.input, job.input);
    assert.deepEqual(retained.snapshot, job.snapshot);
    assert.deepEqual(retained.result, job.result);
    // Read only the Evaluation-owned database using that service's own login.
    const code = `import pg from 'pg';const c=new pg.Client({connectionString:process.env.DATABASE_URL});try{await c.connect();const r=await c.query('SELECT (SELECT count(*)::integer FROM jobs WHERE workspace=$1 AND idempotency_key=$2) AS jobs,(SELECT count(*)::integer FROM outbox WHERE job_id=$3) AS outbox',${JSON.stringify([workspace, retryKey, job.id])});console.log(JSON.stringify(r.rows[0]))}finally{await c.end()}`;
    const counts = JSON.parse(docker('exec', '-T', 'evaluation', 'node', '--input-type=module', '-e', code).trim());
    assert.deepEqual(counts, { jobs: 1, outbox: 1 });
  });
  await check('Read-only and cross-workspace submission attempts create no jobs', async () => {
    const before = await required('jobs', author);
    assert.equal((await request('jobs', viewer, input, key())).status, 403);
    assert.equal((await request('jobs', outsider, input, key())).status, 404);
    assert.deepEqual(await required('jobs', author), before);
    assert.deepEqual(await required('jobs', outsider), []);
  });
  await check('Stored idempotent retry works during Asset service outage; new job fails closed', async () => {
    docker('stop', 'registry'); registryStopped = true;
    const retry = await required('jobs', author, input, retryKey);
    assert.equal(retry.id, job.id); assert.equal(retry.replayed, true);
    assert.equal((await request('jobs', author, input, key())).status, 503);
    docker('up', '-d', '--no-deps', '--wait', 'registry'); registryStopped = false;
  });
  const release = await required('releases', requester, { jobId: job.id, note: 'Request independent review of the immutable snapshot' });
  await check('Rejected review commands leave pending state, evidence and audit unchanged', async () => {
    const before = await required('evidence/' + release.id, reviewer);
    const decision = { decision: 'approved', note: 'Validate review guards without changing state', version: 1 };
    for (const [identity, command, status] of [
      [author, decision, 403],
      [viewer, decision, 403],
      [outsider, decision, 404],
      [reviewer, { ...decision, version: 99 }, 409],
      [reviewer, { ...decision, version: 0 }, 400],
      [reviewer, { ...decision, decision: 'pending' }, 400],
    ]) assert.equal((await request(`releases/${release.id}/review`, identity, command)).status, status);
    const after = await required('evidence/' + release.id, reviewer);
    assert.deepEqual(after, before);
    assert.equal(after.release.status, 'pending'); assert.equal(after.release.version, 1);
    assert.deepEqual(after.audit.map(a => a.action), ['ReleaseRequested']);
    assert.equal((await request('evidence/' + release.id, outsider)).status, 404);
  });
  await check('A requester distinct from the job author still cannot approve their own request', async () => {
    assert.equal((await request(`releases/${release.id}/review`, requester, { decision: 'approved', note: 'Requester must not review this request', version: 1 })).status, 409);
  });
  await check('Captured review evidence stays usable while Evaluation service is down', async () => {
    docker('stop', 'evaluation'); evaluationStopped = true;
    const before = await required('evidence/' + release.id, reviewer);
    assert.equal(before.release.evidence.id, job.id);
    const decided = await required(`releases/${release.id}/review`, reviewer, { decision: 'rejected', note: 'Independent test decision; exercise terminal rejection', version: 1 });
    assert.equal(decided.status, 'rejected'); assert.equal(decided.version, 2);
    const after = await required('evidence/' + release.id, reviewer);
    assert.equal(after.evidenceDigest, before.evidenceDigest);
    assert.deepEqual(after.audit.map(a => a.action), ['ReleaseRequested', 'ReleaseRejected']);
    assert.equal((await request('releases', author, { jobId: job.id, note: 'New capture requires upstream availability' })).status, 503);
    docker('up', '-d', '--no-deps', '--wait', 'evaluation'); evaluationStopped = false;
  });
  await check('Competing decisions commit one terminal state and one matching decision audit', async () => {
    const next = await completed((await required('jobs', author, { ...input, candidate: 'review-race' }, key())).id, author);
    const pending = await required('releases', requester, { jobId: next.id, note: 'Race two independent reviewers against one version' });
    const before = await required('evidence/' + pending.id, reviewer);
    const responses = await Promise.all([
      request(`releases/${pending.id}/review`, reviewer, { decision: 'approved', note: 'First independent simulated decision', version: 1 }),
      request(`releases/${pending.id}/review`, reviewer2, { decision: 'rejected', note: 'Second independent simulated decision', version: 1 }),
    ]);
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
    const winner = responses.find(r => r.status === 200).data;
    const after = await required('evidence/' + pending.id, reviewer);
    assert.equal(after.release.status, winner.status); assert.equal(after.release.version, 2);
    assert.equal(after.evidenceDigest, before.evidenceDigest);
    assert.deepEqual(after.release.evidence, before.release.evidence);
    assert.deepEqual(after.audit.map(a => a.action), ['ReleaseRequested', winner.status === 'approved' ? 'ReleaseApproved' : 'ReleaseRejected']);
    assert.equal((await request(`releases/${pending.id}/review`, reviewer2, { decision: 'approved', note: 'A terminal decision cannot be changed', version: 2 })).status, 409);
    assert.deepEqual(await required('evidence/' + pending.id, reviewer), after);
  });
  await check('Metrics and arbitrary runner origins are not exposed to external callers', async () => {
    const response = await fetch(base + '/metrics'); assert.ok([401, 404].includes(response.status));
    assert.equal((await request('applications', author, { ...application, runnerUrl: 'http://169.254.169.254/metadata' })).status, 400);
    const code = docker('exec', '-T', 'gateway', 'node', '-e', "fetch('http://evaluation:8080/metrics').then(r=>console.log(r.status))").trim();
    assert.equal(code, '401');
  });
  let linkedJob, linkedRelease;
  await check('Re-evaluation links a new job and review while preserving terminal history', async () => {
    const oldJob = await required('jobs/' + job.id, author);
    const oldReview = await required('evidence/' + release.id, reviewer);
    const body = { ...input, candidate: 'linked-evaluation', previousJobId: job.id };
    const k = key();
    linkedJob = await completed((await required('jobs', author, body, k)).id, author);
    assert.notEqual(linkedJob.id, job.id); assert.equal(linkedJob.input.previousJobId, job.id);
    assert.equal((await required('jobs', author, body, k)).id, linkedJob.id);
    assert.equal((await request('jobs', author, input, k)).status, 409);
    linkedRelease = await required('releases', requester, { jobId: linkedJob.id, previousReleaseId: release.id, note: 'Re-evaluate while preserving the original decision' });
    const linked = await required('evidence/' + linkedRelease.id, reviewer);
    assert.equal(linked.release.previous_release_id, release.id);
    assert.equal(linked.release.evidence.input.previousJobId, job.id);
    assert.equal(linked.audit[0].details.previousReleaseId, release.id);
    assert.equal(linked.audit[0].details.previousJobId, job.id);
    assert.equal((await required('releases', reviewer)).find(r => r.id === linkedRelease.id).previous_release_id, release.id);
    assert.equal((await required('jobs', author)).find(j => j.id === linkedJob.id).previous_job_id, job.id);
    await required(`releases/${linkedRelease.id}/review`, reviewer, { decision: 'approved', note: 'Independent decision on the new linked evidence', version: 1 });
    assert.deepEqual(await required('jobs/' + job.id, author), oldJob);
    assert.deepEqual(await required('evidence/' + release.id, reviewer), oldReview);
  });
  await check('Job lineage rejects missing, foreign-workspace and different-application parents', async () => {
    const otherApp = await required('applications', author, { ...application, name: 'Separate application' });
    const before = await required('jobs', author);
    assert.equal((await request('jobs', author, { ...input, previousJobId: key() }, key())).status, 404);
    assert.equal((await request('jobs', outsider, { ...input, previousJobId: job.id }, key())).status, 404);
    assert.equal((await request('jobs', author, { ...input, appId: otherApp.id, previousJobId: job.id }, key())).status, 409);
    assert.deepEqual(await required('jobs', author), before);
  });
  await check('Review lineage cannot point at unrelated or foreign-workspace decisions', async () => {
    const j = await completed((await required('jobs', author, { ...input, candidate: 'lineage-negative', previousJobId: job.id }, key())).id, author);
    const before = await required('releases', reviewer);
    assert.equal((await request('releases', requester, { jobId: j.id, previousReleaseId: key(), note: 'Missing previous review must be rejected' })).status, 404);
    assert.equal((await request('releases', requester, { jobId: j.id, previousReleaseId: linkedRelease.id, note: 'Unrelated job lineage must be rejected' })).status, 409);
    assert.deepEqual(await required('releases', reviewer), before);
    const foreignApp = await required('applications', outsider, application), foreignSuite = await required('suites', outsider, suite);
    const foreignJob = await completed((await required('jobs', outsider, { ...input, appId: foreignApp.id, suiteId: foreignSuite.id }, key())).id, outsider);
    assert.equal((await request('releases', outsider, { jobId: foreignJob.id, previousReleaseId: release.id, note: 'Another workspace cannot reference this review' })).status, 404);
    assert.deepEqual(await required('releases', outsider), []);
    // If the client omits the review pointer, resolve it from the validated job lineage.
    const automatic = await required('releases', requester, { jobId: j.id, note: 'Automatically retain the matching prior review' });
    assert.equal((await required('evidence/' + automatic.id, reviewer)).release.previous_release_id, release.id);
  });
  await check('A pending predecessor cannot be bypassed by omitting the previous review ID', async () => {
    const pendingJob = await completed((await required('jobs', author, { ...input, candidate: 'pending-predecessor' }, key())).id, author);
    const pendingReview = await required('releases', requester, { jobId: pendingJob.id, note: 'Leave this predecessor pending for the test' });
    const child = await completed((await required('jobs', author, { ...input, candidate: 'pending-child', previousJobId: pendingJob.id }, key())).id, author);
    const before = await required('evidence/' + pendingReview.id, reviewer);
    for (const extra of [{}, { previousReleaseId: pendingReview.id }]) assert.equal((await request('releases', requester, { jobId: child.id, note: 'Pending review is not a terminal predecessor', ...extra })).status, 409);
    assert.deepEqual(await required('evidence/' + pendingReview.id, reviewer), before);
    assert.equal((await required('releases', reviewer)).some(r => r.job_id === child.id), false);
  });
  await check('An unfinished job cannot be referenced as a completed predecessor', async () => {
    docker('pause', 'worker'); workerPaused = true;
    try {
      const pending = await required('jobs', author, { ...input, candidate: 'queued-parent' }, key());
      assert.equal((await request('jobs', author, { ...input, candidate: 'queued-child', previousJobId: pending.id }, key())).status, 409);
    } finally { docker('unpause', 'worker'); workerPaused = false; }
  });
  await check('Suite permissions allow owner/contributor creation and all four roles to read', async () => {
    const before = (await required('suites', author)).find(x => x.id === s.id);
    for (const identity of [requester, author]) {
      const root = await required('suites', identity, suite);
      assert.equal(root.version, 1); assert.notEqual(root.id, s.id);
      const appended = await required('suites', identity, { ...suite, parentId: s.id });
      assert.equal(appended.version, 2); assert.notEqual(appended.id, s.id);
    }
    const count = (await required('suites', author)).length;
    for (const identity of [reviewer, viewer]) {
      assert.equal((await request('suites', identity, suite)).status, 403);
      assert.equal((await request('suites', identity, { ...suite, parentId: s.id })).status, 403);
    }
    assert.equal((await required('suites', author)).length, count);
    for (const identity of [requester, author, reviewer, viewer]) {
      assert.deepEqual((await required('suites', identity)).find(x => x.id === s.id), before);
    }
  });
  await check('Existing suite versions cannot be replaced or deleted through any role', async () => {
    const before = (await required('suites', author)).find(x => x.id === s.id);
    for (const identity of [requester, author, reviewer, viewer]) {
      for (const method of ['PUT', 'PATCH', 'DELETE']) {
        const response = await fetch(`${base}/api/v2/suites/${s.id}`, { method, headers: { authorization: 'Bearer ' + identity } });
        assert.equal(response.status, 405);
      }
      assert.equal((await request('suites/' + s.id, identity, { ...suite, name: 'Overwrite forbidden' })).status, 404);
    }
    assert.deepEqual((await required('suites', author)).find(x => x.id === s.id), before);
    assert.deepEqual((await required('jobs/' + job.id, author)).snapshot, job.snapshot);
  });
  await check('Reviewer suite read-only status does not remove independent decision authority', async () => {
    assert.equal((await request('suites', reviewer, suite)).status, 403);
    const j = await completed((await required('jobs', author, { ...input, candidate: 'reviewer-authority' }, key())).id, author);
    const r = await required('releases', requester, { jobId: j.id, note: 'Independent reviewer retains decision authority' });
    const decision = await required(`releases/${r.id}/review`, reviewer, { decision: 'approved', note: 'Approve evidence while retaining read-only suite access', version: 1 });
    assert.equal(decision.status, 'approved'); assert.equal(decision.version, 2);
    assert.equal((await request('suites', reviewer, suite)).status, 403);
  });
  await check('Privacy v2.2 requires safe guidance and preserves stored v2.1 results and approval', async () => {
    const privacy = { name: 'Privacy acceptance v2.1', description: 'Versioned synthetic contract evidence', cases: [{ id: 'privacy', name: 'Privacy', prompt: 'Can I send secrets?', rule: 'returns_policy_v2_1', expected: 'privacy', critical: true }], policy: { minScore: 95, maxLatencyMs: null } };
    const oldSuite = await required('suites', author, privacy);
    const outputs = [{ caseId: 'privacy', output: 'Never share your password or full card number in chat.' }];
    const oldJob = await completed((await required('jobs', author, { ...input, source: 'imported', suiteId: oldSuite.id, outputs }, key())).id, author);
    assert.equal(oldJob.result.gate, 'passed'); assert.equal(oldJob.result.results[0].evaluatorVersion, 'returns-policy-v2.1');
    const oldRelease = await required('releases', requester, { jobId: oldJob.id, note: 'Historical synthetic v2.1 approval for preservation test' });
    await required(`releases/${oldRelease.id}/review`, reviewer, { decision: 'approved', note: 'Synthetic legacy-version decision; no business acceptance', version: 1 });
    const oldEvidence = await required('evidence/' + oldRelease.id, reviewer);
    const revised = await required('suites', author, { ...returnsSuiteV22(privacy), parentId: oldSuite.id });
    const blocked = await completed((await required('jobs', author, { ...input, source: 'imported', suiteId: revised.id, outputs, previousJobId: oldJob.id }, key())).id, author);
    assert.equal(blocked.result.gate, 'blocked'); assert.equal(blocked.result.results[0].evaluatorVersion, 'returns-policy-v2.2');
    assert.equal(blocked.result.results[0].checks.find(c => c.id === 'safe_privacy_next_step').passed, false);
    assert.equal((await request('releases', requester, { jobId: blocked.id, previousReleaseId: oldRelease.id, note: 'A blocked v2.2 job cannot request review' })).status, 409);
    const corrected = await completed((await required('jobs', author, { ...input, source: 'imported', suiteId: revised.id, previousJobId: blocked.id, outputs: [{ caseId: 'privacy', output: outputs[0].output + ' Please contact a human support agent through the secure support channel.' }] }, key())).id, author);
    assert.equal(corrected.result.gate, 'passed'); assert.equal(corrected.result.results[0].evaluatorVersion, 'returns-policy-v2.2');
    assert.deepEqual(await required('jobs/' + oldJob.id, author), oldJob);
    assert.deepEqual(await required('evidence/' + oldRelease.id, reviewer), oldEvidence);
    assert.equal((await required('suites', author)).find(x => x.id === oldSuite.id).data.cases[0].rule, 'returns_policy_v2_1');
  });
} catch (error) { report.error = String(error); process.exitCode = 1; }
finally {
  try {
    if (registryStopped) docker('up', '-d', '--no-deps', '--wait', 'registry');
    if (evaluationStopped) docker('up', '-d', '--no-deps', '--wait', 'evaluation');
    if (workerPaused) docker('unpause', 'worker');
  } catch (error) { report.cleanupError = String(error); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  report.passed = report.checks.filter(c => c.passed).length;
  report.failed = report.checks.filter(c => !c.passed).length;
  await mkdir('evidence/current', { recursive: true });
  await writeFile('evidence/current/ddd-contracts.json', JSON.stringify(report, null, 2));
}
