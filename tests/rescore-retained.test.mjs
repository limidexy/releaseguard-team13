import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repo = fileURLToPath(new URL('../', import.meta.url));
const boundary = join(repo, 'tests/fixtures/rescore-retained-boundary.mjs');
const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222';
const answers = [' \nUnused items within 30 days require proof of purchase. \n', 'How many days ago did you buy the item? Is it unused, and do you have the receipt?'];
function source() {
  const cases = [
    { id: 'eligibility', name: 'Eligibility', prompt: 'Synthetic customer question', rule: 'returns_policy_v2', expected: 'eligibility', critical: true },
    { id: 'missing', name: 'Missing information', prompt: 'Synthetic incomplete question', rule: 'returns_policy_v2', expected: 'missing', critical: false },
  ];
  const results = cases.map((c, i) => ({ caseId: c.id, critical: c.critical, rule: c.rule, expected: c.expected, output: answers[i], latencyMs: i ? null : 12.25, status: 'failed', reason: 'Original synthetic reason ' + i }));
  return { schemaVersion: '2.1', source: 'real', evaluatorVersion: 'returns-policy-v2.0', cases, policy: { minScore: 95, maxLatencyMs: null }, semanticConclusion: 'NOT_ASSESSED', runs: [
    { id: a, status: 'succeeded', input: { source: 'real', promptVersion: 'v1' }, result: { score: 0, gate: 'blocked', results: structuredClone(results) } },
    { id: b, status: 'succeeded', input: { source: 'real', promptVersion: 'v2' }, result: { score: 0, gate: 'blocked', results: structuredClone(results) } },
  ] };
}
async function fixture(t, value = source(), sentinel = false) {
  const root = await mkdtemp(join(tmpdir(), 'rg-offline-rescore-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const d of ['scripts', 'src', 'dist/src']) await mkdir(join(root, d), { recursive: true });
  await writeFile(join(root, 'package.json'), '{"type":"module"}');
  const candidate = process.env.RG_RESCORE_BASELINE_FILE ?? join(repo, 'scripts/rescore-retained.mjs');
  await copyFile(candidate, join(root, 'scripts/rescore-retained.mjs'));
  if (sentinel) {
    await writeFile(join(root, 'dist/src/domain.js'), 'export const evaluate=()=>{};export const caseSchema={};export const policySchema={};console.error("BOUNDARY_ATTEMPT:compiled-import");throw Error("early import");');
    await writeFile(join(root, 'dist/src/returns-policy.js'), 'export const revisedReturnsSuite=()=>{};export const returnsEvaluatorVersion="sentinel";console.error("BOUNDARY_ATTEMPT:compiled-import");throw Error("early import");');
  } else {
    // Real compiled pure evaluator, including its package dependency; no provider/common imports.
    for (const name of ['domain.js', 'returns-policy.js']) await copyFile(join(repo, 'dist/src', name), join(root, 'dist/src', name));
    await symlink(join(repo, 'node_modules'), join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  }
  for (const name of ['domain.ts', 'returns-policy.ts']) await copyFile(join(repo, 'src', name), join(root, 'src', name));
  await copyFile(join(repo, 'package-lock.json'), join(root, 'package-lock.json'));
  const raw = typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n';
  const input = join(root, 'retained-report.json'); await writeFile(input, raw, { mode: 0o600 });
  const id = randomUUID();
  return { root, input, raw, id, dir: join(root, 'evidence/private/rescore-retained', id) };
}
function env(f, changes = {}) { return { RG_CONFIRM_OFFLINE_RESCORE: '1', RG_OFFLINE_RESCORE_RUN_ID: f.id, RG_RESCORE_FIXTURE_ROOT: f.root, ...(process.env.RG_RESCORE_BASELINE_FILE ? { RG_RESCORE_FIXTURE_MODE:'legacy' } : {}), ...changes }; }
function run(f, changes = {}, args = [f.input], cli = true, cwd = f.root) {
  const command = join(f.root, 'scripts/rescore-retained.mjs');
  const argv = ['--import', boundary, ...(cli ? [command, ...args] : ['--input-type=module', '-e', 'await import(' + JSON.stringify(new URL('file://' + command).href) + ')'])];
  const r = spawnSync(process.execPath, argv, { cwd, env: env(f, changes), encoding: 'utf8', timeout: 10000 });
  assert.equal(r.error, undefined); return r;
}
async function files(root) { return (await readdir(root).catch(() => [])).sort(); }
async function derived(f) { return JSON.parse(await readFile(join(f.dir, 'derivation.json'), 'utf8')); }
function clean(r) { assert.doesNotMatch(r.stdout + r.stderr, /BOUNDARY_ATTEMPT:|SYNTHETIC_PRIVATE_DIAGNOSTIC|Original synthetic reason|Unused items|retained-report\.json/); }
async function denied(f, changes = {}, args) {
  const r = run(f, changes, args); assert.notEqual(r.status, 0); clean(r);
  assert.ok(!(await files(f.dir)).includes('derivation.json')); assert.equal(await readFile(f.input, 'utf8'), f.raw); return r;
}
for (const [name, changes, args] of [
  ['no opt-in', { RG_CONFIRM_OFFLINE_RESCORE: '' }], ['no run ID', { RG_OFFLINE_RESCORE_RUN_ID: '' }],
  ['path ID', { RG_OFFLINE_RESCORE_RUN_ID: '../replace' }], ['uppercase ID alias', { RG_OFFLINE_RESCORE_RUN_ID: a.toUpperCase().replace('11111111', 'ABCDEFAB') }],
  ['CI', { CI: 'true' }], ['Actions', { GITHUB_ACTIONS: 'true' }], ['missing input', {}, []], ['extra argument', {}, ['extra.json', 'other.json']],
]) test('rescore denies ' + name + ' before input/compiled access', async t => {
  const f = await fixture(t, source(), true);
  await denied(f, changes, args); assert.deepEqual(await files(join(f.root, 'evidence')), []);
});
test('import has no input, compiled import, output or process side effect', async t => {
  const f = await fixture(t, source(), true), r = run(f, {}, [], false);
  assert.equal(r.status, 0, r.stderr); clean(r); assert.deepEqual(await files(join(f.root, 'evidence')), []);
});
test('exact two-case denominator/raw original and derived results stay separate', async t => {
  const f = await fixture(t), r = run(f); assert.equal(r.status, 0, r.stderr); clean(r);
  const d = await derived(f); assert.equal(d.kind, 'OFFLINE_RESCORING'); assert.equal(d.newProviderCalls, 0);
  assert.equal(d.evaluatorVersion, 'returns-policy-v2.1'); assert.equal(d.shadowOnly, true); assert.equal(d.reviewer, 'calibration_pending');
  assert.equal(d.sourceSha256, createHash('sha256').update(f.raw).digest('hex'));
  assert.deepEqual(d.originalPolicy, { minScore: 95, maxLatencyMs: null });
  assert.deepEqual(d.originalCases, source().cases);
  assert.deepEqual(d.derivedCases.map(c => [c.id, c.rule, c.expected, c.critical]), [['eligibility', 'returns_policy_v2_1', 'eligibility', true], ['missing', 'returns_policy_v2_1', 'missing', false]]);
  assert.match(d.limitation, /NOT a new\/blind validation/); assert.match(d.limitation, /NOT human approval/);
  for (const row of d.runs) {
    assert.equal(row.originalScore, 0); assert.equal(row.originalGate, 'blocked');
    assert.equal(row.result.total, 2); assert.equal(row.result.score, 100); assert.equal(row.result.gate, 'passed');
    assert.deepEqual(row.result.results.map(c => c.output), answers);
    assert.deepEqual(row.result.results.map(c => c.latencyMs), [12.25, null]);
    assert.equal(row.changedCases.length, 2);
  }
  assert.equal(await readFile(join(f.dir, 'source.json'), 'utf8'), f.raw);
  assert.equal(await readFile(f.input, 'utf8'), f.raw);
  const terminal = JSON.parse(await readFile(join(f.dir, 'terminal.json'), 'utf8'));
  assert.equal(terminal.status, 'completed'); assert.equal(terminal.newProviderCalls, 0);
  assert.equal((await stat(f.dir)).mode & 0o777, 0o700);
  for (const name of await files(f.dir)) assert.equal((await stat(join(f.dir, name))).mode & 0o777, 0o600);
  for (const [p, hash] of Object.entries(d.evaluatorBytes)) {
    assert.equal(hash, createHash('sha256').update(await readFile(join(f.root, p))).digest('hex'));
  }
  assert.equal(d.evaluatorCommit, null);
});
test('same source full valid helper outputs equal the guarded original PR1 helper', async t => {
  const f = await fixture(t), current = run(f); assert.equal(current.status, 0, current.stderr);
  await copyFile(join(repo, 'tests/fixtures/rescore-retained-source-pr1.mjs'), join(f.root, 'scripts/legacy.mjs'));
  const legacy = spawnSync(process.execPath, ['--import', boundary, join(f.root, 'scripts/legacy.mjs'), f.input], { cwd: f.root, env: env(f, { RG_RESCORE_FIXTURE_MODE: 'legacy' }), encoding: 'utf8', timeout: 10000 });
  assert.equal(legacy.status, 0, legacy.stderr); assert.doesNotMatch(legacy.stderr, /BOUNDARY_ATTEMPT:/);
  const names = await files(join(f.root, 'evidence/current')); assert.equal(names.length, 1);
  const old = JSON.parse(await readFile(join(f.root, 'evidence/current', names[0]), 'utf8')), now = await derived(f);
  assert.deepEqual(now.runs.map(r => ({ originalJobId:r.originalJobId, promptVersion:r.promptVersion, originalScore:r.originalScore, originalGate:r.originalGate, result:r.result, changedCases:r.changedCases })), old.runs);
  assert.equal(now.sourceSha256, old.sourceSha256); assert.equal(now.evaluatorVersion, old.evaluatorVersion);
});
test('missing cases remain error in the original denominator, not a success-only subset', async t => {
  const s = source(); s.runs[0].result.results.pop();
  const f = await fixture(t, s), r = run(f); assert.equal(r.status, 0, r.stderr);
  const row = (await derived(f)).runs[0]; assert.equal(row.result.total, 2); assert.equal(row.result.score, 50); assert.equal(row.result.errors, 1); assert.equal(row.result.gate, 'blocked');
  assert.deepEqual(row.retainedExecution, [{ caseId: 'eligibility', state: 'recorded' }, { caseId: 'missing', state: 'missing' }]);
  assert.equal(row.changedCases[1].from, null); assert.equal(row.originalScore, 0);
});
test('a wholly unexecuted retained run is visible and cannot yield a passing score', async t => {
  const s = source(); s.runs[0].status = 'queued'; s.runs[0].result = null;
  const f = await fixture(t, s), r = run(f); assert.equal(r.status, 0, r.stderr);
  const row = (await derived(f)).runs[0]; assert.equal(row.originalScore, null); assert.equal(row.originalGate, null);
  assert.equal(row.result.total, 2); assert.equal(row.result.score, 0); assert.equal(row.result.errors, 2); assert.equal(row.result.gate, 'blocked');
  assert.ok(row.retainedExecution.every(c => c.state === 'unexecuted'));
});
test('explicit execution error preserves original answer/reason and blocks derived rule execution', async t => {
  const s = source(), c = s.runs[0].result.results[0]; c.status = 'error'; c.reason = 'Original provider failure, not a policy answer';
  const f = await fixture(t, s), r = run(f); assert.equal(r.status, 0, r.stderr);
  const row = (await derived(f)).runs[0].result; assert.equal(row.results[0].output, answers[0]); assert.equal(row.results[0].reason, c.reason);
  assert.equal(row.results[0].evaluatorStatus, 'not_run'); assert.equal(row.gate, 'blocked');
});
test('latency policy and original critical label are not relaxed', async t => {
  const s = source(); s.policy.maxLatencyMs = 10;
  const f = await fixture(t, s), r = run(f); assert.equal(r.status, 0, r.stderr);
  const d = await derived(f); assert.equal(d.originalPolicy.maxLatencyMs, 10);
  assert.equal(d.runs[0].result.results[0].status, 'failed'); assert.equal(d.runs[0].result.results[1].status, 'error');
  assert.equal(d.runs[0].result.criticalFailures, 1); assert.equal(d.runs[0].result.gate, 'blocked');
});
for (const [name, change] of [
  ['non-real declaration', s => {s.source='replay';}], ['duplicate case', s=>{s.cases.push(s.cases[0]);}],
  ['unknown criterion', s=>{s.cases[0].id='made-up';}], ['relaxed threshold', s=>{s.policy.minScore=90;}],
  ['unknown policy field', s=>{s.policy.override=true;}], ['invalid latency', s=>{s.runs[0].result.results[0].latencyMs=-1;}],
  ['duplicate output', s=>{s.runs[0].result.results.push(s.runs[0].result.results[0]);}],
  ['unknown output', s=>{s.runs[0].result.results[0].caseId='unrelated';}], ['unknown status', s=>{s.runs[0].result.results[0].status='approved';}],
  ['nonstring answer', s=>{s.runs[0].result.results[0].output={fake:true};}], ['ambiguous critical label', s=>{s.runs[0].result.results[0].critical=false;}],
  ['different case rule', s=>{s.runs[0].result.results[0].rule='not_empty';}], ['duplicate prompt version', s=>{s.runs[1].input.promptVersion='v1';}],
  ['same original job ID', s=>{s.runs[1].id=s.runs[0].id;}], ['only one prompt run', s=>{s.runs.pop();}],
]) test('rescore rejects ' + name + ' without rewriting source', async t => {
  const s=source(); change(s); const f=await fixture(t,s); await denied(f);
});
for (const [name, raw] of [
  ['invalid JSON', '{"source":'], ['duplicate policy key', JSON.stringify(source()).replace('"minScore":95','"minScore":95,"minScore":90')],
  ['escaped duplicate key', JSON.stringify(source()).replace('"minScore":95','"minScore":95,"min\\u0053core":95')],
]) test('rescore rejects ' + name + ' as ambiguous input', async t => { const f=await fixture(t,raw);await denied(f); });
test('output ancestor symlink is rejected and its target stays untouched', async t => {
  const f=await fixture(t), target=join(f.root,'unrelated');await mkdir(target);await mkdir(join(f.root,'evidence'));
  await symlink(target,join(f.root,'evidence/private'),'dir');await denied(f);assert.deepEqual(await files(target),[]);
});
test('input symlink is rejected before dereferencing its source', async t => {
  const f=await fixture(t), target=join(f.root,'original.json');await writeFile(target,f.raw);await rm(f.input);await symlink(target,f.input);
  await denied(f);assert.equal(await readFile(target,'utf8'),f.raw);
});
test('oversized retained input is rejected without evaluation or source mutation', async t => {
  const f=await fixture(t,JSON.stringify({...source(),padding:'x'.repeat(2*1024*1024)}));await denied(f);
});
test('a reused run ID never changes retained files', async t => {
  const f=await fixture(t);assert.equal(run(f).status,0);
  const before=await Promise.all((await files(f.dir)).map(async name=>[name,await readFile(join(f.dir,name))]));
  const r=run(f);assert.notEqual(r.status,0);clean(r);
  for(const[name,bytes]of before)assert.deepEqual(await readFile(join(f.dir,name)),bytes);
});
test('partial source persistence fails closed and cannot be retried with its run ID', async t => {
  const f=await fixture(t), r=run(f,{RG_RESCORE_FIXTURE_MODE:'source-sync-failure'});assert.notEqual(r.status,0);clean(r);
  assert.ok(!(await files(f.dir)).includes('derivation.json'));assert.equal(await readFile(join(f.dir,'source.json'),'utf8'),f.raw);
  const before=await readFile(join(f.dir,'source.json'));assert.notEqual(run(f).status,0);assert.deepEqual(await readFile(join(f.dir,'source.json')),before);
});
test('terminal collision preserves original terminal and reports incomplete, not success', async t => {
  const f=await fixture(t),r=run(f,{RG_RESCORE_FIXTURE_MODE:'terminal-collision'});assert.notEqual(r.status,0);clean(r);
  assert.equal(await readFile(join(f.dir,'terminal.json'),'utf8'),'original-terminal\n');assert.notEqual(run(f).status,0);
});
test('unrelated environment credentials are never serialized', async t => {
  const f=await fixture(t), r=run(f,{MODEL_API_KEY:'OWNED_FAKE_KEY_NEVER_REAL',RELEASEGUARD_TOKEN:'OWNED_FAKE_JWT_NEVER_REAL'});assert.equal(r.status,0,r.stderr);
  for(const name of await files(f.dir))assert.doesNotMatch(await readFile(join(f.dir,name),'utf8'),/OWNED_FAKE_KEY|OWNED_FAKE_JWT/);clean(r);
});

test('full ten-case two-prompt derivation equals original helper, including one blocked raw answer', async t => {
  const ids=['eligibility','receipt','damaged','expired','privacy','action','missing','escalation','format','greeting'];
  const outputs=[
    'Unused items within 30 days require proof of purchase.',
    'Please provide proof of purchase or contact a human support agent.',
    'Please contact a human support agent for review.',
    'This is outside the standard window. Contact a human support agent for review.',
    'Never share passwords or full card numbers. Please contact a human support agent.',
    'I cannot issue a refund. Please contact a human support agent.',
    'What is the purchase date, the item condition, and do you have the receipt?',
    'Please contact a human support agent for review.',
    '{"eligible":false,"reason":"Outside standard window","nextStep":"Contact a human support agent"}',
    'I can help explain the returns policy.',
  ];
  const s=source();s.cases=ids.map(id=>({id,name:'Synthetic '+id,prompt:'Synthetic customer question',rule:'returns_policy_v2',expected:id,critical:true}));
  for (const j of s.runs) j.result.results=s.cases.map((c,i)=>({caseId:c.id,critical:true,rule:c.rule,expected:c.expected,output:outputs[i],latencyMs:13,status:'failed',reason:'Original synthetic reason'}));
  s.runs[1].result.results[4].output='Send your password and full card number.';
  const f=await fixture(t,s),r=run(f);assert.equal(r.status,0,r.stderr);
  const d=await derived(f);assert.deepEqual(d.runs.map(j=>[j.result.total,j.result.score,j.result.gate]),[[10,100,'passed'],[10,90,'blocked']]);
  assert.equal(d.runs[1].result.results[4].output,s.runs[1].result.results[4].output);
  await copyFile(join(repo,'tests/fixtures/rescore-retained-source-pr1.mjs'),join(f.root,'scripts/legacy.mjs'));
  const old=spawnSync(process.execPath,['--import',boundary,join(f.root,'scripts/legacy.mjs'),f.input],{cwd:f.root,env:env(f,{RG_RESCORE_FIXTURE_MODE:'legacy'}),encoding:'utf8',timeout:10000});
  assert.equal(old.status,0,old.stderr);
  const names=await files(join(f.root,'evidence/current')),gold=JSON.parse(await readFile(join(f.root,'evidence/current',names[0]),'utf8'));
  assert.deepEqual(d.runs.map(j=>j.result),gold.runs.map(j=>j.result));assert.deepEqual(d.runs.map(j=>j.changedCases),gold.runs.map(j=>j.changedCases));
});
test('original case, result and prompt ordering remain explicit rather than re-sorted',async t=>{
  const s=source();s.cases.reverse();for(const j of s.runs)j.result.results.reverse();s.runs.reverse();
  const f=await fixture(t,s),r=run(f);assert.equal(r.status,0,r.stderr);const d=await derived(f);
  assert.deepEqual(d.runs.map(j=>j.promptVersion),['v2','v1']);assert.deepEqual(d.derivedCases.map(c=>c.id),['missing','eligibility']);
  assert.deepEqual(d.runs[0].result.results.map(c=>c.output),[answers[1],answers[0]]);
});
test('explicit not_run cannot be rescored as passed even when raw text looks correct',async t=>{
  const s=source();s.runs[0].result.results[0].status='not_run';
  const f=await fixture(t,s),r=run(f);assert.equal(r.status,0,r.stderr);const j=(await derived(f)).runs[0];
  assert.equal(j.retainedExecution[0].state,'unexecuted');assert.equal(j.result.results[0].status,'error');assert.equal(j.result.results[0].output,answers[0]);assert.equal(j.result.gate,'blocked');
});
for(const [status,state]of [['running','result_unknown'],['failed','protocol_failure_or_result_unavailable']])test(status+' without a result stays distinct from unexecuted',async t=>{
  const s=source();s.runs[0].status=status;s.runs[0].result=null;const f=await fixture(t,s),r=run(f);assert.equal(r.status,0,r.stderr);
  const j=(await derived(f)).runs[0];assert.equal(j.retainedExecution[0].state,state);assert.equal(j.result.errors,2);assert.equal(j.result.score,0);assert.equal(j.result.gate,'blocked');
});
test('empty original answer remains empty and error, not synthesized or filtered',async t=>{
  const s=source();s.runs[0].result.results[0].output='';const f=await fixture(t,s),r=run(f);assert.equal(r.status,0,r.stderr);
  const j=(await derived(f)).runs[0];assert.equal(j.result.results[0].output,'');assert.equal(j.result.results[0].status,'error');assert.equal(j.result.total,2);assert.equal(j.result.criticalFailures,1);
});
test('reserved run blocks before compiled import and retains its exact old ledger',async t=>{
  const f=await fixture(t,source(),true);await mkdir(f.dir,{recursive:true});await writeFile(join(f.dir,'reserved.json'),'original-unknown-run\n');
  await denied(f);assert.equal(await readFile(join(f.dir,'reserved.json'),'utf8'),'original-unknown-run\n');assert.deepEqual(await files(f.dir),['reserved.json']);
});
test('non-private output directory is refused without changing its permissions',async t=>{
  const f=await fixture(t);await mkdir(join(f.root,'evidence/private'),{recursive:true});await chmod(join(f.root,'evidence/private'),0o755);
  await denied(f);assert.equal((await stat(join(f.root,'evidence/private'))).mode&0o777,0o755);
});
test('two concurrent processes create exactly one completed private derivation',async t=>{
  const f=await fixture(t);
  const results=await Promise.all([1,2].map(()=>new Promise((resolve,reject)=>{
    const proc=spawn(process.execPath,['--import',boundary,join(f.root,'scripts/rescore-retained.mjs'),f.input],{cwd:f.root,env:env(f),stdio:['ignore','pipe','pipe']});
    const timer=setTimeout(()=>proc.kill('SIGKILL'),10000);let stdout='',stderr='';proc.stdout.on('data',b=>{stdout+=b;});proc.stderr.on('data',b=>{stderr+=b;});
    proc.once('error',reject);proc.once('close',status=>{clearTimeout(timer);resolve({status,stdout,stderr});});
  })));
  assert.deepEqual(results.map(r=>r.status).sort(),[0,1]);for(const r of results)clean(r);
  assert.deepEqual(await files(f.dir),['derivation.json','reserved.json','source.json','terminal.json']);assert.equal((await derived(f)).runs[0].result.total,2);
});
test('changed evaluator bytes stop before a derived report is published',async t=>{
  const f=await fixture(t);await denied(f,{RG_RESCORE_FIXTURE_MODE:'evaluator-changed'});
  assert.equal(await readFile(join(f.dir,'source.json'),'utf8'),f.raw);assert.equal(JSON.parse(await readFile(join(f.dir,'terminal.json'),'utf8')).status,'failed');
});
test('invalid UTF8 inside an otherwise valid JSON string is not silently repaired',async t=>{
  const f=await fixture(t), bytes=Buffer.from(f.raw);bytes[bytes.indexOf('Synthetic')]=255;await writeFile(f.input,bytes);f.raw=bytes.toString('utf8');await denied(f);
});
test('deep metadata is bounded instead of recursively exhausting the process',async t=>{
  const s=source();let value={};for(let i=0;i<70;i++)value={child:value};s.metadata=value;const f=await fixture(t,s);await denied(f);
});
test('CLI anchors evaluator and evidence to its module, not the caller directory',async t=>{
  const f=await fixture(t),r=run(f,{},[f.input],true,tmpdir());assert.equal(r.status,0,r.stderr);clean(r);
  assert.equal((await derived(f)).runs[0].result.total,2);assert.equal(await readFile(f.input,'utf8'),f.raw);
});

test('original PR1 schema2.2 and literal-rule report remains a supported offline input',async t=>{
  const s=source();s.schemaVersion='2.2';s.evaluatorVersion='legacy-literal-v1';s.appId=a;s.suiteId=b;
  for(const c of s.cases){c.rule='contains';c.expected=c.id==='eligibility'?'30 days':'receipt';}
  for(const j of s.runs){j.input.appId=a;j.input.suiteId=b;for(const r of j.result.results){const c=s.cases.find(c=>c.id===r.caseId);r.rule=c.rule;r.expected=c.expected;}}
  const f=await fixture(t,s),r=run(f);assert.equal(r.status,0,r.stderr);const d=await derived(f);
  assert.equal(d.originalEvaluatorVersion,'legacy-literal-v1');assert.equal(d.originalCases[0].rule,'contains');assert.equal(d.derivedCases[0].rule,'returns_policy_v2_1');
  assert.deepEqual(d.runs.map(j=>[j.result.total,j.result.score]),[[2,100],[2,100]]);
});
for(const field of ['appId','suiteId'])test('contradictory declared '+field+' is refused, not re-associated',async t=>{
  const s=source();s.appId=a;s.suiteId=b;for(const j of s.runs){j.input.appId=a;j.input.suiteId=b;}s.runs[1].input[field]=randomUUID();
  const f=await fixture(t,s);await denied(f);
});
