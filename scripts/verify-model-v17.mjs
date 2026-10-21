import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateControlledV17 } from '../dist/src/controlled-evaluation-v17.js';
import { evaluate } from '../dist/src/domain.js';
import { checkExplanationV2 } from '../dist/src/output-guard-v2.js';
import { promptSnapshot, responseModeV8 } from '../dist/src/provider.js';
import { compileResponseContractV17 } from '../dist/src/response-contract-v17.js';
import { decisionForQuestionV1 } from '../dist/src/returns-decision-v1.js';

const root = fileURLToPath(new URL('../', import.meta.url));
if (!process.argv[2]) throw Error('Usage: verify-model-v17.mjs <real-report>');
const file = resolve(process.argv[2]);
const raw = await readFile(file);
const report = JSON.parse(raw);
const planRaw = await readFile(resolve(dirname(file), 'plan.json'));
const plan = JSON.parse(planRaw);
const sha = value => createHash('sha256').update(value).digest('hex');
const checks = [];

async function check(name, fn) {
  try {
    await fn();
    checks.push({ name, passed: true });
  } catch (error) {
    checks.push({ name, passed: false, error: String(error) });
  }
}

const cases = plan.suites.flatMap(suite => suite.cases);
const independentOldGuard = calls => {
  const records = cases.map(testCase => {
    const output = calls.find(item => item.caseId === testCase.id);
    return {
      caseId: testCase.id,
      validation: checkExplanationV2(
        output?.output,
        decisionForQuestionV1(testCase.prompt),
        responseModeV8(testCase.prompt),
        output?.error,
      ),
    };
  });
  return {
    version: 'explanation-guard-v2',
    allowed: records.filter(record => record.validation.passed).length,
    blocked: records.filter(record => !record.validation.passed).length,
    records,
  };
};
const combineScoreAndOldGuard = (rawEvaluation, guard) => {
  const scorePassed = new Set(rawEvaluation.results.filter(result => result.status === 'passed').map(result => result.caseId));
  const guardPassed = new Set(guard.records.filter(record => record.validation.passed).map(record => record.caseId));
  const allowedCases = cases.filter(testCase => scorePassed.has(testCase.id) && guardPassed.has(testCase.id)).map(testCase => testCase.id);
  return {
    allowed: allowedCases.length,
    blocked: cases.length - allowedCases.length,
    allowedCases,
    blockedCases: cases.filter(testCase => !allowedCases.includes(testCase.id)).map(testCase => testCase.id),
  };
};

await check('plan, prompt and frozen source hashes match the real run', async () => {
  assert.equal(sha(planRaw), report.planSha256);
  assert.deepEqual(report.sources, plan.sources);
  assert.deepEqual(report.promptSnapshot, plan.promptSnapshot);
  assert.deepEqual(promptSnapshot('v17'), plan.promptSnapshot);
  for (const [path, hash] of Object.entries(plan.sources)) {
    assert.equal(sha(await readFile(resolve(root, path))), hash, `live source mismatch: ${path}`);
    assert.equal(sha(await readFile(resolve(dirname(file), 'source', path + '.txt'))), hash, `snapshot mismatch: ${path}`);
  }
});

await check('frozen questions, order, policy and contracts are internally consistent', () => {
  assert.equal(cases.length, 20);
  assert.equal(plan.policy.minScore, 95);
  assert.deepEqual(plan.questionOrder, cases.map(testCase => testCase.id));
  assert.equal(plan.contracts.length, 20);
  for (const testCase of cases) {
    const frozen = plan.contracts.find(item => item.caseId === testCase.id);
    assert.ok(frozen);
    assert.equal(frozen.questionSha256, sha(testCase.prompt));
    assert.deepEqual(
      frozen.contract,
      compileResponseContractV17(testCase.prompt, decisionForQuestionV1(testCase.prompt), responseModeV8(testCase.prompt)),
    );
  }
});

await check('exactly 20 one-shot provider responses were retained with no hidden retry', () => {
  assert.equal(report.source, 'real');
  assert.equal(report.totalCalls, 20);
  assert.equal(report.calls.length, 20);
  assert.equal(report.automaticRetries, 0);
  assert.deepEqual(report.calls.map(call => call.caseId), plan.questionOrder);
  assert.equal(new Set(report.calls.map(call => call.caseId)).size, 20);
  assert.equal(new Set(report.calls.map(call => call.metadata?.requestId)).size, 20);
  for (const call of report.calls) {
    assert.equal(call.error, undefined);
    assert.equal(call.metadata?.httpStatus, 200);
    assert.equal(call.metadata?.finishReason, 'stop');
    assert.ok(call.metadata?.requestId);
    assert.ok(typeof call.output === 'string' && call.output.trim());
  }
});

