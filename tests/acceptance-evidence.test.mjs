import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { verifyAcceptanceEvidence } from '../scripts/acceptance-evidence.mjs';
import { evidenceFixture, evidenceRunId as id, promptReceipt, repeatedReceipt, mixedReceipt } from './fixtures/acceptance-evidence-fixture.mjs';

for (const [step, path, count] of [['integration', 'evidence/integration-local.json', 18],
  ['improvements', 'evidence/current/improvements-integration.json', 4],
  ['ddd-contracts', 'evidence/contracts-' + id + '/ddd-contracts.json', 18]]) test('original ' + step + ' check cohort must be complete and unchanged', async () => {
  const f = evidenceFixture();
  try {
    const report = { status: 'passed', passed: count, failed: 0, checks: Array.from({ length: count }, (_, i) => ({ name: 'Synthetic contract ' + i, passed: true })) };
    const saved = f.put(path, report); await verifyAcceptanceEvidence(f.root, step, id, { status: 0 });
    assert.equal(fs.readFileSync(saved.file, 'utf8'), saved.raw);
    report.checks.pop(); f.put(path, report); await assert.rejects(verifyAcceptanceEvidence(f.root, step, id, { status: 0 }));
  } finally { f.cleanup(); }
});
test('zero exit without the promised integration receipt cannot pass', async () => {
  const f = evidenceFixture(); try { await assert.rejects(verifyAcceptanceEvidence(f.root, 'integration', id, { status: 0 })); } finally { f.cleanup(); }
});
test('fault recovery needs the original recovery attempt evidence and no error', async () => {
  const f = evidenceFixture();
  try { f.put('evidence/fault-local.json', { passed: true, attempts: 2 }); await verifyAcceptanceEvidence(f.root, 'fault-recovery', id, {});
    f.put('evidence/fault-local.json', { passed: true, attempts: 1 }); await assert.rejects(verifyAcceptanceEvidence(f.root, 'fault-recovery', id, {}));
  } finally { f.cleanup(); }
});
test('complete replay comparison is accepted without modifying original scores or answers', async () => {
  const f = evidenceFixture();
  try { const saved = f.put('evidence/current/prompt-comparison-replay-1.json', promptReceipt());
    await verifyAcceptanceEvidence(f.root, 'prompt-replay', id, {}); assert.equal(fs.readFileSync(saved.file, 'utf8'), saved.raw);
  } finally { f.cleanup(); }
});
for (const [label, patch] of [
  ['duplicate result case replacing a missing case', r => { r.runs[0].result.results[9] = structuredClone(r.runs[0].result.results[0]); }],
  ['duplicate comparison case replacing a missing case', r => { r.caseComparison[9] = structuredClone(r.caseComparison[0]); }],
  ['blocked gate hidden behind succeeded execution', r => { r.runs[0].result.gate = 'blocked'; r.runs[0].result.score = 90; }],
  ['real-model source hidden in a replay report', r => { r.runs[0].input.source = 'real'; }],
]) test('replay child receipt rejects ' + label, async () => {
  const f = evidenceFixture();
  try { const r = promptReceipt(); patch(r); const saved = f.put('evidence/current/prompt-comparison-replay-1.json', r);
    await assert.rejects(verifyAcceptanceEvidence(f.root, 'prompt-replay', id, {})); assert.equal(fs.readFileSync(saved.file, 'utf8'), saved.raw);
  } finally { f.cleanup(); }
});
test('full six-stage benchmark is structural replay evidence, not automatic-scaling acceptance', async () => {
  const f = evidenceFixture(); try { const saved = f.put('evidence/current/scaling-repeated.json', repeatedReceipt());
    await verifyAcceptanceEvidence(f.root, 'repeated-scaling', id, {}); assert.equal(fs.readFileSync(saved.file, 'utf8'), saved.raw);
  } finally { f.cleanup(); }
});
for (const [label, patch] of [
  ['missing raw task', r => { r.stages[0].raw.pop(); }],
  ['negative raw completion interval', r => { r.stages[0].raw[0].finishedAt = '2025-12-31T23:59:59.000Z'; }],
  ['invented p95 not matching the original cohort', r => { r.stages[0].completionP95Ms = 999; }],
  ['hidden failed task', r => { r.stages[0].raw[0].status = 'failed'; }],
]) test('benchmark child receipt rejects ' + label, async () => {
  const f = evidenceFixture(); try { const r = repeatedReceipt(); patch(r); const saved = f.put('evidence/current/scaling-repeated.json', r);
    await assert.rejects(verifyAcceptanceEvidence(f.root, 'repeated-scaling', id, {})); assert.equal(fs.readFileSync(saved.file, 'utf8'), saved.raw);
  } finally { f.cleanup(); }
});
async function saveMixed(f, value) { const dir = 'evidence/private/mixed-load/' + id;
  f.put(dir + '/terminal.json', { runId: id, status: 'completed', realProviderCalls: 0, report: 'report.json' }); return f.put(dir + '/report.json', value); }
test('complete mixed two-stage cohort is accepted without modifying raw rows', async () => {
  const f = evidenceFixture(); try { const saved = await saveMixed(f, mixedReceipt()); await verifyAcceptanceEvidence(f.root, 'mixed-read-write', id, {});
    assert.equal(fs.readFileSync(saved.file, 'utf8'), saved.raw);
  } finally { f.cleanup(); }
});
for (const [label, patch] of [
  ['duplicate seed job replacing a distinct task', r => { r.stages[0].seed[99].id = r.stages[0].seed[0].id; }],
  ['HTTP503 incorrectly labelled passed', r => { r.stages[0].raw[3].status = 503; }],
  ['negative stage time hidden by timingValid', r => { r.stages[0].elapsedMs = -1; }],
  ['invented percentile', r => { r.stages[0].measurements[0].p95Ms = 0; }],
  ['missing attempted write observer', r => { r.stages[0].writtenJobs = []; }],
]) test('mixed child receipt rejects ' + label, async () => {
  const f = evidenceFixture(); try { const r = mixedReceipt(); patch(r); const saved = await saveMixed(f, r);
    await assert.rejects(verifyAcceptanceEvidence(f.root, 'mixed-read-write', id, {})); assert.equal(fs.readFileSync(saved.file, 'utf8'), saved.raw);
  } finally { f.cleanup(); }
});
test('dependency audit with a high advisory cannot pass even with zero process exit', async () => {
  const f = evidenceFixture(); try {
    await verifyAcceptanceEvidence(f.root, 'dependency-audit', id, { stdout: '{"metadata":{"vulnerabilities":{"high":0,"critical":0}}}' });
    await assert.rejects(verifyAcceptanceEvidence(f.root, 'dependency-audit', id, { stdout: '{"metadata":{"vulnerabilities":{"high":1,"critical":0}}}' }));
  } finally { f.cleanup(); }
});
