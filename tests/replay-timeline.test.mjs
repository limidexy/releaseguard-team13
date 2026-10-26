import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyTotals, intervalOverlap, judgeScale } from '../scripts/replay-timeline.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/replay-metrics.synthetic.json', import.meta.url), 'utf8'));
const judge = (samples = fixture.scaleSamples, rows = fixture.rows) => judgeScale(samples, rows, ['worker-1'], 'synthetic');

test('queue zero is valid; NULL, omitted, fractional, negative and inconsistent totals fail', () => {
  assert.equal(verifyTotals(fixture.cases.queueZero), true);
  const base = fixture.cases.queueZero;
  assert.equal(verifyTotals({ ...base, messages_ready: 2, messages_unacknowledged: 3, messages: 5 }), true);
  for (const patch of [{ messages_ready: null }, { messages_unacknowledged: undefined }, { messages_ready: -1 }, { messages_ready: .5 }, { messages: 1 }, { name: 'foreign' }, { vhost: 'foreign' }]) assert.throws(() => verifyTotals({ ...base, ...patch }));
});

test('actual interval intersection only; touching or separated observations are not synchronous', () => {
  const interval = (start, end) => ({ startedAt: `2026-01-01T00:00:0${start}Z`, endedAt: `2026-01-01T00:00:0${end}Z` });
  const inputs = [interval(0, 4), interval(2, 6), interval(3, 5)];
  const before = structuredClone(inputs);
  assert.deepEqual(intervalOverlap(inputs), { overlaps: true, overlapMs: 1000, startedAt: '2026-01-01T00:00:03.000Z', endedAt: '2026-01-01T00:00:04.000Z' });
  assert.deepEqual(inputs, before);
  assert.equal(intervalOverlap([interval(0, 2), interval(2, 4)]).overlaps, false);
  assert.equal(intervalOverlap([interval(0, 1), interval(3, 4)]).overlapMs, 0);
  assert.throws(() => intervalOverlap([])); assert.throws(() => intervalOverlap([interval(4, 2)]));
});

test('automatic recommendation followed by Ready, processing and scale back passes', () => {
  const s = judge(); assert.equal(s.passed, true); assert.equal(s.newWorkersProcessed, true);
  assert.deepEqual(s.newWorkerIds, ['worker-2']); assert.equal(s.perObservedReadyWorker['worker-2'], 1);
});

test('new ready worker with zero processing, only scaling up, and manual scaling never pass', () => {
  const zero = judge(fixture.scaleSamples, fixture.rows.slice(0, 1));
  assert.equal(zero.perObservedReadyWorker['worker-2'], 0); assert.equal(zero.passed, false);
  const up = judge(fixture.scaleSamples.slice(0, 2)); assert.equal(up.returnedToInitial, false); assert.equal(up.passed, false);
  const manual = fixture.scaleSamples.map(s => ({ ...s, controller: fixture.cases.manualController }));
  assert.equal(judge(manual).requested, false); assert.equal(judge(manual).passed, false);
  const mixed = structuredClone(fixture.scaleSamples); mixed[1].controller = 'manual';
  assert.equal(judge(mixed).passed, false);
  assert.equal(judge([], []).evidenceStatus, 'UNAVAILABLE');
});

test('processing before Ready and unfinished jobs cannot establish new-worker processing', () => {
  const rows = structuredClone(fixture.rows); rows[1].startedAt = '2026-01-01T00:00:01Z';
  assert.equal(judge(fixture.scaleSamples, rows).newWorkersProcessed, false);
  rows[1].status = fixture.cases.unfinishedStatus;
  assert.equal(judge(fixture.scaleSamples, rows).passed, false);
  const samples = structuredClone(fixture.scaleSamples); samples[0].hpa = null;
  // A later recommendation cannot explain work that already started.
  samples[1].at = '2026-01-01T00:00:04Z'; rows[1] = fixture.rows[1];
  assert.equal(judge(samples, rows).passed, false);
});

test('rejects reordered timestamps, cohort leakage and inconsistent Ready observations', () => {
  assert.throws(() => judge([...fixture.scaleSamples].reverse()));
  for (const patch of [{ cohortId: 'foreign' }, { ready: 9 }, { at: null }, { queue: { ready: 1, unack: 0 } }]) {
    const samples = structuredClone(fixture.scaleSamples); Object.assign(samples[0], patch);
    assert.throws(() => judge(samples));
  }
  assert.throws(() => judge(fixture.scaleSamples, [{ ...fixture.rows[0], cohortId: 'foreign' }]));
  assert.throws(() => judge(fixture.scaleSamples, [fixture.rows[0], fixture.rows[0]]));
});

