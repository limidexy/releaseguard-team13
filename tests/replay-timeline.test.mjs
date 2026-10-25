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
