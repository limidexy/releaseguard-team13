import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { token } from './dev-tokens.mjs';
import { base, required, request, completed, key } from './client.mjs';
import { application, suite } from './fixtures.mjs';

if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw Error('Local contract verification only');
const workspace = 'contracts-' + Date.now();
const author = await token('author', 'contributor', workspace);
const requester = await token('requester', 'owner', workspace);
const reviewer = await token('independent-reviewer', 'reviewer', workspace);
const outsider = await token('outsider', 'owner', 'other-' + workspace);
const report = { startedAt: new Date().toISOString(), workspace, environment: 'Local Docker / real HTTP and database / replay answers / development identities', checks: [] };
const docker = (...args) => execFileSync('docker', ['compose', ...args], { encoding: 'utf8', timeout: 120000, stdio: 'pipe' });
let registryStopped = false, evaluationStopped = false;
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
  await check('Stored idempotent retry works during Asset service outage; new job fails closed', async () => {
    docker('stop', 'registry'); registryStopped = true;
    const retry = await required('jobs', author, input, retryKey);
    assert.equal(retry.id, job.id); assert.equal(retry.replayed, true);
    assert.equal((await request('jobs', author, input, key())).status, 503);
    docker('up', '-d', '--no-deps', '--wait', 'registry'); registryStopped = false;
  });
  const release = await required('releases', requester, { jobId: job.id, note: 'Request independent review of the immutable snapshot' });
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
  await check('Metrics and arbitrary runner origins are not exposed to external callers', async () => {
    const response = await fetch(base + '/metrics'); assert.ok([401, 404].includes(response.status));
    assert.equal((await request('applications', author, { ...application, runnerUrl: 'http://169.254.169.254/metadata' })).status, 400);
    const code = docker('exec', '-T', 'gateway', 'node', '-e', "fetch('http://evaluation:8080/metrics').then(r=>console.log(r.status))").trim();
    assert.equal(code, '401');
  });
} catch (error) { report.error = String(error); process.exitCode = 1; }
finally {
  try {
    if (registryStopped) docker('up', '-d', '--no-deps', '--wait', 'registry');
    if (evaluationStopped) docker('up', '-d', '--no-deps', '--wait', 'evaluation');
  } catch (error) { report.cleanupError = String(error); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  report.passed = report.checks.filter(c => c.passed).length;
  report.failed = report.checks.filter(c => !c.passed).length;
  await mkdir('evidence/current', { recursive: true });
  await writeFile('evidence/current/ddd-contracts.json', JSON.stringify(report, null, 2));
}
