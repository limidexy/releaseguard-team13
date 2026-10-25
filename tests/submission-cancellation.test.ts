import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { databaseQuery, SubmissionAbandonedError, type DatabaseSpan } from '../src/database-evidence.js';
import { unknownSubmission } from '../src/submission-state.js';

type QueryPool = Parameters<typeof databaseQuery>[0];
function poolDouble(query: () => unknown) {
  const client = Object.assign(new EventEmitter(), { query, release: (error?: Error) => released.push(error) });
  const released: (Error | undefined)[] = [];
  const pool = { totalCount: 1, idleCount: 0, waitingCount: 0, connect: async () => client };
  return { client, released, pool: pool as unknown as QueryPool };
}

test('abandonment before pool acquisition never borrows a client', async () => {
  let borrowed = 0;
  const pool = { totalCount: 0, idleCount: 0, waitingCount: 0, connect: async () => { borrowed++; throw new Error('unreachable'); } };
  await assert.rejects(databaseQuery(pool as QueryPool, 'existing_lookup', 'SELECT 1', [], { isAbandoned: () => true }), SubmissionAbandonedError);
  assert.equal(borrowed, 0);
});

test('abandonment while waiting for a client releases it without dispatching SQL', async () => {
  let abandoned = false, queries = 0, dispatches = 0, span: DatabaseSpan | undefined;
  const p = poolDouble(async () => { queries++; return { rows: [] }; });
  p.pool.connect = (async () => { abandoned = true; return p.client; }) as unknown as QueryPool['connect'];
  await assert.rejects(databaseQuery(p.pool, 'admission_atomic', 'never-dispatch', [], {
    isAbandoned: () => abandoned, onDispatch: () => { dispatches++; }, observe: value => { span = value; },
  }), SubmissionAbandonedError);
  assert.equal(queries, 0); assert.equal(dispatches, 0);
  assert.deepEqual(p.released, [undefined]);
  assert.equal(span?.outcome, 'cancelled_before_dispatch');
  assert.equal(span?.queryDispatchedMs, null);
  assert.equal(p.client.listenerCount('error'), 0);
});

test('pool acquisition failure is observed without pretending SQL was sent', async () => {
  const error = new Error('synthetic pool exhaustion');
  let span: DatabaseSpan | undefined;
  const p = poolDouble(() => { throw new Error('unreachable'); });
  p.pool.connect = (async () => { throw error; }) as QueryPool['connect'];
  await assert.rejects(databaseQuery(p.pool, 'existing_lookup', 'SELECT 1', [], { observe: value => { span = value; } }), error);
  assert.equal(span?.outcome, 'acquire_failed'); assert.equal(span?.queryDispatchedMs, null);
  assert.equal(p.released.length, 0);
});

test('database query failure evicts the borrowed client exactly once', async () => {
  const error = new Error('synthetic failed query');
  const p = poolDouble(async () => { throw error; });
  await assert.rejects(databaseQuery(p.pool, 'admission_atomic', 'synthetic', []), error);
  assert.deepEqual(p.released, [error]); assert.equal(p.client.listenerCount('error'), 0);
});

test('borrowed connection error rejects even when query has not resolved', async () => {
  const error = new Error('synthetic connection closed');
  const p = poolDouble(() => { queueMicrotask(() => p.client.emit('error', error)); return new Promise(() => {}); });
  await assert.rejects(databaseQuery(p.pool, 'admission_atomic', 'synthetic', []), error);
  assert.deepEqual(p.released, [error]); assert.equal(p.client.listenerCount('error'), 0);
});

test('cancellation after SQL dispatch does not turn an acknowledged commit into a retry', async () => {
  let abandoned = false, dispatches = 0, span: DatabaseSpan | undefined;
  const result = { rows: [{ job_id: 'synthetic-committed-job' }] };
  const p = poolDouble(async () => { abandoned = true; return result; });
  assert.equal(await databaseQuery(p.pool, 'admission_atomic', 'synthetic', [], {
    isAbandoned: () => abandoned, onDispatch: () => { dispatches++; }, observe: value => { span = value; },
  }), result);
  assert.equal(dispatches, 1); assert.equal(span?.outcome, 'completed');
  assert.deepEqual(p.released, [undefined]);
});

test('timing observers cannot replace an acknowledged query with an application failure', async () => {
  const result = { rows: [{ id: 'synthetic' }] }, p = poolDouble(async () => result);
  assert.equal(await databaseQuery(p.pool, 'admission_atomic', 'synthetic', [], {
    observe: () => { throw new Error('synthetic logging failure'); },
  }), result);
  assert.deepEqual(p.released, [undefined]);
});

test('database timing contains no SQL, values or credentials', async () => {
  let span: DatabaseSpan | undefined;
  const p = poolDouble(async () => ({ rows: [] }));
  await databaseQuery(p.pool, 'existing_lookup', 'SELECT private_column', ['private-value'], { observe: value => { span = value; } });
  assert.equal(span?.outcome, 'completed');
  const json = JSON.stringify(span);
  assert(!json.includes('private_column')); assert(!json.includes('private-value'));
  assert(span!.poolWaitMs! >= 0); assert(span!.databaseRoundTripMs! >= 0); assert(span!.releasedMs! >= 0);
});

test('unknown submission preserves a valid lookup key without authorizing an automatic retry', () => {
  const unknown = unknownSubmission('synthetic_key_123');
  assert.equal(unknown.submissionState, 'unknown');
  assert.equal(unknown.statusUrl, '/api/v2/jobs/submissions/synthetic_key_123');
  assert.equal(unknown.idempotencyKey, 'synthetic_key_123');
  assert.equal(unknown.doNotResubmit, true); assert.equal(unknown.automaticRetry, false);
  for (const key of [undefined, '', 'bad key', ['synthetic_key_123']]) {
    assert.equal(unknownSubmission(key).idempotencyKey, null);
    assert.equal(unknownSubmission(key).statusUrl, null);
  }
});
