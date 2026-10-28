// Run only against a disposable local Compose project. This creates synthetic
// jobs and checks real PostgreSQL transactions; it never calls a model.
// RG_SUBMISSION_INTEGRATION=1 COMPOSE_PROJECT_NAME=<isolated-project>
// RELEASEGUARD_URL=http://127.0.0.1:<port> node scripts/verify-submission.mjs
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { token } from './dev-tokens.mjs';
import { request, required, key, base } from './client.mjs';
import { application, suite } from './fixtures.mjs';

const endpoint = new URL(base);
assert.equal(process.env.RG_SUBMISSION_INTEGRATION, '1', 'Set RG_SUBMISSION_INTEGRATION=1 for this local integration test');
assert.ok(process.env.COMPOSE_PROJECT_NAME, 'Use an explicitly isolated COMPOSE_PROJECT_NAME');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname), 'Only a loopback endpoint is supported');
const workspace = 'submission-test-' + randomUUID();
const identity = await token('submission-test', 'contributor', workspace);
const outsider = await token('submission-test', 'contributor', workspace + '-other');
const checks = [];
async function check(name, run) {
  await run(); checks.push(name); console.log('PASS ' + name);
}
function insideEvaluation(code) {
  // Feed code and synthetic credentials on stdin, never in process arguments.
  const result = execFileSync('docker', ['compose', 'exec', '-T', 'evaluation', 'node', '--input-type=module'], {
    input: code, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024,
  });
  return result.trim();
}
const a = await required('applications', identity, application);
const s = await required('suites', identity, suite);
const body = { appId: a.id, suiteId: s.id, candidate: 'submission-test', commitRef: 'synthetic-local-test', source: 'imported', outputs: [] };
let accepted;
await check('Concurrent HTTP submissions retain one job and one outbox intent', async () => {
  const idempotencyKey = key();
  const responses = await Promise.all(Array.from({ length: 8 }, () => request('jobs', identity, body, idempotencyKey)));
  assert.ok(responses.every(r => [200, 202].includes(r.status)), JSON.stringify(responses.map(r => r.status)));
  assert.equal(new Set(responses.map(r => r.data.id)).size, 1);
  accepted = responses[0].data;
  assert.equal((await request('jobs', identity, { ...body, candidate: 'changed' }, idempotencyKey)).status, 409);
  const status = await required('jobs/submissions/' + idempotencyKey, identity);
  assert.equal(status.id, accepted.id); assert.equal(status.submissionState, 'accepted');
  assert.equal(status.automaticRetry, false);
  const hidden = await request('jobs/submissions/' + idempotencyKey, outsider);
  assert.equal(hidden.status, 404); assert.equal(hidden.data.definitive, false);
  assert.equal(hidden.data.doNotResubmit, true);
  insideEvaluation(`
    import assert from 'node:assert/strict'; import pg from 'pg';
    const pool = new pg.Pool({connectionString:process.env.DATABASE_URL});
    try {
      const result = await pool.query('SELECT (SELECT count(*)::int FROM jobs WHERE workspace=$1) AS jobs,(SELECT count(*)::int FROM outbox WHERE job_id IN (SELECT id FROM jobs WHERE workspace=$1)) AS outbox', [${JSON.stringify(workspace)}]);
      assert.deepEqual(result.rows[0], {jobs:1,outbox:1}); console.log('HTTP persistence checked');
    } finally { await pool.end(); }
  `);
});

await check('Expired or unsigned internal requests never create jobs or return a late snapshot', async () => {
  insideEvaluation(`
    import assert from 'node:assert/strict'; import {randomUUID} from 'node:crypto'; import pg from 'pg';
    import {createSubmissionDeadline,SUBMISSION_BUDGET_HEADER,SUBMISSION_KEY_HASH_HEADER} from './dist/src/submission-deadline.js';
    import {keyHash} from './dist/src/submission-state.js';
    import {digest,internalHeader} from './dist/src/common.js';
    const body=${JSON.stringify(body)}, authorization='Bearer '+${JSON.stringify(identity)}, traceId=randomUUID();
    const idempotencyKey='expired-'+randomUUID();
    const headers={'content-type':'application/json',authorization,'idempotency-key':idempotencyKey,'x-rg-trace-id':traceId};
    const expired=createSubmissionDeadline({traceId,method:'POST',route:'/jobs',keySha256:keyHash(idempotencyKey),bodySha256:digest(body),authorizationSha256:keyHash(authorization)},process.env.INTERNAL_SECRET,Date.now()-11000);
    let r=await fetch('http://127.0.0.1:8080/jobs',{method:'POST',headers:{...headers,[SUBMISSION_BUDGET_HEADER]:expired},body:JSON.stringify(body)});
    assert.equal(r.status,504); assert.equal((await r.json()).submissionState,'unknown');
    r=await fetch('http://127.0.0.1:8080/jobs',{method:'POST',headers,body:JSON.stringify(body)}); assert.equal(r.status,401); await r.text();
    const path='/internal/snapshot/'+body.appId+'/'+body.suiteId+'?workspace='+encodeURIComponent(${JSON.stringify(workspace)});
    const internalHeaders={...await internalHeader('registry'),'x-rg-trace-id':traceId,[SUBMISSION_KEY_HASH_HEADER]:keyHash(idempotencyKey)};
    r=await fetch('http://registry:8080'+path,{headers:internalHeaders}); assert.equal(r.status,401); await r.text();
    internalHeaders[SUBMISSION_BUDGET_HEADER]=createSubmissionDeadline({traceId,method:'GET',route:path,keySha256:keyHash(idempotencyKey),bodySha256:digest(null),authorizationSha256:keyHash(internalHeaders.authorization)},process.env.INTERNAL_SECRET,Date.now()-11000,'registry');
    r=await fetch('http://registry:8080'+path,{headers:internalHeaders}); assert.equal(r.status,504); await r.text();
    const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
    try { assert.equal((await pool.query('SELECT count(*)::int AS n FROM jobs WHERE workspace=$1 AND idempotency_key=$2',[${JSON.stringify(workspace)},idempotencyKey])).rows[0].n,0); }
    finally { await pool.end(); }
    console.log('Deadline rejection checked');
  `);
});

