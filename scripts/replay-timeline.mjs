import assert from 'node:assert/strict';
import { timestamp } from './replay-metrics.mjs';

export function verifyTotals(sample) {
  // Preserve the broker contract: ready, unacknowledged and total must be actual counts.
  for (const key of ['messages_ready', 'messages_unacknowledged', 'messages']) assert(Number.isSafeInteger(sample[key]) && sample[key] >= 0, `Missing or invalid ${key}`);
  assert.equal(sample.messages, sample.messages_ready + sample.messages_unacknowledged, 'Queue total mismatch');
  assert.equal(sample.name, 'releaseguard.evaluate', 'Foreign queue');
  assert.equal(sample.vhost, 'releaseguard', 'Foreign vhost');
  return true;
}

export function intervalOverlap(intervals) {
  assert(intervals.length > 0, 'No observation intervals');
  const times = intervals.map(x => {
    const start = timestamp(x.startedAt), end = timestamp(x.endedAt);
    assert(end > start, 'Invalid observation interval');
    return { start, end };
  });
  const start = Math.max(...times.map(x => x.start)), end = Math.min(...times.map(x => x.end));
  return { overlaps: end > start, overlapMs: Math.max(0, end - start), startedAt: end > start ? new Date(start).toISOString() : null, endedAt: end > start ? new Date(end).toISOString() : null };
}

// No interpolation: only timestamped automatic recommendations and observed readiness count.
export function judgeScale(samples, rows, initialWorkerIds, cohortId) {
  assert(typeof cohortId === 'string' && cohortId, 'Missing cohort');
  assert(initialWorkerIds.length > 0 && new Set(initialWorkerIds).size === initialWorkerIds.length, 'Invalid initial workers');
  assert.equal(new Set(rows.map(r => r.id)).size, rows.length, 'Duplicate job row');
  assert(rows.every(r => r.cohortId === cohortId && r.source === 'replay'), 'Foreign or non-replay work');
  let previous = -Infinity;
  for (const s of samples) {
    assert.equal(s.cohortId, cohortId, 'Foreign sample');
    const at = timestamp(s.at);
    assert(at > previous, 'Samples must be strictly chronological'); previous = at;
    assert(Array.isArray(s.workers), 'Missing worker observations');
    assert.equal(new Set(s.workers.map(w => w.id)).size, s.workers.length, 'Duplicate worker');
    assert(s.workers.every(w => typeof w.id === 'string' && typeof w.ready === 'boolean'), 'Invalid worker observation');
    assert.equal(s.ready, s.workers.filter(w => w.ready).length, 'Ready count mismatch');
    assert(Number.isSafeInteger(s.desired) && s.desired >= 0, 'Invalid desired replicas');
    if (s.hpa != null) assert(Number.isSafeInteger(s.hpa.desiredReplicas) && s.hpa.desiredReplicas >= 0, 'Invalid recommendation');
    if (s.queue != null) verifyTotals(s.queue);
  }
  const initial = new Set(initialWorkerIds);
  const initialWorkersObserved = samples.length > 0 && samples[0].ready === initial.size &&
    initialWorkerIds.every(id => samples[0].workers.some(w => w.id === id && w.ready));
  const firstReady = new Map();
  for (const s of samples) for (const w of s.workers) {
    if (w.ready && !firstReady.has(w.id)) firstReady.set(w.id, timestamp(s.at));
  }
  const readyIds = [...firstReady.keys()];
  const newIds = readyIds.filter(id => !initial.has(id));
  const recommendation = samples.find(s => s.controller === 'automatic' && s.hpa?.desiredReplicas > initial.size && s.desired > initial.size);
  const recommendationAt = recommendation ? timestamp(recommendation.at) : null;
  // First-observed Ready is evidence, not an inferred transition time. A worker
  // already Ready before (or in the same sample as) a recommendation cannot
  // establish recommendation -> Ready order by appearing again later.
  const readinessOrdered = !!recommendation && newIds.length > 0 &&
    newIds.every(id => firstReady.get(id) > recommendationAt);
  const readySample = readinessOrdered && samples.find(s => s.controller === 'automatic' && timestamp(s.at) > recommendationAt && s.ready > initial.size && s.workers.some(w => w.ready && newIds.includes(w.id)));
  const counts = Object.fromEntries(readyIds.map(id => [id, 0]));
  const lastWork = [];
  for (const r of rows) {
    if (!['succeeded', 'failed'].includes(r.status)) continue;
    const start = timestamp(r.startedAt), finish = timestamp(r.finishedAt);
    assert(finish >= start, 'Invalid processing interval');
    const latest = samples.findLast(s => timestamp(s.at) <= start);
    const ready = latest?.controller === 'automatic' && latest.workers.some(w => w.id === r.workerId && w.ready);
    if (ready && recommendation && timestamp(latest.at) >= timestamp(recommendation.at)) {
      counts[r.workerId]++; if (newIds.includes(r.workerId)) lastWork.push(finish);
    }
  }
  const newWorkersProcessed = newIds.length > 0 && newIds.every(id => counts[id] > 0);
  const down = readySample && samples.find(s => timestamp(s.at) > timestamp(readySample.at) && timestamp(s.at) >= Math.max(-Infinity, ...lastWork) && s.controller === 'automatic' && s.ready === initial.size && s.desired === initial.size && s.hpa?.desiredReplicas === initial.size);
  const automaticOnly = samples.length > 0 && samples.every(s => s.controller === 'automatic');
  return {
    requested: !!recommendation, becameReady: !!readySample, initialWorkersObserved, readinessOrdered,
    firstObservedReadyAt: Object.fromEntries([...firstReady].map(([id, at]) => [id, new Date(at).toISOString()])),
    newWorkerIds: newIds, perObservedReadyWorker: counts, newWorkersProcessed, returnedToInitial: !!down,
    automaticOnly, evidenceStatus: samples.length ? 'OBSERVED_ONLY' : 'UNAVAILABLE',
    passed: automaticOnly && initialWorkersObserved && !!recommendation && readinessOrdered && !!readySample && newWorkersProcessed && !!down,
  };
}
