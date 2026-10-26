// Read-only validation of original child receipts. Never repairs, rescales,
// relabels or rewrites source answers, scores, task states or missing samples.
import { open, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
const fail = () => { throw Error('Acceptance child evidence invalid'); };
const finite = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value ?? '');
const quantile = (values, q) => [...values].sort((a, b) => a - b)[Math.ceil(q * values.length) - 1];
const near = (a, b) => finite(a) && finite(b) && Math.abs(a - b) <= 1e-8;
const sameIds = (rows, ids, key) => Array.isArray(rows) && rows.length === ids.length &&
  new Set(rows.map(r => r[key])).size === ids.length && rows.every(r => ids.includes(r[key]));
async function json(file) {
  const h = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const s = await h.stat(); if (!s.isFile() || s.size > 32 * 1024 * 1024) fail(); return JSON.parse(await h.readFile('utf8')); }
  finally { await h.close(); }
}
function checks(r, count) {
  if (r.error || r.cleanupError || r.failed !== 0 || r.passed !== count || r.checks?.length !== count || r.checks.some(c => c.passed !== true)) fail();
}
export async function verifyAcceptanceEvidence(cwd, step, runId, result) {
  const evidence = join(cwd, 'evidence'), current = join(evidence, 'current');
  if (step === 'container-start') return;
  if (step === 'integration') return checks(await json(join(evidence, 'integration-local.json')), 18);
  if (step === 'improvements') return checks(await json(join(current, 'improvements-integration.json')), 4);
  if (step === 'ddd-contracts') {
    const dirs = (await readdir(evidence)).filter(n => /^contracts-[0-9a-f-]{36}$/.test(n));
    if (dirs.length !== 1) fail(); const r = await json(join(evidence, dirs[0], 'ddd-contracts.json'));
    if (r.status !== 'passed') fail(); return checks(r, 18);
  }
  if (step === 'fault-recovery') {
    const r = await json(join(evidence, 'fault-local.json'));
    if (r.passed !== true || r.error || r.cleanupError || !Number.isInteger(r.attempts) || r.attempts < 2) fail(); return;
  }
  if (step === 'prompt-replay') {
    const files = (await readdir(current)).filter(n => /^prompt-comparison-replay-\d+\.json$/.test(n));
    if (files.length !== 1) fail(); const r = await json(join(current, files[0]));
    if (!['2.1', '2.2'].includes(r.schemaVersion) || r.source !== 'replay' || r.cloud !== false || r.error || r.cases?.length !== 10 ||
      new Set(r.cases.map(c => c.id)).size !== 10 || r.policy?.minScore !== 95 || r.runs?.length !== 2 || r.caseComparison?.length !== 10) fail();
    const ids = r.cases.map(c => c.id);
    if (!sameIds(r.caseComparison, ids, 'caseId')) fail();
    for (const [i, version] of ['v1', 'v2'].entries()) {
      const j = r.runs[i];
      if (j.input?.promptVersion !== version || j.input?.source !== 'replay' || j.status !== 'succeeded' || j.result?.total !== 10 || j.result?.results?.length !== 10) fail();
      if (j.input.appId !== r.appId || j.input.suiteId !== r.suiteId || !sameIds(j.result.results, ids, 'caseId') ||
        j.result.gate !== 'passed' || j.result.score !== 100 || j.result.passed !== 10 || j.result.errors !== 0 || j.result.criticalFailures !== 0 ||
        j.result.results.some(c => c.status !== 'passed')) fail();
      for (const row of r.caseComparison) if (row.versions?.length !== 2 || row.versions[i]?.promptVersion !== version ||
        !isDeepStrictEqual(row.versions[i].caseResult, j.result.results.find(c => c.caseId === row.caseId))) fail();
    }
    return;
  }
  if (step === 'repeated-scaling') {
    const r = await json(join(current, 'scaling-repeated.json'));
    if (r.cloud !== false || r.automaticScaling !== false || r.providerCalls !== 0 || r.error || r.cleanupError || r.jobsPerStage !== 120 ||
      r.producers !== 8 || r.restoredWorkers !== 1 || r.stages?.length !== 6) fail();
    for (const [i, [round, replicas]] of [[1, 1], [1, 3], [2, 3], [2, 1], [3, 1], [3, 3]].entries()) {
      const s = r.stages[i];
      if (s.round !== round || s.replicas !== replicas || s.requested !== 120 || s.completed !== 120 || s.errors !== 0 || s.errorRate !== 0 ||
        !finite(s.elapsedMs) || s.elapsedMs === 0 || s.raw?.length !== 120 || s.admissionErrors?.length !== 0 || new Set(s.raw.map(j => j.id)).size !== 120 ||
        !finite(s.jobsPerSecond) || Math.abs(s.jobsPerSecond - 120000 / s.elapsedMs) > 1e-8) fail();
      for (const row of s.raw) if (row.error || row.status !== 'succeeded' || row.gate !== 'passed' || !finite(row.submitMs) || !finite(row.executionMs) ||
        !finite(Date.parse(row.startedAt) - Date.parse(row.createdAt)) || !finite(Date.parse(row.finishedAt) - Date.parse(row.startedAt))) fail();
      for (const name of ['completionP50Ms', 'completionP95Ms', 'queueP95Ms', 'executionP95Ms', 'submissionP95Ms']) if (!finite(s[name])) fail();
      const completion = s.raw.map(j => Date.parse(j.finishedAt) - Date.parse(j.createdAt));
      if (s.completionP50Ms !== quantile(completion, 0.5) || s.completionP95Ms !== quantile(completion, 0.95) ||
        s.queueP95Ms !== quantile(s.raw.map(j => Date.parse(j.startedAt) - Date.parse(j.createdAt)), 0.95) ||
        s.executionP95Ms !== quantile(s.raw.map(j => j.executionMs), 0.95) || s.submissionP95Ms !== quantile(s.raw.map(j => j.submitMs), 0.95)) fail();
    }
    return;
  }
  if (step === 'mixed-read-write') {
    const dir = join(evidence, 'private/mixed-load', runId), terminal = await json(join(dir, 'terminal.json')), r = await json(join(dir, 'report.json'));
    if (terminal.runId !== runId || terminal.status !== 'completed' || r.runId !== runId || r.passed !== true || r.error || r.cloud !== false || r.realProviderCalls !== 0 ||
      r.protocol?.secondsPerStage !== 20 || r.protocol?.clients !== 4 || r.protocol?.thinkTimeMs !== 100 || r.protocol?.workerReplicas !== 1 || r.stages?.length !== 2) fail();
    for (const [i, initialRows] of [100, 1000].entries()) {
      const s = r.stages[i];
      if (s.initialRows !== initialRows || s.state !== 'completed' || s.seed?.length !== initialRows || s.seed.some(row => row.state !== 'completed') ||
        s.errors !== 0 || s.requests !== s.raw?.length || s.completedWrites !== s.admittedWrites || s.rowCountMatches !== true ||
        s.databaseRowsAfter !== initialRows + s.admittedWrites || s.raw.some(row => row.passed !== true || !finite(row.durationMs)) || s.measurements?.length !== 2 ||
        s.measurements.some(m => m.timingValid !== true || m.errors !== 0)) fail();
      if (s.workspace !== 'mixed-' + initialRows + '-' + runId || !finite(s.elapsedMs) || s.elapsedMs < 20000 ||
        new Set(s.seed.map(row => row.id)).size !== initialRows || s.seed.some((row, index) => row.i !== index || !uuid(row.id) || row.observedStatus !== 'succeeded' || row.observedGate !== 'passed') ||
        new Set(s.raw.map(row => row.i)).size !== s.raw.length || s.raw.some(row => !Number.isInteger(row.i) || row.i < 0 || row.i >= s.raw.length ||
          row.kind !== (row.i % 4 === 3 ? 'write' : 'read') || row.status !== (row.kind === 'write' ? 202 : 200) || row.networkEntered !== true || row.outcome !== 'response_received')) fail();
      const writes = s.raw.filter(row => row.kind === 'write');
      if (!writes.length || s.attemptedWrites !== writes.length || s.admittedWrites !== writes.length || s.observedCompletedWritesAllAttempts !== writes.length ||
        s.writtenJobs?.length !== writes.length || new Set(s.writtenJobs.map(w => w.id)).size !== writes.length ||
        writes.some(row => !uuid(row.id) || !uuid(row.key) || !s.writtenJobs.some(w => w.i === row.i && w.id === row.id && w.key === row.key && w.admissionResponseStatus === 202 &&
          w.submissionOutcome === 'accepted' && w.status === 'succeeded' && w.gate === 'passed' && !w.observationError))) fail();
      for (const kind of ['read', 'write']) {
        const rows = s.raw.filter(row => row.kind === kind), m = s.measurements.filter(row => row.kind === kind);
        if (!rows.length || m.length !== 1 || m[0].requests !== rows.length || !near(m[0].requestsPerSecond, rows.length * 1000 / s.elapsedMs) ||
          m[0].p50Ms !== quantile(rows.map(row => row.durationMs), 0.5) || m[0].p95Ms !== quantile(rows.map(row => row.durationMs), 0.95) ||
          m[0].p99Ms !== quantile(rows.map(row => row.durationMs), 0.99)) fail();
      }
    }
    return;
  }
  if (step === 'dependency-audit') {
    const r = JSON.parse(result.stdout); if (r.error || r.metadata?.vulnerabilities?.high !== 0 || r.metadata?.vulnerabilities?.critical !== 0) fail(); return;
  }
  fail();
}
