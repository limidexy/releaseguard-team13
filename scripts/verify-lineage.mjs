// Synthetic integration only, in a separately named disposable Compose project.
// This never connects to the classroom database or calls a model.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { token } from './dev-tokens.mjs';
import { base, required, request, completed, key } from './client.mjs';
import { application, suite } from './fixtures.mjs';

assert.equal(process.env.RG_LINEAGE_INTEGRATION, '1', 'Explicit disposable integration opt-in required');
assert.match(process.env.COMPOSE_PROJECT_NAME ?? '', /^rg-(ci|lineage)-[a-zA-Z0-9_-]+$/, 'A disposable rg-ci/rg-lineage Compose project is required');
const endpoint = new URL(base);
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname), 'Only a loopback endpoint is allowed');
assert.notEqual(endpoint.port, '5193', 'The classroom endpoint is forbidden');
const workspace = 'lineage-' + randomUUID();
const report = { workspace, environment: 'disposable Compose, synthetic replay and development identities; not cloud, model or human acceptance', checks: [] };
const inside = (service, code) => execFileSync('docker', ['compose', 'exec', '-T', service, 'node', '--input-type=module'], {
  input: code, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024,
}).trim();
async function check(name, run) {
  try { await run(); report.checks.push({ name, passed: true }); console.log('PASS ' + name); }
  catch (error) { report.checks.push({ name, passed: false, error: String(error) }); throw error; }
}
const author = await token('synthetic-author', 'contributor', workspace);
const requester = await token('synthetic-requester', 'owner', workspace);
const reviewer = await token('synthetic-independent-reviewer', 'reviewer', workspace);
const viewer = await token('synthetic-viewer', 'viewer', workspace);
const outsider = await token('synthetic-outsider', 'contributor', workspace + '-foreign');
const jobRows = () => required('jobs?limit=100', author);
const reviews = () => required('releases', reviewer);
const evidence = id => required('evidence/' + id, reviewer);
const decide = (id, decision = 'approved') => required(`releases/${id}/review`, reviewer,
  { decision, note: 'Synthetic integration decision only; not a real human approval', version: 1 });
let input;
const submit = async extra => completed((await required('jobs', author, { ...input, ...extra }, key())).id, author);
const reviewRequest = (job, extra = {}) => required('releases', requester,
  { jobId: job.id, note: 'Synthetic integration request for new evidence', ...extra });
