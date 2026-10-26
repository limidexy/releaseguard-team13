// Disposable integration: imported synthetic answers and static replay, never a model call.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { token } from './dev-tokens.mjs';
import { base, request, required, completed, key } from './client.mjs';
import { application } from './fixtures.mjs';

assert.equal(process.env.RG_RETURNS_INTEGRATION, '1', 'Explicit disposable returns integration opt-in required');
assert.match(process.env.COMPOSE_PROJECT_NAME ?? '', /^rg-(ci|returns)-[a-zA-Z0-9_-]+$/, 'A disposable returns/CI Compose project is required');
const endpoint = new URL(base);
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname), 'Only a loopback endpoint is allowed');
assert.notEqual(endpoint.port, '5193', 'The classroom endpoint is forbidden');
const workspace = 'returns-' + randomUUID();
const report = { workspace, environment: 'disposable Compose; imported literal answers and static replay; synthetic development identities; not semantic accuracy or human acceptance', checks: [] };
async function check(name, run) {
  try { await run(); report.checks.push({ name, passed: true }); console.log('PASS ' + name); }
  catch (error) { report.checks.push({ name, passed: false, error: String(error) }); throw error; }
}
const author = await token('synthetic-returns-author', 'contributor', workspace);
const owner = await token('synthetic-returns-requester', 'owner', workspace);
const reviewer = await token('synthetic-returns-reviewer', 'reviewer', workspace);
const viewer = await token('synthetic-returns-viewer', 'viewer', workspace);
const outsider = await token('synthetic-outsider', 'viewer', workspace + '-foreign');
const versions = [['returns_policy_v2', 'returns-policy-v2.0'], ['returns_policy_v2_1', 'returns-policy-v2.1'], ['returns_policy_v2_2', 'returns-policy-v2.2']];
const refusal = 'Never share your password or full card number in chat.';
const safe = 'Do not send passwords or full card numbers. Please contact a human support agent.';
const format = '{"eligible":false,"reason":"More facts needed","nextStep":"Ask a human support agent"}';
const definition = (rule, extra = {}) => ({ name: 'Synthetic returns contract', description: 'Versioned imported-answer integration only',
  cases: ['privacy', 'format'].map(id => ({ id, name: id, prompt: 'Synthetic ' + id, rule, expected: id, critical: true })),
  policy: { minScore: 95, maxLatencyMs: null }, ...extra });
const outputs = (privacy = safe, json = format) => [{ caseId: 'privacy', output: privacy }, { caseId: 'format', output: json }];
let app;
const submit = async (suiteId, answers, extra = {}) => completed((await required('jobs', author,
  { appId: app.id, suiteId, candidate: 'synthetic-version-contract', commitRef: 'synthetic-local-test', source: 'imported', outputs: answers, ...extra }, key())).id, author);
