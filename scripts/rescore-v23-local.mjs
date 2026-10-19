// Offline derivation only: no API key, fetch, provider call or historical write.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { evaluate } from '../dist/src/domain.js';
import { promptSnapshot } from '../dist/src/provider.js';
if (!process.argv[2]) throw Error('Usage: node scripts/rescore-v23-local.mjs <original-C-repository>');
const root = resolve(process.argv[2]), folder = 'docs/evidence/model-v3-2026-10-14/';
const hash = data => createHash('sha256').update(data).digest('hex');
const planBytes = await readFile(resolve(root, folder, 'plan.json')), plan = JSON.parse(planBytes);
const files = ['real-v3-2026-10-14T14-06-07.034Z.json', 'real-v4-2026-10-14T14-15-23.420Z.json', 'real-v5-2026-10-14T14-25-15.496Z.json'];
const report = { checkedAt: new Date().toISOString(), mode: 'offline_rescore', source: 'imported', originalExecutionSource: 'real', newModelCalls: 0, baseCommit: '20d258d891935b2d5bee3375ebf81b2872adf76f', planSha256: hash(planBytes), sourceHashes: {}, runs: [], humanReview: 'PENDING', v6RealModelTest: 'NOT_RUN', limitations: ['Development regression, not a held-out model benchmark.', 'English heuristics do not establish general semantic correctness.', 'A changed score on identical answers measures evaluator changes, not model improvement.'] };
for (const file of ['src/domain.ts', 'src/returns-policy.ts', 'src/privacy-v23.ts', 'src/privacy-v24.ts', 'src/provider.ts']) report.sourceHashes[file] = hash(await readFile(file));
for (const file of files) {
  const path = resolve(root, folder, file), bytes = await readFile(path), source = JSON.parse(bytes);
  assert.equal(source.source, 'real'); assert.equal(source.calls.length, 20);
  assert.equal(source.planSha256, hash(planBytes));
  assert.deepEqual(promptSnapshot(source.promptSnapshot.version), source.promptSnapshot);
  const originalCases = plan.suites.flatMap(s => s.cases);
  assert.deepEqual(evaluate(originalCases, plan.policy, source.calls), source.overall);
  const derived = {};
  for (const version of ['v2.1', 'v2.2', 'v2.3', 'v2.4']) {
    const rule = 'returns_policy_' + version.replace('.', '_');
    const cases = originalCases.map(c => ({ ...c, rule }));
    derived[version] = evaluate(cases, plan.policy, source.calls);
  }
  assert.equal(hash(await readFile(path)), hash(bytes));
  report.runs.push({ originalFile: folder + file, originalReportSha256: hash(bytes), originalEvaluator: source.evaluatorVersion, promptVersion: source.promptSnapshot.version, rawAnswersUnchanged: true, derived });
}
assert.equal(hash(await readFile(resolve(root, folder, 'plan.json'))), hash(planBytes));
const dest = 'docs/evidence/privacy-v23-v6-20261015';
await mkdir(dest, { recursive: true });
const output = `${dest}/offline-rescore-${Date.now()}.json`;
await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output, newModelCalls: 0, v6: 'NOT_RUN', runs: report.runs.map(r => ({ prompt: r.promptVersion, originalSha256: r.originalReportSha256, versions: Object.fromEntries(Object.entries(r.derived).map(([v, result]) => [v, { score: result.score, gate: result.gate, failures: result.results.filter(x => x.status !== 'passed').map(x => ({ id: x.caseId, reason: x.reason })) }])) })) }, null, 2));