const job = await required('jobs/' + accepted.id, identity);
await check('PostgreSQL atomically enforces quotas, rolls back duplicate keys and rolls back outbox failures', async () => {
  insideEvaluation(`
    import assert from 'node:assert/strict'; import {randomUUID} from 'node:crypto'; import pg from 'pg';
    import {admitAtomic} from './dist/src/admission-atomic.js';
    const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:8});
    const workspace=${JSON.stringify(workspace + '-atomic')};
    const admission=(rateKey,key=randomUUID(),outboxId=randomUUID())=>({rateKey,limit:3,id:randomUUID(),outboxId,workspace,principal:'submission-test',hash:'synthetic',key,input:${JSON.stringify(body)},snapshot:${JSON.stringify(job.snapshot)}});
    // Count committed permits from the active slot representation, not the
    // retained legacy counter. Assert the window and permit cardinality too:
    // changing the representation must not weaken quota/rollback acceptance.
    const count=async(rateKey)=>{
      const row=(await pool.query('SELECT w.limit_count,w.legacy_count,(SELECT count(*)::int FROM admission_slots s WHERE s.key=w.key) AS slots,(SELECT count(*)::int FROM admission_slots s WHERE s.key=w.key AND s.claimed) AS claimed FROM admission_windows w WHERE w.key=$1',[rateKey])).rows[0];
      if(!row)return undefined;
      assert.equal(row.limit_count,3);assert.equal(row.slots,3);
      assert.equal(row.legacy_count,0);
      assert.ok(row.claimed>=0&&row.claimed<=row.limit_count);
      return row.claimed;
    };
    const counts=async()=> (await pool.query('SELECT (SELECT count(*)::int FROM jobs WHERE workspace=$1) AS jobs,(SELECT count(*)::int FROM outbox WHERE job_id IN (SELECT id FROM jobs WHERE workspace=$1)) AS outbox',[workspace])).rows[0];
    try {
      const disabledKey=workspace+':disabled';
      assert.equal(await admitAtomic(pool,{...admission(disabledKey),limit:0}),false);
      assert.equal(await count(disabledKey),undefined); assert.deepEqual(await counts(),{jobs:0,outbox:0});
      const quotaKey=workspace+':quota', attempts=Array.from({length:8},()=>admission(quotaKey));
      const quota=await Promise.all(attempts.map(a=>admitAtomic(pool,a)));
      assert.equal(quota.filter(Boolean).length,3); assert.equal(await count(quotaKey),3);
      assert.deepEqual(await counts(),{jobs:3,outbox:3});
      const raceKey=workspace+':race', sameKey=randomUUID();
      const raced=await Promise.allSettled(Array.from({length:8},()=>admitAtomic(pool,admission(raceKey,sameKey))));
      assert.equal(raced.filter(r=>r.status==='fulfilled'&&r.value).length,1);
      assert.ok(raced.filter(r=>r.status==='rejected').every(r=>r.reason.code==='23505'));
      assert.equal(await count(raceKey),1); assert.deepEqual(await counts(),{jobs:4,outbox:4});
      const failureKey=workspace+':failure', outboxId=randomUUID();
      assert.equal(await admitAtomic(pool,admission(failureKey,randomUUID(),outboxId)),true);
      await assert.rejects(admitAtomic(pool,admission(failureKey,randomUUID(),outboxId)),{code:'23505'});
      assert.equal(await count(failureKey),1); assert.deepEqual(await counts(),{jobs:5,outbox:5});
      console.log('Real database atomicity checked');
    } finally {
      await pool.query('DELETE FROM outbox WHERE job_id IN (SELECT id FROM jobs WHERE workspace=$1)',[workspace]);
      await pool.query('DELETE FROM jobs WHERE workspace=$1',[workspace]);
      // The synthetic window belongs only to this disposable integration run.
      // Its slots cascade; no historical/cloud quota or business data is used.
      await pool.query('DELETE FROM admission_windows WHERE key LIKE $1',[workspace+':%']);
      await pool.query('DELETE FROM admission_limits WHERE key LIKE $1',[workspace+':%']);
      await pool.end();
    }
  `);
});
console.log(JSON.stringify({ passed: checks.length, failed: 0, checks, environment: 'isolated local Compose; PostgreSQL and RabbitMQ; synthetic imported jobs; no model or cloud calls' }, null, 2));
