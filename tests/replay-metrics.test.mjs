import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { p95, summarize, comparePair, compareRounds } from '../scripts/replay-metrics.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/replay-metrics.synthetic.json', import.meta.url), 'utf8'));
const summarizeFixture = (rows = fixture.rows, responses = fixture.responses) => summarize(rows, responses, fixture.window, fixture.readyWorkers);

test('nearest-rank p95 preserves zero and rejects missing or invalid observations', () => {
  assert.equal(p95([]), null); assert.equal(p95([0]), 0);
  assert.equal(p95(Array.from({ length: 20 }, (_, i) => i + 1)), 19);
  for (const x of [null, undefined, NaN, Infinity, -1]) assert.throws(() => p95([1, x]));
});

test('separates HTTP, terminal lifecycle, fixed window and drain denominators', () => {
  const s = summarizeFixture();
  assert.equal(s.attempted, 2); assert.equal(s.accepted, 1); assert.equal(s.httpStatusCounts[504], 1);
  assert.equal(s.dbObserved, 2); assert.equal(s.httpErrorsWithDbTerminal, 1);
  assert.equal(s.successful, 1); assert.equal(s.failed, 1); assert.equal(s.latencyDenominator, 2);
  assert.equal(s.completionP95Ms, 12000); assert.equal(s.submissionP95Ms, 200);
  assert.equal(s.windowJobsPerSecond, .1); assert.equal(s.cohortIncludingDrainJobsPerSecond, 1 / 12);
  assert.equal(s.wholeBatchMs, 12000); assert.equal(s.perWorker['worker-zero'], 0);
  assert.equal(s.allObservedReadyWorkersProcessed, false);
  assert.deepEqual(s.outboxDeltas.map(x => x.deltaMs), [-1000, null]);
  assert.equal(s.outboxDispatchP95Ms, null); assert.match(s.outboxMetricStatus, /UNAVAILABLE/);
});

test('missing, unfinished and unknown remain explicit; subset p95 cannot become whole-cohort p95', () => {
  const missing = summarizeFixture(fixture.rows.slice(0, 1));
  assert.equal(missing.missing, 1); assert.equal(missing.completionP95Ms, null);
  assert.equal(missing.observedTerminalLifecycleP95Ms, 2000);
  assert.equal(missing.wholeBatchMs, null); assert.equal(missing.cohortIncludingDrainJobsPerSecond, null);
  for (const [status, key] of [[fixture.cases.unfinishedStatus, 'unfinished'], [fixture.cases.unknownStatus, 'unknown']]) {
    const rows = structuredClone(fixture.rows); rows[1].status = status;
    const s = summarizeFixture(rows); assert.equal(s[key], 1); assert.equal(s.incomplete, 1);
    assert.equal(s.completionP95Ms, null); assert.equal(s.fullCohortAvailable, false);
  }
  const responses = structuredClone(fixture.responses); responses[0].elapsedMs = null;
  assert.equal(summarizeFixture(fixture.rows, responses).submissionP95Ms, null);
});

test('rejects duplicate/foreign jobs, invalid timestamps and non-replay evidence', () => {
  assert.throws(() => summarizeFixture([...fixture.rows, fixture.rows[0]]));
  for (const patch of [{ id: 'foreign' }, { source: 'live' }, { provenanceSource: 'live' }, { providerCalls: 1 }, { finishedAt: null }, { startedAt: '2026-01-01T00:00:20Z' }]) {
    const rows = structuredClone(fixture.rows); Object.assign(rows[0], patch);
    assert.throws(() => summarizeFixture(rows));
  }
  assert.throws(() => summarizeFixture(fixture.rows, [fixture.responses[0], fixture.responses[0]]));
});

test('window is half-open and a valid zero outbox delta differs from NULL', () => {
  const rows = structuredClone(fixture.rows);
  rows[0].finishedAt = fixture.window.endedAt; rows[0].sentAt = rows[0].createdAt;
  const s = summarizeFixture(rows);
  assert.equal(s.completionsWithinWindow, 0); assert.equal(s.outboxDeltas[0].deltaMs, 0);
  assert.equal(s.outboxTimestampAnomalies.length, 1);
});

