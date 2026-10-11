import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { token } from './dev-tokens.mjs';
import { request, required, completed, key, base } from './client.mjs';
import { application, suite } from './fixtures.mjs';
const workspace = 'verify-' + Date.now(), dev = await token('developer', 'contributor', workspace), reviewer = await token('reviewer', 'reviewer', workspace), reviewer2 = await token('reviewer2', 'reviewer', workspace), viewer = await token('viewer', 'viewer', workspace), other = await token('outsider', 'owner', 'other-' + Date.now()), machine = await token('machine', 'reviewer', workspace, true);
const checks = [];
async function check(name, f) { const start = performance.now(); try { await f(); checks.push({ name, passed: true, durationMs: performance.now() - start }); console.log('PASS ' + name); } catch(e) { checks.push({ name, passed: false, error: String(e) }); throw e; } }
let a, s, passed, release, approved;
const body = extra => ({ appId: a.id, suiteId: s.id, candidate: 'v1', commitRef: 'course-v2', source: 'replay', promptVersion: 'v1', scenario: 'passing', ...extra });
try {
  await check('Anonymous cannot read tenant data', async () => assert.equal((await request('jobs', '')).status, 401));
  await check('Invalid identity and direct unauthenticated internal request rejected', async () => {
    assert.equal((await request('jobs', dev.slice(0,-6)+'BADBAD')).status,401);
    const code=execFileSync('docker',['compose','exec','-T','gateway','node','-e',"fetch('http://registry:8080/internal/snapshot/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002?workspace=team13').then(r=>console.log(r.status))"],{encoding:'utf8'}).trim();assert.equal(code,'401');
  });
  await check('Asset service database credential cannot connect to review database', async () => {
    const result=execFileSync('docker',['compose','exec','-T','registry','node','--input-type=module','-e',"import pg from 'pg';const u=new URL(process.env.DATABASE_URL);u.pathname='/rg_governance';const c=new pg.Client({connectionString:u.toString()});try{await c.connect();console.log('ACCESS_GRANTED')}catch(e){console.log(e.code)}finally{await c.end()}"],{encoding:'utf8'}).trim();assert.equal(result,'42501');
  });
  await check('Viewer cannot create an application', async () => assert.equal((await request('applications', viewer, application)).status, 403));
  await check('Create independent application and immutable suite', async () => { a = await required('applications', dev, application); s = await required('suites', dev, suite); assert.equal(s.version, 1); });
  await check('Strict input rejects caller score and duplicate/unknown output IDs', async () => {
    assert.equal((await request('jobs', dev, body({ score: 100 }), key())).status, 400);
    assert.equal((await request('jobs', dev, body({ source: 'imported', outputs: [{ caseId: 'unknown', output: 'x' }] }), key())).status, 400);
    const o = { caseId: 'receipt', output: 'receipt' }; assert.equal((await request('jobs', dev, body({ source: 'imported', outputs: [o,o] }), key())).status, 400);
  });
  await check('Concurrent same-key submission yields one job; different payload conflicts', async () => {
    const k = key(), results = await Promise.all([required('jobs', dev, body(), k), required('jobs', dev, body(), k)]); assert.equal(results[0].id, results[1].id);
    assert.equal((await request('jobs', dev, body({ candidate: 'different' }), k)).status, 409); passed = await completed(results[0].id, dev); assert.equal(passed.status, 'succeeded'); assert.equal(passed.result.gate, 'passed'); assert.equal(passed.result.total, 10); assert.equal(passed.execution.provenance.source, 'replay');
  });
  await check('Suite v2 leaves prior job snapshot unchanged', async () => { const v2 = await required('suites', dev, { ...suite, parentId: s.id, policy: { minScore: 0, maxLatencyMs: null } }); assert.equal(v2.version, 2); const j = await required('jobs/' + passed.id, dev); assert.equal(j.snapshot.suite.version, 1); assert.equal(j.snapshot.suite.data.policy.minScore, 95); });
  await check('Cross-tenant job and release data unavailable', async () => assert.equal((await request('jobs/' + passed.id, other)).status, 404));
  await check('Critical failure blocks even with minScore=0 and prevents review request', async () => { const zero = await required('suites', dev, { ...suite, policy: { minScore: 0, maxLatencyMs: null } }); const j = await completed((await required('jobs', dev, body({ suiteId: zero.id, scenario: 'failing' }), key())).id, dev); assert.equal(j.result.gate, 'blocked'); assert.equal((await request('releases', dev, { jobId: j.id, note: 'Attempt a blocked release' })).status, 409); });
  await check('Missing outputs and explicit execution errors fail closed', async () => {
    const missing = await completed((await required('jobs', dev, body({ source: 'imported', outputs: [] }), key())).id, dev); assert.equal(missing.result.errors, 10); assert.equal(missing.result.gate, 'blocked');
    const failed = await completed((await required('jobs', dev, body({ scenario: 'error' }), key())).id, dev); assert.equal(failed.result.errors, 1); assert.equal(failed.result.gate, 'blocked');
  });
  await check('Create pending release; duplicate release conflicts', async () => { release = await required('releases', dev, { jobId: passed.id, note: 'Independent business review required' }); assert.equal(release.status, 'pending'); assert.equal((await request('releases', dev, { jobId: passed.id, note: 'Duplicate release' })).status, 409); });
  const decision = { decision: 'approved', note: 'Reviewed all outputs against the fictional policy', version: 1 };
  await check('Self-review and machine review are blocked', async () => { const self = await token('developer', 'owner', workspace); assert.equal((await request(`releases/${release.id}/review`, self, decision)).status, 409); assert.equal((await request(`releases/${release.id}/review`, machine, decision)).status, 403); });
  await check('Machine submission retains human accountability and blocks issuer self-review', async () => {
    const service=await token('build-job','contributor',workspace,true,'developer'),owner=await token('developer','owner',workspace);
    const j=await completed((await required('jobs',service,body(),key())).id,dev);assert.equal(j.created_by,'developer');
    const r=await required('releases',service,{jobId:j.id,note:'Machine request requires independent human review'});
    assert.equal((await request(`releases/${r.id}/review`,owner,decision)).status,409);
  });
  await check('Stale review rejected; competing reviewers produce one terminal decision', async () => {
    assert.equal((await request(`releases/${release.id}/review`, reviewer, { ...decision, version: 99 })).status, 409);
    const race = await Promise.all([request(`releases/${release.id}/review`, reviewer, decision), request(`releases/${release.id}/review`, reviewer2, { ...decision, decision: 'rejected' })]); assert.deepEqual(race.map(r => r.status).sort(), [200,409]); approved = race.find(r => r.status === 200).data;
    assert.equal((await request(`releases/${release.id}/review`, reviewer, { ...decision, version: 2 })).status, 409);
  });
  await check('Evidence preserves snapshot, request note and exactly one decision audit', async () => { const e = await required('evidence/' + release.id, reviewer); assert.equal(e.audit.length, 2); assert.equal(e.release.request_note, 'Independent business review required'); assert.equal(e.release.evidence.id, passed.id); assert.equal(e.release.status, approved.status); assert.equal((await request('evidence/' + release.id, other)).status, 404); });
  await check('Consuming CLI exits 3 for blocked job and 0 only for rule eligibility', async () => {
    await mkdir('evidence/private',{recursive:true});
    for(const [scenario,expected] of [['failing',3],['passing',0]]){
      const file='evidence/private/cli-input.json';await writeFile(file,JSON.stringify(body({scenario})));
      let status=0;try{execFileSync(process.execPath,['scripts/releaseguard-cli.mjs','evaluate',file],{env:{...process.env,RELEASEGUARD_TOKEN:dev,RELEASEGUARD_URL:base},stdio:'pipe'})}catch(e){status=e.status}assert.equal(status,expected);
    }
  });
  if (process.argv.includes('--restart')) {
    await check('Committed evidence survives service container restart', async () => {
      execFileSync('docker', ['compose','restart','gateway','registry','evaluation','governance','worker'], { stdio: 'pipe' });
      let ready = false;
      for (let i=0;i<150;i++) { try { const e = await required('evidence/' + release.id, reviewer); if (e.audit.length === 2) { ready=true; break; } } catch {} await new Promise(r => setTimeout(r, 300)); }
      assert.equal(ready,true);
    });
  }
} catch(e) { console.error(String(e)); process.exitCode = 1; }
finally {
  await mkdir('evidence', { recursive:true });
  await writeFile('evidence/integration-local.json', JSON.stringify({ time:new Date().toISOString(), environment:'Local Docker containers; development JWT identities and replay fixtures', base, workspace, cloud:false, checks, passed:checks.filter(c=>c.passed).length, failed:checks.filter(c=>!c.passed).length, jobId:passed?.id,releaseId:release?.id },null,2));
}
