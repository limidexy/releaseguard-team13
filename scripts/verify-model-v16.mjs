import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {decisionContextV1,decisionForQuestionV1} from '../dist/src/returns-decision-v1.js';
import {evaluateControlledV14} from '../dist/src/controlled-evaluation-v14.js';
import { evaluate } from '../dist/src/domain.js';
import { promptSnapshot, responseModeV8, responseModesV14 } from '../dist/src/provider.js';
const root = fileURLToPath(new URL('../', import.meta.url));
if (!process.argv[2] || !process.argv[3]) throw Error('Usage: verify-model-v16.mjs <report> <original-plan>');
const file = resolve(process.argv[2]), raw = await readFile(file), report = JSON.parse(raw);
const planRaw = await readFile(resolve(dirname(file), 'plan.json')), plan = JSON.parse(planRaw);
const oldRaw = await readFile(resolve(process.argv[3])), oldPlan = JSON.parse(oldRaw);
const sha = x => createHash('sha256').update(x).digest('hex');
const checks = [];
async function check(name, fn) {
  try { await fn(); checks.push({ name, passed: true }); }
  catch (e) { checks.push({ name, passed: false, error: String(e) }); }
}
await check('same 20 original questions, criteria, critical flags and threshold', () => {
  assert.equal(sha(oldRaw), plan.originalPlanSha256);
  const stable = p => p.suites.flatMap(s => s.cases).map(({ rule, ...c }) => c);
  assert.deepEqual(stable(plan), stable(oldPlan));
  assert.deepEqual(plan.policy, oldPlan.policy);
  assert.equal(plan.policy.minScore, 95);
  assert.equal(stable(plan).length, 20);
});
await check('frozen prompt, source snapshots and compiled scorer remain unchanged', async () => {
  assert.equal(sha(planRaw), report.planSha256);
  assert.equal(report.evaluatorVersion, 'returns-policy-v2.10');
  assert.deepEqual(promptSnapshot('v16'), report.promptSnapshot);
  assert.deepEqual(plan.promptSnapshot, report.promptSnapshot);
  assert.deepEqual(report.sources, plan.sources);
  for (const [p, hash] of Object.entries(plan.sources)) {
    assert.equal(sha(await readFile(resolve(root, p))), hash);
    assert.equal(sha(await readFile(resolve(dirname(file), 'source', p + '.txt'))), hash);
  }
});
await check('20 unique complete real-provider responses, no retry or truncation', () => {
  assert.equal(report.source, 'real'); assert.equal(report.calls.length, 20);
  assert.equal(report.automaticRetries, 0); assert.equal(report.stoppedReason, null);
  assert.equal(new Set(report.calls.map(c => c.caseId)).size, 20);
  assert.equal(new Set(report.calls.map(c => c.metadata?.requestId)).size, 20);
  for (const c of report.calls) {
    assert.equal(c.error, undefined); assert.equal(c.metadata.httpStatus, 200);
    assert.equal(c.metadata.finishReason, 'stop'); assert.ok(c.metadata.requestId);
    assert.equal(c.metadata.reportedModel, report.model);
    const mode = responseModeV8(c.prompt);
    assert.equal(c.metadata.responseMode, mode);
    assert.deepEqual(c.metadata.businessDecision,decisionForQuestionV1(c.prompt));
    assert.equal(c.metadata.decisionContextSha256,sha(decisionContextV1(c.prompt).text));
    assert.equal(c.metadata.systemPromptSha256, sha(report.promptSnapshot.text + '\n\n' + decisionContextV1(c.prompt).text + '\n\n' + responseModesV14[mode]));
    assert.ok(typeof c.output === 'string' && c.output.trim());
  }
});
await check('raw journal matches report exactly', async () => {
  const journal = await readFile(file.replace(/\.json$/, '.jsonl'));
  assert.equal(sha(journal), report.journalSha256);
  const rows = journal.toString().trim().split('\n').map(JSON.parse);
  assert.equal(rows[0].event, 'started');
  assert.deepEqual(rows.slice(1).map(({event, ...c}) => c), report.calls);
});
await check('scores reproduce from frozen rules and unmodified answers', () => {
  for (const suite of plan.suites) {
    const outputs = report.calls.filter(c => c.group === suite.group);
    assert.deepEqual(report.results.find(r => r.group === suite.group), { group: suite.group, ...evaluate(suite.cases, plan.policy, outputs) });
    for (const c of outputs) assert.equal(c.prompt, suite.cases.find(x => x.id === c.caseId).prompt);
  }
  assert.deepEqual(report.overall, evaluate(plan.suites.flatMap(s => s.cases), plan.policy, report.calls));
  assert.deepEqual(report.legacyV29Comparison,evaluate(plan.suites.flatMap(s=>s.cases).map(c=>({...c,rule:'returns_policy_v2_9'})),plan.policy,report.calls));
  assert.deepEqual(report.legacyV28Comparison,evaluate(plan.suites.flatMap(s=>s.cases).map(c=>({...c,rule:'returns_policy_v2_8'})),plan.policy,report.calls));
  assert.equal(report.totalTokens, report.calls.reduce((sum, c) => sum + (c.metadata?.usage?.total_tokens ?? 0), 0));
});
await check('historical real reports are unchanged', async () => {
  assert.equal(sha(await readFile(resolve(root,'docs/evidence/model-v15-2026-10-16/real-v15-2026-10-16T08-31-07.250Z.json'))),'01c9392af186ea9bea8a126127f0b82d347ac94c5546dc0387c6995a553666f8');
  assert.equal(sha(await readFile(resolve(root,'docs/evidence/model-v14-2026-10-16/real-v14-2026-10-16T07-28-43.967Z.json'))),'939ad98bddfc3db845efa051e3d2d9d2b4b724b4cd9aea1dc2db163b602d5e2a');
  assert.equal(sha(await readFile(resolve(root,'docs/evidence/model-v13-2026-10-16/real-v13-2026-10-16T06-32-34.056Z.json'))),'194efc1bfe9bbd2767ee7cb1c3c2f098b0289d74af4cb8e065a6975004488551');
  assert.equal(sha(await readFile(resolve(root, 'docs/evidence/model-v6-2026-10-15/real-v6-2026-10-15T13-06-29.373Z.json'))), 'dad85eaac68d727f280b9eefd869af71f5fa250ed5d066191b02fd0e602e927c');
  assert.equal(sha(await readFile(resolve(root, 'docs/evidence/model-v7-2026-10-16/real-v7-2026-10-16T03-05-31.073Z.json'))), '3e7560742e4f93eeed00df04da9cabb1629bd7a62ba4396abfcec90cd0a781f6');
  assert.equal(sha(await readFile(resolve(root, 'docs/evidence/model-v8-2026-10-16/real-v8-2026-10-16T03-12-52.872Z.json'))), '8fa7c14eff269497bf426df60d0913976ff22352ec66b4e07740ca36bccd1af6');
  assert.equal(sha(await readFile(resolve(root, 'docs/evidence/model-v9-2026-10-16/real-v9-2026-10-16T04-12-25.436Z.json'))), 'd971bf3c34d1bd5125112385ddefade899785ecc3023e3c2aefb9a922dfedfdd');
  assert.equal(sha(await readFile(resolve(root, 'docs/evidence/model-v10-2026-10-16/real-v10-2026-10-16T04-41-29.509Z.json'))), '976e030d90dba2f4695af866bb6c375c83618fc3251aaa4e7c2248215ecb1ab6');
  assert.equal(sha(await readFile(resolve(root, 'docs/evidence/model-v11-2026-10-16/real-v11-2026-10-16T05-48-11.359Z.json'))), '6f457aa8e6508bbbc02bf97bc7d07a2f3c88b4dfc5a652ed75dca62d7ad7dbb3');
  assert.equal(sha(await readFile(resolve(root, 'docs/evidence/model-v12-2026-10-16/real-v12-2026-10-16T06-02-56.533Z.json'))), '03761aa70d396801dd77e8072d3b57f9126916804b3339290e26e58f55a8c4e5');
  const historical = {
    'real-v3-2026-10-14T14-06-07.034Z.json': '5ae5ea93a901534ef7afdabda496c647e600481ae3bd32bd771ec39bf1e26366',
    'real-v4-2026-10-14T14-15-23.420Z.json': 'e4380e33fb4c66042dd1e1035ba7d48eef20488be789f531744b99bec9359689',
    'real-v5-2026-10-14T14-25-15.496Z.json': '9f0ff0df3d30b165a64d6d019deaf3e4d7c1a43a862f7460c93f4e9602860cec',
    '../cloud-2026-10-11-retest/prompt-comparison-real-1791729589074.json': '5bcf29f90edac6c54c32e7e93d0cb3660a34579e2b1d24a064b8edc9d96840c6',
  };
  for (const [name, expected] of Object.entries(historical)) {
    assert.equal(sha(await readFile(resolve(dirname(process.argv[3]), name))), expected);
  }
});
await check('business decision and independent delivery validation reproduce without modifying model score',()=>{
 assert.deepEqual(report.controlled,evaluateControlledV14(plan.suites.flatMap(s=>s.cases),plan.policy,report.calls));
 assert.deepEqual(report.controlled.rawModelEvaluation,report.overall);
 assert.deepEqual(plan.businessDecisions,plan.suites.flatMap(s=>s.cases).map(c=>({caseId:c.id,decision:decisionForQuestionV1(c.prompt)})));
 for(const row of report.controlled.records){
   if(row.delivery.status==='blocked')assert.equal(row.delivery.customerOutput,null);
   else assert.equal(row.delivery.customerOutput,report.calls.find(c=>c.caseId===row.caseId).output);
   assert.equal(row.delivery.rewritten,false);
 }
});
await check('offline gate passed before real calls, frozen gate and model scores remain separate',async()=>{
 const offlineRaw=await readFile(resolve(dirname(file),'offline-regression.json'));
 assert.equal(sha(offlineRaw),plan.offlineRegressionSha256);
 const offline=JSON.parse(offlineRaw);assert.equal(offline.passed,true);assert.equal(offline.providerCalls,0);
 assert.ok(Date.parse(offline.createdAt)<=Date.parse(report.startedAt));
});
const verification = { checkedAt: new Date().toISOString(), reportSha256: sha(raw), checks, passed: checks.filter(c => c.passed).length,
  failed: checks.filter(c => !c.passed).length, score: report.overall.score, gate: report.overall.gate,
  scope: 'Evidence integrity and deterministic scoring, not independent human review or cloud/CI acceptance' };
const out = file.replace(/\.json$/, '-verification-' + Date.now() + '.json');
await writeFile(out, JSON.stringify(verification, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ file: out, ...verification }));
if (verification.failed) process.exitCode = 1;
