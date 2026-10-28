import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { databaseQuery, type DatabaseSpan } from '../src/database-evidence.js';

// These tests check attribution metadata only, not an inferred SQL bottleneck.
type QueryPool = Parameters<typeof databaseQuery>[0];
async function capture(processID: unknown) {
  let span: DatabaseSpan | undefined, queries = 0, releases = 0;
  const client = Object.assign(new EventEmitter(), {
    processID,
    async query() { queries++; return { rows: [{ original: true }] }; },
    release() { releases++; },
  });
  const pool = { totalCount: 1, idleCount: 1, waitingCount: 0, connect: async () => client };
  const before = Date.now();
  const result = await databaseQuery(pool as unknown as QueryPool, 'existing_lookup', 'SELECT secret_column', ['secret-parameter'], {
    observe: value => { span = value; },
  });
  return { span: span as DatabaseSpan & { backendPid?: number | null; operationStartedAtUnixMs?: number }, result, queries, releases, before, after: Date.now() };
}

test('database evidence binds an observed backend PID without an extra SQL query', async () => {
  const r = await capture(24680);
  assert.equal(r.span.backendPid, 24680);
  assert.equal(r.queries, 1); assert.equal(r.releases, 1);
  assert.deepEqual(r.result, { rows: [{ original: true }] });
});

test('database evidence has an explicit wall-clock start separate from monotonic durations', async () => {
  const r = await capture(24680);
  assert(Number.isSafeInteger(r.span.operationStartedAtUnixMs));
  assert(r.span.operationStartedAtUnixMs! >= r.before && r.span.operationStartedAtUnixMs! <= r.after);
  assert(r.span.totalMs >= 0);
  assert(!JSON.stringify(r.span).includes('secret_column'));
  assert(!JSON.stringify(r.span).includes('secret-parameter'));
});

test('unavailable or invalid backend identities remain null instead of being invented', async () => {
  for (const pid of [undefined, null, 0, -1, 1.5, NaN, Infinity, '24680']) {
    const r = await capture(pid); assert.equal(r.span.backendPid, null);
  }
});
