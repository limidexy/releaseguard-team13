import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { providerAnswer, promptSnapshot } from '../dist/src/provider.js';
import { evaluate, suiteSchema } from '../dist/src/domain.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const dir = resolve(root, 'docs/evidence/model-v11-2026-10-16');
const planFile = resolve(dir, 'plan.json');
const sha = value => createHash('sha256').update(value).digest('hex');
const sourceFiles = ['src/provider.ts', 'src/domain.ts', 'src/returns-policy.ts', 'src/privacy-v23.ts', 'src/privacy-v24.ts', 'src/privacy-v25.ts', 'src/answer-v25.ts', 'src/refinements-v26.ts', 'src/returns-policy-v27.ts', 'src/returns-policy-v28.ts',
  'dist/src/provider.js', 'dist/src/domain.js', 'dist/src/returns-policy.js', 'dist/src/privacy-v23.js', 'dist/src/privacy-v24.js', 'dist/src/privacy-v25.js', 'dist/src/answer-v25.js', 'dist/src/refinements-v26.js', 'dist/src/returns-policy-v27.js', 'dist/src/returns-policy-v28.js'];
const action = process.argv[2];
const frozenBaseline = JSON.parse(await readFile(resolve(root, 'tests/frozen-v26-v8.json')));
for (const [p, hash] of Object.entries(frozenBaseline.scorers)) assert.equal(sha(await readFile(resolve(root, p))), hash, 'Scoring policy changed');
const v27Baseline = JSON.parse(await readFile(resolve(root, 'tests/frozen-v27-v10.json')));
assert.equal(sha(await readFile(resolve(root, 'src/returns-policy-v27.ts'))), v27Baseline.v27Sha256);
await mkdir(dir, { recursive: true });
if (action === 'freeze') {
  if (!process.argv[3]) throw Error('Supply the previous frozen plan path');
  const originalRaw = await readFile(resolve(process.argv[3]));
  const original = JSON.parse(originalRaw);
  const suites = original.suites.map(s => ({ ...s, cases: s.cases.map(c => ({ ...c, rule: 'returns_policy_v2_8' })) }));
  assert.equal(suites.flatMap(s => s.cases).length, 20);
  for (const { group, ...suite } of suites) suiteSchema.parse(suite);
  const sources = {};
  for (const file of sourceFiles) {
    const bytes = await readFile(resolve(root, file));
    sources[file] = sha(bytes);
    const snapshot = resolve(dir, 'source', file + '.txt');
    await mkdir(resolve(snapshot, '..'), { recursive: true });
    await writeFile(snapshot, bytes, { flag: 'wx' });
  }
  const plan = { frozenAt: new Date().toISOString(), model: 'openai/gpt-oss-20b', providerOrigin: 'https://api.groq.com',
    frozenScorerBaseline: frozenBaseline.scorers, evaluatorVersion: 'returns-policy-v2.8', promptSnapshot: promptSnapshot('v11'), originalPlanSha256: sha(originalRaw),
    maxRequests: 20, minimumStartIntervalMs: 20000, automaticRetries: 0, policy: original.policy, sources, suites,
    freePlanCheck: { observedAt: new Date().toISOString(), page: 'https://console.groq.com/settings/billing/plans', visibleState: 'Free, $0, Current Plan', method: 'Read-only authenticated Chrome UI' },
    limitations: ['Development regression on the same 20 cases, not a held-out benchmark.', 'One response per case; no stability guarantee.', 'English heuristic gate is not complete semantic review.'],
    environment: 'Local provider adapter calling Groq; no cloud rollout, no hosted CI, no synthetic answers.' };
  await writeFile(planFile, JSON.stringify(plan, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ frozen: planFile, planSha256: sha(await readFile(planFile)), callsMade: 0 }));
} else if (action === 'run') {
  if (process.env.RG_CONFIRM_REAL_CALLS !== '20' || process.env.RG_CONFIRMED_FREE_PLAN !== 'true') throw Error('Explicit 20-call authorization and current Free plan check required');
  const planRaw = await readFile(planFile), plan = JSON.parse(planRaw);
  assert.equal(plan.maxRequests, 20); assert.equal(plan.policy.minScore, 95);
  assert.deepEqual(promptSnapshot('v11'), plan.promptSnapshot);
  for (const file of sourceFiles) assert.equal(sha(await readFile(resolve(root, file))), plan.sources[file], 'Frozen source changed: ' + file);
  if (!process.argv[3]) throw Error('Supply existing local provider env file path, never a key');
  const saved = parseEnv(await readFile(resolve(process.argv[3]), 'utf8'));
  if (!saved.MODEL_API_KEY) throw Error('Saved provider key missing');
  const stamp = new Date().toISOString().replaceAll(':', '-');
  const runFile = resolve(dir, 'real-v11-' + stamp + '.json'), journal = runFile.replace(/\.json$/, '.jsonl');
  const report = { startedAt: new Date().toISOString(), source: 'real', environment: plan.environment,
    providerOrigin: plan.providerOrigin, model: plan.model, promptSnapshot: plan.promptSnapshot, evaluatorVersion: plan.evaluatorVersion,
    planSha256: sha(planRaw), sources: plan.sources, minimumStartIntervalMs: plan.minimumStartIntervalMs,
    automaticRetries: 0, freePlanVerifiedAtInvocation: true, humanReview: { status: 'PENDING', reviewer: null },
    limitations: plan.limitations, calls: [], results: [], stoppedReason: null };
  await writeFile(journal, JSON.stringify({ event: 'started', ...report }) + '\n', { flag: 'wx' });
  let nextStart = 0;
  for (const suite of plan.suites) {
    for (const c of suite.cases) {
      if (report.stoppedReason) break;
      if (Date.now() < nextStart) await delay(nextStart - Date.now());
      nextStart = Date.now() + plan.minimumStartIntervalMs;
      const startedAt = new Date().toISOString(), start = performance.now();
      let answer;
      try {
        answer = await providerAnswer({ url: 'https://api.groq.com/openai/v1/chat/completions', key: saved.MODEL_API_KEY, model: plan.model }, 'v11', c.prompt);
      } catch (error) {
        answer = { error: /Provider HTTP \d{3}/.exec(String(error))?.[0] ?? 'Provider request failed or timed out; no automatic retry' };
      }
      const call = { group: suite.group, caseId: c.id, prompt: c.prompt, startedAt, latencyMs: performance.now() - start, ...answer };
      report.calls.push(call);
      await appendFile(journal, JSON.stringify({ event: 'provider-response', ...call }) + '\n');
      console.log(JSON.stringify({ call: report.calls.length, caseId: c.id, httpStatus: answer.metadata?.httpStatus, finishReason: answer.metadata?.finishReason, error: answer.error ?? null }));
      if (answer.error) report.stoppedReason = 'Stopped after first provider error: ' + answer.error;
    }
    report.results.push({ group: suite.group, ...evaluate(suite.cases, plan.policy, report.calls.filter(c => c.group === suite.group)) });
  }
  report.finishedAt = new Date().toISOString();
  report.totalCalls = report.calls.length;
  report.overall = evaluate(plan.suites.flatMap(s => s.cases), plan.policy, report.calls);
  report.totalTokens = report.calls.reduce((n, c) => n + (c.metadata?.usage?.total_tokens ?? 0), 0);
  report.journalSha256 = sha(await readFile(journal));
  await writeFile(runFile, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ report: runFile, calls: report.totalCalls, tokens: report.totalTokens, score: report.overall.score, gate: report.overall.gate, stoppedReason: report.stoppedReason }));
  if (report.overall.gate !== 'passed') process.exitCode = 1;
} else throw Error('Use freeze or run');
