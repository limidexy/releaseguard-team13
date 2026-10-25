import assert from 'node:assert/strict';

// Pure offline functions. Times are server ISO timestamps; intervals are [start, end).
export function p95(values) {
  assert(values.every(x => Number.isFinite(x) && x >= 0), 'Invalid latency observation');
  return values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1] : null;
}

export function timestamp(value) {
  assert.equal(typeof value, 'string', 'Missing timestamp');
  const time = Date.parse(value);
  assert(Number.isFinite(time), 'Invalid timestamp');
  return time;
}

export function summarize(rows, responses, window, readyWorkers = []) {
  const begin = timestamp(window.startedAt), end = timestamp(window.endedAt);
  assert(end > begin, 'Invalid fixed window');
  assert.equal(new Set(rows.map(x => x.id)).size, rows.length, 'Duplicate job row');
  assert(responses.every(x => typeof x.requestId === 'string' && x.requestId), 'Missing request ID');
  assert.equal(new Set(responses.map(x => x.requestId)).size, responses.length, 'Duplicate request');
  const expected = new Set(responses.filter(x => x.id != null).map(x => x.id));
  assert.equal(expected.size, responses.filter(x => x.id != null).length, 'Duplicate submitted job ID');
  assert(rows.every(x => expected.has(x.id)), 'Foreign cohort row');
  assert(responses.every(x => x.status !== 202 || x.id), '202 missing job ID');
  assert(responses.every(x => x.status === null || (Number.isInteger(x.status) && x.status >= 100 && x.status <= 599)), 'Invalid HTTP status');
  const httpStatusCounts = {};
  for (const r of responses) httpStatusCounts[r.status ?? 'unknown'] = (httpStatusCounts[r.status ?? 'unknown'] ?? 0) + 1;
  const workers = Object.fromEntries(readyWorkers.map(id => [id, 0]));
  const queue = [], service = [], lifecycle = [], outboxDeltas = [];
  let successful = 0, failed = 0, unfinished = 0, unknown = 0, inWindow = 0, last = begin;
  for (const r of rows) {
    assert(r.id, 'Missing job ID');
    assert.equal(r.source, 'replay');
    assert.equal(r.provenanceSource, 'replay');
    assert.equal(r.provenanceTrust, 'labelled_static_fixture');
    assert.equal(r.providerCalls, 0);
    assert.equal(r.attempts, 1);
    const created = timestamp(r.createdAt);
    const delta = r.sentAt == null ? null : timestamp(r.sentAt) - created;
    outboxDeltas.push({ id: r.id, deltaMs: delta });
    if (!['succeeded', 'failed'].includes(r.status)) {
      if (['queued', 'running', 'pending'].includes(r.status)) unfinished++;
      else unknown++;
      continue;
    }
    const started = timestamp(r.startedAt), finished = timestamp(r.finishedAt);
    assert(created <= started && started <= finished && created >= begin, 'Invalid lifecycle timestamps');
    assert(r.workerId, 'Terminal row missing worker');
    workers[r.workerId] = (workers[r.workerId] ?? 0) + 1;
    queue.push(started - created); service.push(finished - started); lifecycle.push(finished - created);
    last = Math.max(last, finished);
    if (r.status === 'failed') failed++;
    else { successful++; if (finished >= begin && finished < end) inWindow++; }
  }
  const missing = expected.size - rows.length;
  const dbUnassociatedRequests = responses.length - expected.size;
  const complete = responses.length > 0 && expected.size === responses.length && !missing && !unfinished && !unknown;
  const httpErrors = responses.filter(x => x.status !== 202).length;
  // A subset's p95 is labelled observed; never presented as the whole request cohort.
  const completionP95Ms = complete ? p95(lifecycle) : null;
  const wholeBatchMs = complete && last > begin ? last - begin : null;
  return {
    attempted: responses.length, accepted: httpStatusCounts[202] ?? 0, httpStatusCounts, httpErrors,
    dbObserved: rows.length, successful, failed, unfinished, unknown, missing,
    dbUnassociatedRequests, incomplete: unfinished + unknown + missing + dbUnassociatedRequests,
    httpErrorsWithDbTerminal: responses.filter(x => x.status !== 202 && rows.some(r => r.id === x.id && ['succeeded', 'failed'].includes(r.status))).length,
    actualWindowSeconds: (end - begin) / 1000, completionsWithinWindow: inWindow,
    windowJobsPerSecond: inWindow * 1000 / (end - begin),
    cohortIncludingDrainJobsPerSecond: complete ? successful * 1000 / (Math.max(end, last) - begin) : null,
    wholeBatchMs, completionP95Ms, fullCohortAvailable: complete,
    observedTerminalLifecycleP95Ms: p95(lifecycle), latencyDenominator: lifecycle.length,
    queueP95Ms: p95(queue), serviceP95Ms: p95(service),
    submissionP95Ms: responses.every(x => x.elapsedMs != null) ? p95(responses.map(x => x.elapsedMs)) : null,
    outboxDispatchP95Ms: null, outboxMetricStatus: 'UNAVAILABLE_AS_EXACT_DISPATCH_WALL_CLOCK',
    outboxDeltas, outboxTimestampAnomalies: outboxDeltas.filter(x => x.deltaMs === null || x.deltaMs < 0),
    perWorker: workers, workersWithJobs: Object.values(workers).filter(x => x > 0).length,
    allObservedReadyWorkersProcessed: Object.keys(workers).length > 0 && Object.values(workers).every(x => x > 0),
  };
}

