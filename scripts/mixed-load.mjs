import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { cpus, platform, arch } from 'node:os';
import { token } from './dev-tokens.mjs';
import { application, suite } from './fixtures.mjs';
import { base, required, request, completed, key } from './client.mjs';

if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw Error('Local workload only');
const seconds = Number(process.env.RG_LOAD_SECONDS ?? 20);
if (!Number.isInteger(seconds) || seconds < 5 || seconds > 30) throw Error('Bounded duration: 5–30 seconds per stage');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const percentile = (a, q) => a.length ? [...a].sort((x, y) => x - y)[Math.ceil(q * a.length) - 1] : null;
const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 30000, stdio: 'pipe' });
async function parallel(items, fn, limit = 6) {
  let next = 0; const output = new Array(items.length);
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; output[i] = await fn(items[i], i); }
  })); return output;
}
function telemetry() {
  const ids = docker(['compose', 'ps', '-q']).trim().split('\n').filter(Boolean);
  const containers = docker(['stats', '--no-stream', '--format', '{{json .}}', ...ids]).trim().split('\n').filter(Boolean).map(JSON.parse);
  const database = JSON.parse(docker(['compose', 'exec', '-T', 'evaluation', 'node', '--input-type=module', '-e',
    "import pg from 'pg';const c=new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect();console.log(JSON.stringify((await c.query(\"SELECT datname,xact_commit,xact_rollback,blks_read,blks_hit,tup_returned,tup_fetched,tup_inserted,tup_updated,deadlocks FROM pg_stat_database WHERE datname=current_database()\")).rows[0]));await c.end()"]));
  return { at: new Date().toISOString(), containers, database };
}
const report = {
  startedAt: new Date().toISOString(), cloud: false, realProviderCalls: 0,
  host: { platform: platform(), arch: arch(), logicalCpus: cpus().length },
  protocol: { secondsPerStage: seconds, clients: 4, thinkTimeMs: 100, schedule: '3 reads then 1 job write, shared round-robin counter', initialRows: [100, 1000], workerReplicas: 1 },
  interpretation: 'Actual local HTTP + PostgreSQL + queue workload using replay answers. Closed-loop, short sustained sample, not a maximum-capacity or cloud benchmark. Latencies are API response times, not isolated SQL timings. Observer polling occurs after each measured interval. Docker CPU is instantaneous sample only; DB stats are cumulative.',
  stages: [],
};
try {
  const workers = docker(['compose', 'ps', '-q', 'worker']).trim().split('\n').filter(Boolean).length;
  if (workers !== 1) throw Error('Run with one worker after scaling experiment restores the stack');
  for (const initialRows of report.protocol.initialRows) {
    const workspace = `mixed-${initialRows}-${Date.now()}`;
    const seedToken = await token('seed-author', 'contributor', workspace), loadToken = await token('load-author', 'contributor', workspace);
    const a = await required('applications', seedToken, application), s = await required('suites', seedToken, suite);
    const input = i => ({ appId: a.id, suiteId: s.id, candidate: 'load-' + i, commitRef: 'course-local', source: 'replay', scenario: 'passing' });
    const seed = await parallel(Array.from({ length: initialRows }, (_, i) => i), i => required('jobs', seedToken, input('seed-' + i), key()));
    await parallel(seed, async q => { const j = await completed(q.id, seedToken); if (j.status !== 'succeeded' || j.result.gate !== 'passed') throw Error('Seed did not complete'); }, 12);
    const before = telemetry(), raw = [], jobIds = []; let sequence = 0;
    const start = performance.now(), deadline = start + seconds * 1000;
    await Promise.all(Array.from({ length: 4 }, async (_, client) => {
      while (performance.now() < deadline) {
        const i = sequence++, write = i % 4 === 3;
        const path = write ? 'jobs' : i % 2 ? `jobs/${seed[i % seed.length].id}` : `jobs?limit=25&offset=${(i * 7) % Math.max(1, initialRows - 25)}`;
        const began = performance.now();
        try {
          const response = await request(path, loadToken, write ? input(i) : undefined, write ? key() : undefined);
          const passed = response.status === (write ? 202 : 200);
          raw.push({ i, client, kind: write ? 'write' : 'read', atMs: began - start, durationMs: performance.now() - began, status: response.status, passed });
          if (passed && write) jobIds.push(response.data.id);
        } catch (error) { raw.push({ i, client, kind: write ? 'write' : 'read', atMs: began - start, durationMs: performance.now() - began, passed: false, error: String(error) }); }
        await sleep(100);
      }
    }));
    const elapsedMs = performance.now() - start, after = telemetry();
    const jobs = await parallel(jobIds, async id => { try { return await completed(id, loadToken); } catch (error) { return { id, error: String(error) }; } }, 12);
    const rowCount = Number(docker(['compose', 'exec', '-T', 'evaluation', 'node', '--input-type=module', '-e',
      "import pg from 'pg';const c=new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect();console.log((await c.query('SELECT count(*) FROM jobs WHERE workspace=$1',[process.argv[1]])).rows[0].count);await c.end()", workspace]).trim());
    const stage = { initialRows, workspace, elapsedMs, requests: raw.length,
      errors: raw.filter(r => !r.passed).length,
      completedWrites: jobs.filter(j => j.status === 'succeeded' && j.result?.gate === 'passed').length,
      admittedWrites: jobIds.length, databaseRowsAfter: rowCount, rowCountMatches: rowCount === initialRows + jobIds.length,
      measurements: ['read', 'write'].map(kind => { const rows = raw.filter(r => r.kind === kind); return { kind, requests: rows.length, errors: rows.filter(r => !r.passed).length, requestsPerSecond: rows.length * 1000 / elapsedMs, p50Ms: percentile(rows.map(r => r.durationMs), .5), p95Ms: percentile(rows.map(r => r.durationMs), .95), p99Ms: percentile(rows.map(r => r.durationMs), .99) }; }),
      before, after, raw, writtenJobs: jobs.map(j => ({ id: j.id, status: j.status, gate: j.result?.gate, error: j.error })) };
    report.stages.push(stage);
    console.log(JSON.stringify({ ...stage, before: undefined, after: undefined, raw: undefined, writtenJobs: undefined }));
    if (stage.errors || stage.completedWrites !== stage.admittedWrites || !stage.rowCountMatches) throw Error('Read/write correctness gate failed');
  }
} catch (error) { report.error = String(error); process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString(); report.passed = report.stages.length === 2 && !report.error;
  await mkdir('evidence/current', { recursive: true });
  await writeFile('evidence/current/mixed-load.json', JSON.stringify(report, null, 2));
}