try {
  inside('support', "import assert from 'node:assert/strict';assert.equal(process.env.ALLOW_REAL_MODEL,'false');console.log('real-model access disabled');");
  const a = await required('applications', author, application), s = await required('suites', author, suite);
  input = { appId: a.id, suiteId: s.id, candidate: 'lineage-integration', commitRef: 'synthetic-local-test', source: 'replay', scenario: 'passing' };
  const initial = await submit({});
  assert.equal(initial.result.gate, 'passed'); assert.equal(initial.execution.provenance.source, 'replay');
  await check('Additive migration preserves legacy rows/audit, repeats safely, enforces FK and rolls back audit failure', async () => {
    inside('governance', `
      import assert from 'node:assert/strict'; import pg from 'pg'; import {randomUUID} from 'node:crypto';
      const schema='rg_lineage_'+randomUUID().replaceAll('-','');assert.match(schema,/^rg_lineage_[a-f0-9]+$/);
      const control=new pg.Client({connectionString:process.env.DATABASE_URL});await control.connect();let app,pool;
      try {
        await control.query('CREATE SCHEMA '+schema);
        const url=new URL(process.env.DATABASE_URL);url.searchParams.set('options','-csearch_path='+schema);process.env.DATABASE_URL=url.toString();
        const common=await import('./dist/src/common.js');pool=common.pool;
        assert.equal((await pool.query('SELECT current_schema() AS s')).rows[0].s,schema);
        await pool.query(\`CREATE TABLE releases(id uuid PRIMARY KEY,workspace text NOT NULL,job_id uuid NOT NULL UNIQUE,created_by text NOT NULL,requested_by text NOT NULL,status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),version integer NOT NULL DEFAULT 1,evidence jsonb NOT NULL,request_note text NOT NULL,review_note text,reviewed_by text,created_at timestamptz NOT NULL DEFAULT now(),reviewed_at timestamptz);
          CREATE TABLE audit(seq bigserial PRIMARY KEY,id uuid NOT NULL UNIQUE,workspace text NOT NULL,actor text NOT NULL,action text NOT NULL,entity_id uuid NOT NULL,details jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());\`);
        const oldId=randomUUID();
        await pool.query("INSERT INTO releases(id,workspace,job_id,created_by,requested_by,status,version,evidence,request_note,review_note,reviewed_by,reviewed_at) VALUES($1,$2,$3,'legacy-author','legacy-requester','approved',2,$4,'legacy request','legacy synthetic decision','legacy-reviewer',now())",[oldId,${JSON.stringify(workspace)},randomUUID(),{result:{gate:'passed'},legacy:true}]);
        await pool.query("INSERT INTO audit(id,workspace,actor,action,entity_id,details) VALUES($1,$2,'legacy-reviewer','ReleaseApproved',$3,$4)",[randomUUID(),${JSON.stringify(workspace)},oldId,{legacy:true}]);
        const before=(await pool.query('SELECT * FROM releases')).rows[0],beforeAudit=(await pool.query('SELECT * FROM audit ORDER BY seq')).rows;
        const {governance}=await import('./dist/src/governance.js');
        for(let i=0;i<2;i++){app=common.server();app.log.level='silent';await governance(app);await app.close();app=undefined;}
        const after=(await pool.query('SELECT * FROM releases')).rows[0];assert.equal(after.previous_release_id,null);delete after.previous_release_id;assert.deepEqual(after,before);
        assert.deepEqual((await pool.query('SELECT * FROM audit ORDER BY seq')).rows,beforeAudit);
        await assert.rejects(pool.query("INSERT INTO releases(id,workspace,job_id,created_by,requested_by,evidence,request_note,previous_release_id) VALUES($1,$2,$3,'test','test','{}','synthetic FK test',$4)",[randomUUID(),${JSON.stringify(workspace)},randomUUID(),randomUUID()]),{code:'23503'});
        await pool.query(\`CREATE FUNCTION fail_lineage_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$; CREATE TRIGGER fail_lineage_audit BEFORE INSERT ON audit FOR EACH ROW EXECUTE FUNCTION fail_lineage_audit();\`);
        app=common.server();app.log.level='silent';await governance(app);
        const response=await app.inject({method:'POST',url:'/releases',headers:{authorization:'Bearer '+${JSON.stringify(author)}},payload:{jobId:${JSON.stringify(initial.id)},note:'Synthetic rollback test only'}});
        assert.equal(response.statusCode,503);
        assert.equal((await pool.query('SELECT count(*)::int AS n FROM releases')).rows[0].n,1);
        assert.deepEqual((await pool.query('SELECT * FROM audit ORDER BY seq')).rows,beforeAudit);
        console.log('legacy migration, FK and actual rollback checked');
      } finally {if(app)await app.close();if(pool)await pool.end();await control.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');await control.end();}
    `);
  });
  const terminals = [];
  await check('New job/review linkage preserves both approved and rejected histories, including automatic pointers', async () => {
    const revised = await required('suites', author, { ...suite, parentId: s.id });
    for (const decision of ['approved', 'rejected']) {
      const parent = await submit({ candidate: 'parent-' + decision }), prior = await reviewRequest(parent);
      await decide(prior.id, decision);
      const savedJob = await required('jobs/' + parent.id, author), savedReview = await evidence(prior.id);
      for (const explicit of [true, false]) {
        const body = { ...input, suiteId: revised.id, candidate: decision + '-' + explicit, previousJobId: parent.id }, k = key();
        const child = await completed((await required('jobs', author, body, k)).id, author);
        assert.equal(child.input.previousJobId, parent.id); assert.equal(child.snapshot.suite.version, 2);
        assert.equal((await required('jobs', author, body, k)).id, child.id);
        const {previousJobId: _omitted, ...withoutPointer} = body;
        assert.equal((await request('jobs', author, withoutPointer, k)).status,409);
        const linked = await reviewRequest(child, explicit ? { previousReleaseId: prior.id } : {}), captured = await evidence(linked.id);
        assert.equal(captured.release.previous_release_id, prior.id); assert.equal(captured.audit[0].details.previousJobId,parent.id);
        assert.equal(captured.audit[0].details.previousReleaseId,prior.id);
        assert.equal((await reviews()).find(r=>r.id===linked.id).previous_release_id,prior.id);
        assert.equal((await jobRows()).find(j=>j.id===child.id).previous_job_id,parent.id);
        await decide(linked.id);
      }
      assert.deepEqual(await required('jobs/' + parent.id, author),savedJob); assert.deepEqual(await evidence(prior.id),savedReview);
      assert.equal((await request(`releases/${prior.id}/review`,reviewer,{decision:'approved',note:'Synthetic forbidden reopen',version:2})).status,409);
      assert.deepEqual(await evidence(prior.id),savedReview); terminals.push({parent,prior});
    }
  });
  await check('Missing, foreign, unfinished and different-application job predecessors consume no new admission', async () => {
    const otherApp=await required('applications',author,{...application,name:'Separate synthetic application'});
    const fa=await required('applications',outsider,application),fs=await required('suites',outsider,suite);
    const foreign=await completed((await required('jobs',outsider,{...input,appId:fa.id,suiteId:fs.id},key())).id,outsider);
    const queued=randomUUID(),running=randomUUID();
    inside('evaluation',`import pg from 'pg';const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});try{for(const [id,status] of ${JSON.stringify([[queued,'queued'],[running,'running']])})await pool.query("INSERT INTO jobs(id,workspace,created_by,request_hash,idempotency_key,input,snapshot,status) VALUES($1,$2,'synthetic-state-fixture','synthetic',$3,$4,$5,$6)",[id,${JSON.stringify(workspace)},'state-'+id,${JSON.stringify(input)},${JSON.stringify(initial.snapshot)},status]);console.log('isolated unfinished-state fixtures created without delivery');}finally{await pool.end();}`);
    const before=await jobRows();
    for(const [extra,status] of [[{previousJobId:randomUUID()},404],[{previousJobId:foreign.id},404],[{previousJobId:queued},409],[{previousJobId:running},409],[{previousJobId:terminals[0].parent.id,appId:otherApp.id},409]]) {
      assert.equal((await request('jobs',author,{...input,...extra},key())).status,status);
    }
    assert.equal((await request('jobs',viewer,{...input,previousJobId:initial.id},key())).status,403);
    assert.deepEqual(await jobRows(),before);
  });
  await check('Missing, unrelated and foreign review pointers write no review or audit', async () => {
    const child=await submit({previousJobId:terminals[0].parent.id});
    const fa=await required('applications',outsider,application),fs=await required('suites',outsider,suite);
    const foreign=await completed((await required('jobs',outsider,{...input,appId:fa.id,suiteId:fs.id},key())).id,outsider);
    const fr=await required('releases',outsider,{jobId:foreign.id,note:'Synthetic foreign workspace request'});
    const before=await reviews();
    for(const [previousReleaseId,status] of [[randomUUID(),404],[terminals[1].prior.id,409],[fr.id,404]]) {
      assert.equal((await request('releases',requester,{jobId:child.id,previousReleaseId,note:'Synthetic rejected link'})).status,status);
    }
    assert.equal((await request('releases',requester,{jobId:child.id,note:'No caller decision allowed',status:'approved'})).status,400);
    assert.equal((await request('releases',viewer,{jobId:child.id,note:'Viewer cannot request review'})).status,403);
    assert.deepEqual(await reviews(),before);
  });
  await check('Omitting an explicit pointer cannot bypass a pending predecessor review', async () => {
    const parent=await submit({candidate:'pending-parent'}),prior=await reviewRequest(parent),before=await evidence(prior.id);
    const child=await submit({previousJobId:parent.id,candidate:'pending-child'});
    for(const extra of [{},{previousReleaseId:prior.id}]) assert.equal((await request('releases',requester,{jobId:child.id,note:'Synthetic pending guard',...extra})).status,409);
    assert.deepEqual(await evidence(prior.id),before);assert.equal((await reviews()).some(r=>r.job_id===child.id),false);
  });
  await check('Legacy requests and prior jobs without reviews remain readable with null review links', async () => {
    const legacy=await reviewRequest(initial),legacyEvidence=await evidence(legacy.id);assert.equal(legacyEvidence.release.previous_release_id,null);
    const parent=await submit({candidate:'no-prior-review'}),child=await submit({previousJobId:parent.id});
    const next=await reviewRequest(child),captured=await evidence(next.id);
    assert.equal(captured.release.previous_release_id,null);assert.equal(captured.audit[0].details.previousJobId,parent.id);
    assert.deepEqual(await evidence(legacy.id),legacyEvidence);
  });
} catch(error) {report.error=String(error);process.exitCode=1;console.error(String(error));}
finally {
  report.status=report.error?'failed':'passed';
  report.passed=report.checks.filter(c=>c.passed).length;report.failed=report.checks.filter(c=>!c.passed).length;
  await mkdir('evidence',{recursive:true});await writeFile('evidence/lineage-integration.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}