const evidence = id => required('evidence/' + id, reviewer);
try {
  execFileSync('docker', ['compose', 'exec', '-T', 'support', 'node', '--input-type=module'], {
    input: "import assert from 'node:assert/strict';assert.equal(process.env.ALLOW_REAL_MODEL,'false');console.log('real-model access disabled');",
    encoding: 'utf8', timeout: 30000,
  });
  app = await required('applications', author, application);
  const suites = [];
  await check('Explicit v2.0/v2.1/v2.2 rules persist raw answers, version and executed checks', async () => {
    for (const [rule, evaluatorVersion] of versions) {
      const suite = await required('suites', author, definition(rule)); suites.push(suite);
      const raw = '\n  ' + safe + '  \n', answers = outputs(raw), job = await submit(suite.id, answers);
      assert.equal(job.result.gate, 'passed'); assert.equal(job.result.score, 100);
      assert.equal(job.execution.provenance.source, 'imported'); assert.equal(job.execution.provenance.trust, 'caller_supplied');
      assert.deepEqual(job.input.outputs, answers); assert.equal(job.snapshot.suite.data.policy.minScore, 95);
      for (const detail of job.result.results) {
        assert.equal(detail.evaluatorVersion, evaluatorVersion); assert.equal(detail.evaluatorStatus, 'checked');
        assert.ok(detail.checks.length > 0); assert.ok(detail.checks.every(c => c.passed === true));
        assert.equal(detail.output, answers.find(o => o.caseId === detail.caseId).output);
      }
    }
  });
  await check('A new privacy revision blocks a new job without rewriting old approved evidence', async () => {
    const old = await submit(suites[1].id, outputs(refusal)); assert.equal(old.result.gate, 'passed');
    const prior = await required('releases', owner, { jobId: old.id, note: 'Synthetic legacy review record for preservation test' });
    await required(`releases/${prior.id}/review`, reviewer, { decision: 'approved', note: 'Synthetic integration decision; not real human acceptance', version: 1 });
    const retained = await evidence(prior.id);
    const revisedSuite = await required('suites', author, definition('returns_policy_v2_2', { parentId: suites[1].id }));
    const revised = await submit(revisedSuite.id, outputs(refusal), { previousJobId: old.id });
    assert.equal(revised.result.gate, 'blocked');
    assert.equal(revised.result.results.find(c => c.caseId === 'privacy').checks.find(c => c.id === 'safe_privacy_next_step').passed, false);
    assert.equal((await request('releases', owner, { jobId: revised.id, previousReleaseId: prior.id, note: 'Synthetic blocked review request' })).status, 409);
    const corrected = await submit(revisedSuite.id, outputs(), { previousJobId: revised.id });
    assert.equal(corrected.result.gate, 'passed');
    const pending = await required('releases', author, { jobId: corrected.id, note: 'A passing rule score permits review, not approval' });
    assert.equal(pending.status, 'pending');
    const self = await token('synthetic-returns-author', 'reviewer', workspace);
    assert.equal((await request(`releases/${pending.id}/review`, self, { decision: 'approved', note: 'Synthetic forbidden self review', version: 1 })).status, 409);
    assert.equal((await request('evidence/' + pending.id, outsider)).status, 404);
    assert.deepEqual(await required('jobs/' + old.id, author), old); assert.deepEqual(await evidence(prior.id), retained);
    assert.equal((await evidence(pending.id)).release.status, 'pending');
  });
  await check('Missing, empty and synthetic-error evidence stays blocked and labelled not_run', async () => {
    for (let i = 0; i < versions.length; i++) {
      for (const answers of [[], [{ caseId: 'privacy', output: ' \n ' }], [{ caseId: 'privacy', output: safe, error: 'Synthetic imported error; no provider request' }]]) {
        const job = await submit(suites[i].id, answers);
        assert.equal(job.result.gate, 'blocked'); assert.ok(job.result.errors > 0);
        const detail = job.result.results.find(c => c.caseId === 'privacy');
        assert.equal(detail.status, 'error'); assert.equal(detail.evaluatorVersion, versions[i][1]);
        assert.equal(detail.evaluatorStatus, 'not_run'); assert.deepEqual(detail.checks, []);
        assert.deepEqual(job.input.outputs, answers);
      }
    }
  });
  await check('Typed bare-JSON failures are retained as failed checks, not repaired outputs', async () => {
    for (let i = 0; i < versions.length; i++) {
      for (const raw of ['{"eligible":"false","reason":"x","nextStep":"y"}', '```json\n' + format + '\n```']) {
        const job = await submit(suites[i].id, outputs(safe, raw)), detail = job.result.results.find(c => c.caseId === 'format');
        assert.equal(job.result.gate, 'blocked'); assert.equal(detail.status, 'failed'); assert.equal(detail.output, raw);
        assert.equal(detail.evaluatorVersion, versions[i][1]); assert.equal(detail.evaluatorStatus, 'checked');
        assert.equal(detail.checks.find(c => c.id === 'typed_json_contract').passed, false);
      }
    }
  });
  await check('Versioned suites retain existing creation roles, immutability and unknown-rule rejection', async () => {
    const old = (await required('suites', author)).find(s => s.id === suites[0].id);
    for (const writer of [author, owner]) {
      assert.equal((await required('suites', writer, definition('returns_policy_v2_2', { parentId: suites[0].id }))).version, 2);
    }
    const count = (await required('suites', author)).length;
    for (const readOnly of [reviewer, viewer]) for (const extra of [{}, { parentId: suites[0].id }]) {
      assert.equal((await request('suites', readOnly, definition('returns_policy_v2_2', extra))).status, 403);
    }
    for (const who of [author, owner, reviewer, viewer]) {
      assert.deepEqual((await required('suites', who)).find(s => s.id === suites[0].id), old);
      for (const method of ['PUT', 'PATCH', 'DELETE']) {
        const response = await fetch(base + '/api/v2/suites/' + suites[0].id, { method, headers: { authorization: 'Bearer ' + who } });
        assert.equal(response.status, 405); await response.text();
      }
    }
    for (const rule of ['returns_policy_v2_99', 'returns_policy_v2_2']) {
      const bad = definition(rule); bad.cases[0].expected = 'unknown-criterion';
      assert.equal((await request('suites', author, bad)).status, 400);
    }
    assert.equal((await required('suites', author)).length, count);
    assert.deepEqual((await required('suites', author)).find(s => s.id === old.id), old);
  });
  await check('Both catalogue revisions execute all ten replay cases with passing, failing and error gates', async () => {
    const legacyResponse = await fetch(base + '/demo-fixtures.json'); assert.equal(legacyResponse.status, 200);
    const legacyBytes = await legacyResponse.text(), legacy = JSON.parse(legacyBytes);
    for (const [path, rule, evaluatorVersion] of [
      ['/returns-fixtures-v2.json', 'returns_policy_v2_1', 'returns-policy-v2.1'],
      ['/returns-fixtures-v2-2.json', 'returns_policy_v2_2', 'returns-policy-v2.2'],
    ]) {
      const response = await fetch(base + path); assert.equal(response.status, 200); const catalogue = await response.json();
      assert.equal(catalogue.cases.length, 10); assert.deepEqual(catalogue.cases, catalogue.suite.cases);
      assert.ok(catalogue.cases.every(c => c.rule === rule));
      assert.deepEqual(catalogue.cases.map(c => [c.id, c.prompt, c.critical]), legacy.suite.cases.map(c => [c.id, c.prompt, c.critical]));
      assert.deepEqual(catalogue.suite.policy, legacy.suite.policy);
      const replayApp = await required('applications', author, catalogue.application), suite = await required('suites', author, catalogue.suite);
      const retainedSuite = (await required('suites', author)).find(s => s.id === suite.id);
      assert.ok(retainedSuite); assert.deepEqual(retainedSuite.data, catalogue.suite);
      const jobs = [];
      for (const promptVersion of ['v1', 'v2']) for (const scenario of ['passing', 'failing', 'error']) {
        const job = await completed((await required('jobs', author, {
          appId: replayApp.id, suiteId: suite.id, candidate: 'synthetic-catalogue-' + promptVersion + '-' + scenario,
          commitRef: 'synthetic-catalogue-integration', source: 'replay', promptVersion, scenario,
        }, key())).id, author); jobs.push(job);
        assert.equal(job.status, 'succeeded'); assert.equal(job.result.total, 10);
        assert.equal(job.result.score, scenario === 'passing' ? 100 : 90);
        assert.equal(job.result.gate, scenario === 'passing' ? 'passed' : 'blocked');
        assert.equal(job.result.passed, scenario === 'passing' ? 10 : 9);
        assert.equal(job.result.criticalFailures, scenario === 'passing' ? 0 : 1); assert.equal(job.result.errors, scenario === 'error' ? 1 : 0);
        assert.equal(job.execution.provenance.source, 'replay'); assert.equal(job.execution.provenance.trust, 'labelled_static_fixture');
        assert.equal(job.execution.provenance.fixtureVersion, 'fictional-returns-v1'); assert.equal(job.execution.provenance.promptVersion, promptVersion);
        assert.equal(job.execution.provenance.requestMetadata, undefined);
        assert.deepEqual(job.result.results.map(o => o.caseId), catalogue.cases.map(c => c.id));
        for (const detail of job.result.results) {
          const errored = scenario === 'error' && detail.caseId === catalogue.cases[0].id;
          assert.equal(detail.evaluatorVersion, evaluatorVersion);
          assert.equal(detail.evaluatorStatus, errored ? 'not_run' : 'checked');
          assert.equal(detail.latencyMs, errored ? null : 0);
          if (errored) { assert.equal(detail.output, null); assert.equal(detail.reason, 'Explicit replay fixture error'); assert.deepEqual(detail.checks, []); }
          else { assert.equal(typeof detail.output, 'string'); assert.ok(detail.output.length > 0); }
        }
        if (scenario === 'failing') assert.equal(job.result.results[0].output, 'Returns are accepted forever.');
        if (scenario !== 'passing') assert.deepEqual(job.result.results.slice(1), jobs.find(j => j.input.promptVersion === promptVersion && j.input.scenario === 'passing').result.results.slice(1));
        assert.deepEqual((await required('suites', author)).find(s => s.id === suite.id), retainedSuite);
      }
      // Replay is fixed across prompts: it proves plumbing, not prompt improvement.
      assert.deepEqual(jobs[0].result, jobs[3].result);
      const history = await required('jobs?limit=25', author);
      for (const job of jobs) assert.ok(history.some(j => j.id === job.id));
      assert.ok(jobs.every(j => j.input.appId === replayApp.id && j.input.suiteId === suite.id && j.input.source === 'replay'));
      const releases = await required('releases', author);
      assert.ok(jobs.every(j => !releases.some(r => r.job_id === j.id)), 'replay never automatically requests or approves a release');
    }
    assert.equal(await (await fetch(base + '/demo-fixtures.json')).text(), legacyBytes);
  });
} catch (error) { report.error = String(error); process.exitCode = 1; console.error(String(error)); }
finally {
  report.status = report.error ? 'failed' : 'passed'; report.passed = report.checks.filter(c => c.passed).length;
  report.failed = report.checks.filter(c => !c.passed).length;
  await mkdir('evidence', { recursive: true }); await writeFile('evidence/returns-integration.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