test('synthetic r8-shaped transport counts retain 897 requests, 602 timeouts and 320 DB rows', () => {
  // Generated synthetic rows test the historical count shape, not historical latency evidence.
  const responses = Array.from({ length: 897 }, (_, i) => ({ requestId: `r${i}`, id: i < 320 ? `j${i}` : null, status: i < 295 ? 202 : 504, elapsedMs: i }));
  const rows = responses.slice(0, 320).map(r => ({ ...fixture.rows[0], id: r.id }));
  const s = summarizeFixture(rows, responses);
  assert.equal(s.attempted, 897); assert.equal(s.accepted, 295); assert.equal(s.httpStatusCounts[504], 602);
  assert.equal(s.dbObserved, 320); assert.equal(s.httpErrorsWithDbTerminal, 25);
  assert.equal(s.dbUnassociatedRequests, 577); assert.equal(s.incomplete, 577);
  assert.equal(s.completionP95Ms, null); assert.equal(s.fullCohortAvailable, false);
  assert.equal(s.latencyDenominator, 320);
});

function pair(round = 'r1', reverse = false) {
  const base = { attempted: 2, accepted: 2, successful: 2, failed: 0, incomplete: 0, httpErrors: 0, fullCohortAvailable: true, wholeBatchMs: 100, completionP95Ms: 100 };
  const meta = (mode, offset) => ({ experimentId: 'e', roundId: round, inputFingerprint: 'same-input', resourceFingerprint: 'same-worker-resources', windowPolicy: 'fixed-10s', cohortId: `${round}-${mode}`, jobIds: [`${round}-${mode}-1`, `${round}-${mode}-2`], mode, startedAt: `2026-01-01T00:00:${String(offset).padStart(2, '0')}Z`, endedAt: `2026-01-01T00:00:${String(offset + 10).padStart(2, '0')}Z` });
  const start = round === 'r1' ? 0 : 30;
  return { one: { ...base, metadata: meta('one', start + (reverse ? 10 : 0)) }, automatic: { ...base, wholeBatchMs: 80, completionP95Ms: 80, metadata: meta('automatic', start + (reverse ? 0 : 10)) } };
}

test('both metrics must improve at least 20%; failures and incomplete work fail eligibility', () => {
  const { one, automatic } = pair(); assert.equal(comparePair(one, automatic).passed, true);
  assert.equal(comparePair(one, { ...automatic, ...fixture.cases.singleMetric }).passed, false);
  assert.equal(comparePair(one, { ...automatic, wholeBatchMs: 81 }).passed, false);
  for (const patch of [{ failed: 1 }, { incomplete: 1 }, { httpErrors: 1 }, { fullCohortAvailable: false }, { completionP95Ms: null }, { wholeBatchMs: 0 }, { attempted: 1 }]) assert.equal(comparePair(one, { ...automatic, ...patch }).passed, false);
  assert.throws(() => comparePair(one, automatic, .19));
});

test('explicitly rejects incompatible experiment, cohort, input, resource and window metadata', () => {
  const { one, automatic } = pair();
  for (const patch of [{ experimentId: 'other' }, { roundId: 'other' }, { inputFingerprint: 'other' }, { resourceFingerprint: 'other' }, { windowPolicy: 'other' }, { cohortId: one.metadata.cohortId }, { jobIds: one.metadata.jobIds }, { jobIds: [] }, { endedAt: '2026-01-01T00:00:21Z' }, { startedAt: one.metadata.startedAt, endedAt: one.metadata.endedAt }]) assert.throws(() => comparePair(one, { ...automatic, metadata: { ...automatic.metadata, ...patch } }));
  assert.throws(() => comparePair(one, { ...automatic, metadata: null }));
});

test('full benefit requires distinct comparable AB and BA rounds', () => {
  assert.equal(compareRounds([pair(), pair('r2', true)]).passed, true);
  assert.throws(() => compareRounds([pair()]));
  assert.throws(() => compareRounds([pair(), pair('r2')]));
  assert.throws(() => compareRounds([pair(), pair()]));
  const second = pair('r2', true); second.automatic.completionP95Ms = 90;
  assert.equal(compareRounds([pair(), second]).passed, false);
  second.one.metadata.resourceFingerprint = 'different';
  assert.throws(() => compareRounds([pair(), second]));
});