await check('append-only response journal matches report calls', async () => {
  const journal = await readFile(file.replace(/\.json$/, '.jsonl'));
  assert.equal(sha(journal), report.journalSha256);
  const rows = journal.toString().trim().split('\n').map(JSON.parse);
  assert.equal(rows[0].event, 'started');
  assert.deepEqual(rows.slice(1).map(({ event, ...call }) => call), report.calls);
});

await check('raw v2.10 scoring and totals reproduce', () => {
  for (const suite of plan.suites) {
    const outputs = report.calls.filter(call => call.group === suite.group);
    assert.deepEqual(report.results.find(result => result.group === suite.group), {
      group: suite.group,
      ...evaluate(suite.cases, plan.policy, outputs),
    });
  }
  assert.deepEqual(report.overall, evaluate(cases, plan.policy, report.calls));
  assert.equal(report.totalTokens, report.calls.reduce((sum, call) => sum + (call.metadata?.usage?.total_tokens ?? 0), 0));
});

await check('old gate and score-plus-old-gate accounting reproduce separately', () => {
  const oldGuard = independentOldGuard(report.calls);
  assert.deepEqual(report.independentOldGuard, oldGuard);
  assert.deepEqual(report.rawPlusOldGuard, combineScoreAndOldGuard(report.overall, oldGuard));
});

await check('frozen v17 checker output reproduces and blocked output remains null', () => {
  const controlled = evaluateControlledV17(cases, plan.policy, report.calls);
  assert.deepEqual(report.controlled, controlled);
  assert.deepEqual(report.controlled.rawModelEvaluation, report.overall);
  for (const record of report.controlled.records) {
    const call = report.calls.find(item => item.caseId === record.caseId);
    assert.equal(record.delivery.rewritten, false);
    if (record.delivery.status === 'blocked') assert.equal(record.delivery.customerOutput, null);
    else assert.equal(record.delivery.customerOutput, call.output);
  }
});

await check('offline approval predates the real run and historical evidence was not overwritten', async () => {
  const offlineFile = resolve(root, 'docs/evidence/model-v17-checker-r1-2026-10-17/offline-verification-r1.json');
  const offlineRaw = await readFile(offlineFile);
  const offline = JSON.parse(offlineRaw);
  assert.equal(sha(offlineRaw), plan.offlineVerificationSha256);
  assert.equal(offline.status, 'READY_FOR_REAL_EVALUATION');
  assert.equal(offline.providerCalls, 0);
  assert.equal(offline.realModelCalls, 0);
  assert.ok(Date.parse(offline.generatedAt ?? offline.createdAt) <= Date.parse(report.startedAt));
  assert.equal(
    sha(await readFile(resolve(root, 'docs/evidence/model-v15-2026-10-16/real-v15-2026-10-16T08-31-07.250Z.json'))),
    '01c9392af186ea9bea8a126127f0b82d347ac94c5546dc0387c6995a553666f8',
  );
  assert.equal(
    sha(await readFile(resolve(root, 'docs/evidence/model-v16-2026-10-16/real-v16-2026-10-16T08-50-53.534Z.json'))),
    'dfeee69328467283debc9153e54cf6955757a81e070466b71c1a97b7c0357cb1',
  );
});

const verification = {
  checkedAt: new Date().toISOString(),
  reportSha256: sha(raw),
  planSha256: sha(planRaw),
  journalSha256: report.journalSha256,
  checks,
  passed: checks.filter(item => item.passed).length,
  failed: checks.filter(item => !item.passed).length,
  providerCalls: report.calls.length,
  automaticRetries: report.automaticRetries,
  rawScore: report.overall.score,
  rawGate: report.overall.gate,
  finalStatus: report.finalStatus,
  scope: 'Evidence integrity and deterministic replay only; not a claim of hidden-set stability or production readiness.',
};
const output = file.replace(/\.json$/, '-verification-r2.json');
await writeFile(output, JSON.stringify(verification, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output, ...verification }));
if (verification.failed) process.exitCode = 1;