// Fingerprints describe ordered input and controlled resources (excluding replica count).
// Distinct cohorts identify each arm; experimentId/roundId identify the paired trial.
export function comparePair(one, automatic, fraction = .20) {
  assert(Number.isFinite(fraction) && fraction >= .20 && fraction < 1, 'Minimum improvement is 20%');
  const a = one.metadata, b = automatic.metadata;
  assert(a && b, 'Missing comparison metadata');
  for (const key of ['experimentId', 'roundId', 'inputFingerprint', 'resourceFingerprint', 'windowPolicy']) {
    assert(typeof a[key] === 'string' && a[key], `Missing ${key}`);
    assert.equal(a[key], b[key], `Incomparable ${key}`);
  }
  assert.equal(a.mode, 'one'); assert.equal(b.mode, 'automatic');
  assert(a.cohortId && b.cohortId && a.cohortId !== b.cohortId, 'Arms require distinct cohorts');
  for (const m of [a, b]) {
    assert(Array.isArray(m.jobIds) && m.jobIds.length > 0, 'Missing cohort membership');
    assert.equal(new Set(m.jobIds).size, m.jobIds.length, 'Duplicate cohort member');
    assert(m.jobIds.every(id => typeof id === 'string' && id), 'Invalid cohort member');
  }
  assert.equal(a.jobIds.length, b.jobIds.length, 'Different cohort sizes');
  assert(a.jobIds.every(id => !b.jobIds.includes(id)), 'Overlapping cohorts');
  const as = timestamp(a.startedAt), ae = timestamp(a.endedAt), bs = timestamp(b.startedAt), be = timestamp(b.endedAt);
  assert(ae > as && be > bs && ae - as === be - bs, 'Incomparable windows');
  assert(ae <= bs || be <= as, 'Overlapping experiment windows');
  const valid = (x, m) => x.fullCohortAvailable === true && x.attempted === m.jobIds.length && x.failed === 0 && x.incomplete === 0 && x.httpErrors === 0 && x.accepted > 0 && x.accepted === x.successful && Number.isFinite(x.wholeBatchMs) && x.wholeBatchMs > 0 && Number.isFinite(x.completionP95Ms) && x.completionP95Ms > 0;
  const eligible = valid(one, a) && valid(automatic, b);
  return {
    order: as < bs ? 'AB' : 'BA', minimumFraction: fraction,
    wholeBatchImprovement: eligible ? 1 - automatic.wholeBatchMs / one.wholeBatchMs : null,
    p95Improvement: eligible ? 1 - automatic.completionP95Ms / one.completionP95Ms : null,
    passed: eligible && automatic.wholeBatchMs <= one.wholeBatchMs * (1 - fraction) && automatic.completionP95Ms <= one.completionP95Ms * (1 - fraction),
  };
}

export function compareRounds(rounds, fraction = .20) {
  assert.equal(rounds.length, 2, 'Two AB/BA rounds required');
  const [a, b] = rounds;
  assert.equal(a.one.metadata.experimentId, b.one.metadata.experimentId, 'Different experiments');
  assert.notEqual(a.one.metadata.roundId, b.one.metadata.roundId, 'Duplicate round');
  const all = rounds.flatMap(r => [r.one.metadata, r.automatic.metadata]);
  assert.equal(new Set(all.map(m => m.cohortId)).size, 4, 'Reused cohort');
  assert(all.every(m => m.jobIds.length === all[0].jobIds.length), 'Different cohort sizes across rounds');
  const ids = all.flatMap(m => m.jobIds);
  assert.equal(new Set(ids).size, ids.length, 'Reused jobs across rounds');
  for (const m of all) for (const key of ['inputFingerprint', 'resourceFingerprint', 'windowPolicy']) assert.equal(m[key], all[0][key], `Different ${key} across rounds`);
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    assert(timestamp(all[i].endedAt) <= timestamp(all[j].startedAt) || timestamp(all[j].endedAt) <= timestamp(all[i].startedAt), 'Overlapping rounds');
    assert.equal(timestamp(all[i].endedAt) - timestamp(all[i].startedAt), timestamp(all[j].endedAt) - timestamp(all[j].startedAt), 'Different windows across rounds');
  }
  const results = rounds.map(r => comparePair(r.one, r.automatic, fraction));
  assert.equal(new Set(results.map(r => r.order)).size, 2, 'Both AB and BA required');
  return { rounds: results, passed: results.every(r => r.passed) };
}
