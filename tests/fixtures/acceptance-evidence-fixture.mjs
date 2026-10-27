// Synthetic complete child protocol shapes. No real job/model/performance data.
import fs from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
export const evidenceRunId = 'f7df9b5c-08e9-4d1d-9c73-7cbd99bcb50a';
const uuid = i => '10000000-0000-4000-8000-' + String(i).padStart(12, '0');
export function promptReceipt() {
  const cases = Array.from({ length: 10 }, (_, i) => ({ id: 'case-' + i, name: 'Synthetic case ' + i, prompt: 'Fictional customer question', rule: 'not_empty', expected: '', critical: false }));
  const result = { total: 10, passed: 10, errors: 0, criticalFailures: 0, score: 100, gate: 'passed',
    results: cases.map(c => ({ caseId: c.id, critical: false, rule: 'not_empty', expected: '', output: 'Fixed fictional answer', latencyMs: 1, status: 'passed', reason: 'Rule passed' })) };
  const runs = ['v1', 'v2'].map((promptVersion, i) => ({ id: uuid(i + 1), workspace: 'comparison-synthetic', status: 'succeeded',
    input: { appId: uuid(20), suiteId: uuid(21), candidate: 'support-' + promptVersion, commitRef: 'course-v2', source: 'replay', promptVersion, scenario: 'passing' },
    result: structuredClone(result), attempts: 1, created_by: 'comparison-author',
    created_at: '2026-01-01T00:00:00.000Z', started_at: '2026-01-01T00:00:00.001Z', finished_at: '2026-01-01T00:00:00.002Z' }));
  for (const job of runs) job.workspace = 'comparison-' + evidenceRunId;
  return { schemaVersion: '2.2', runId: evidenceRunId, workspace: 'comparison-' + evidenceRunId,
    suiteRevision: 'legacy', evaluatorVersion: 'legacy-literal-v1', shadowOnly: true, reviewer: 'calibration_pending',
    source: 'replay', cloud: false, appId: uuid(20), suiteId: uuid(21), cases,
    policy: { minScore: 95, maxLatencyMs: null }, runs, semanticConclusion: 'NOT_ASSESSED: synthetic replay only',
    caseComparison: cases.map(c => ({ caseId: c.id, prompt: c.prompt, critical: c.critical,
      versions: runs.map(r => ({ promptVersion: r.input.promptVersion, caseResult: structuredClone(r.result.results.find(x => x.caseId === c.id)) })),
      humanReview: { reviewer: null, policyAccuracy: null, safety: null, helpfulness: null, reason: null } })) };
}
export function comparisonTerminal() { return { runId: evidenceRunId, status: 'completed', modelRequestBudget: 0, modelRequestsReserved: 0,
  states: ['v1','v2'].map(promptVersion => ({ promptVersion, state: 'completed' })) }; }
export function repeatedReceipt() {
  const stages = [[1, 1], [1, 3], [2, 3], [2, 1], [3, 1], [3, 3]].map(([round, replicas], stage) => ({
    round, replicas, workspace: 'repeat-synthetic-' + stage, elapsedMs: 1000, requested: 120, completed: 120, errors: 0, errorRate: 0, blocked: 0,
    jobsPerSecond: 120, completionP50Ms: 150, completionP95Ms: 150, queueP95Ms: 50, executionP95Ms: 100, submissionP95Ms: 10,
    workerIds: Array.from({ length: replicas }, (_, i) => 'synthetic-worker-' + i), admissionErrors: [],
    raw: Array.from({ length: 120 }, (_, i) => ({ id: uuid(stage * 120 + i + 1), submitMs: 10, status: 'succeeded', gate: 'passed',
      createdAt: '2026-01-01T00:00:00.000Z', startedAt: '2026-01-01T00:00:00.050Z', finishedAt: '2026-01-01T00:00:00.150Z',
      workerId: 'synthetic-worker-' + (i % replicas), executionMs: 100 })) }));
  return { cloud: false, automaticScaling: false, providerCalls: 0, jobsPerStage: 120, producers: 8, restoredWorkers: 1, stages,
    summary: [1, 3].map(replicas => ({ replicas, rounds: 3, medianJobsPerSecond: 120, medianCompletionP95Ms: 150, totalErrors: 0 })), throughputRatio: 1,
    interpretation: 'Synthetic receipt only; not a measurement or scaling result.' };
}
export function mixedReceipt() {
  return { runId: evidenceRunId, passed: true, cloud: false, realProviderCalls: 0,
    protocol: { secondsPerStage: 20, clients: 4, thinkTimeMs: 100, workerReplicas: 1, initialRows: [100, 1000], seedClients: 6, observerClients: 12 },
    stages: [100, 1000].map(initialRows => ({ initialRows, workspace: 'mixed-' + initialRows + '-' + evidenceRunId, state: 'completed', elapsedMs: 20000,
      seed: Array.from({ length: initialRows }, (_, i) => ({ i, id: uuid(initialRows * 10 + i), state: 'completed', observedStatus: 'succeeded', observedGate: 'passed' })),
      raw: ['read', 'read', 'read', 'write'].map((kind, i) => ({ i, client: i, kind, status: kind === 'write' ? 202 : 200, passed: true, durationMs: 10,
        atMs: 100, networkEntered: true, outcome: 'response_received', ...(kind === 'write' ? { id: uuid(initialRows * 20), key: uuid(initialRows * 30) } : {}) })),
      writtenJobs: [{ i: 3, key: uuid(initialRows * 30), id: uuid(initialRows * 20), admissionResponseStatus: 202, submissionOutcome: 'accepted', status: 'succeeded', gate: 'passed', observationError: null }],
      errors: 0, requests: 4, attemptedWrites: 1, admittedWrites: 1, completedWrites: 1, observedCompletedWritesAllAttempts: 1,
      rowCountMatches: true, databaseRowsAfter: initialRows + 1,
      measurements: [{ kind: 'read', requests: 3, errors: 0, requestsPerSecond: 0.15, p50Ms: 10, p95Ms: 10, p99Ms: 10, timingValid: true },
        { kind: 'write', requests: 1, errors: 0, requestsPerSecond: 0.05, p50Ms: 10, p95Ms: 10, p99Ms: 10, timingValid: true }] })) };
}
export function evidenceFixture() {
  const root = fs.mkdtempSync(join(tmpdir(), 'rg-acceptance-evidence-'));
  function put(relative, value) { const file = join(root, relative); fs.mkdirSync(dirname(file), { recursive: true }); const raw = JSON.stringify(value, null, 2) + '\n'; fs.writeFileSync(file, raw); return { file, raw }; }
  return { root, put, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