test('a worker already Ready in the first sample is not proof of later automatic scale-out', () => {
  const samples = structuredClone(fixture.scaleSamples);
  samples[0].desired = 1; samples[0].hpa.desiredReplicas = 1;
  samples[0].workers = structuredClone(samples[1].workers); samples[0].ready = 2;
  const result = judge(samples);
  assert.equal(result.passed, false);
  assert.equal(result.becameReady, false);
  assert.equal(result.perObservedReadyWorker['worker-2'], 1, 'preserve observed processing even when scale evidence is rejected');
  assert.equal(result.initialWorkersObserved, false);
  assert.equal(result.firstObservedReadyAt['worker-2'], '2026-01-01T00:00:00.000Z');
});

test('first Ready before the recommendation is rejected even with a consistent initial snapshot', () => {
  const samples = structuredClone(fixture.scaleSamples);
  samples[0].desired = 1; samples[0].hpa.desiredReplicas = 1;
  samples.splice(1, 0, { ...structuredClone(samples[1]), at: '2026-01-01T00:00:01Z', desired: 1, hpa: { desiredReplicas: 1 } });
  const result = judge(samples);
  assert.equal(result.requested, true);
  assert.equal(result.becameReady, false);
  assert.equal(result.passed, false);
});

test('Ready and recommendation first observed together do not establish their temporal order', () => {
  const samples = structuredClone(fixture.scaleSamples);
  samples[0].desired = 1; samples[0].hpa.desiredReplicas = 1;
  const result = judge(samples);
  assert.equal(result.requested, true);
  assert.equal(result.becameReady, false);
  assert.equal(result.passed, false);
});

test('a pre-existing Ready worker cannot become new evidence by disappearing and reappearing', () => {
  const samples = structuredClone(fixture.scaleSamples);
  samples[0].desired = 1; samples[0].hpa.desiredReplicas = 1;
  samples.splice(1, 0, { ...structuredClone(samples[1]), at: '2026-01-01T00:00:01Z', desired: 1, hpa: { desiredReplicas: 1 } });
  const afterRecommendation = structuredClone(samples[2]); afterRecommendation.at = '2026-01-01T00:00:02.500Z';
  samples[2].workers[1].ready = false; samples[2].ready = 1;
  samples.splice(3, 0, afterRecommendation);
  const result = judge(samples);
  assert.equal(result.becameReady, false);
  assert.equal(result.passed, false);
});

test('matching replica count with a different declared initial identity is not a verified baseline', () => {
  const result = judgeScale(fixture.scaleSamples, fixture.rows, ['not-observed-initial-worker'], 'synthetic');
  assert.equal(result.passed, false);
});

test('the original ordered positive witness still passes without modifying any supplied evidence', () => {
  const samples = structuredClone(fixture.scaleSamples), rows = structuredClone(fixture.rows);
  const before = structuredClone({ samples, rows });
  const result = judge(samples, rows);
  assert.equal(result.passed, true);
  assert.equal(result.perObservedReadyWorker['worker-1'], 1);
  assert.equal(result.perObservedReadyWorker['worker-2'], 1);
  assert.equal(result.initialWorkersObserved, true);
  assert.equal(result.readinessOrdered, true);
  assert.equal(result.firstObservedReadyAt['worker-2'], '2026-01-01T00:00:02.000Z');
  assert.deepEqual({ samples, rows }, before);
});

test('an unobserved initial Ready baseline cannot be assumed from the declared worker count', () => {
  const samples = structuredClone(fixture.scaleSamples), rows = structuredClone(fixture.rows);
  samples[0].workers = []; samples[0].ready = 0;
  rows[0].startedAt = '2026-01-01T00:00:03Z'; rows[0].finishedAt = '2026-01-01T00:00:04Z';
  const result = judge(samples, rows);
  assert.equal(result.passed, false);
  assert.equal(result.initialWorkersObserved, false);
  assert.equal(result.readinessOrdered, true, 'ordered new readiness cannot repair a missing initial baseline');
});
