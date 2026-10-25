import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { admitAtomic, type Admission } from '../src/admission-atomic.js';

type AdmissionPool = Parameters<typeof admitAtomic>[0];
const admission: Admission = {
  rateKey: 'workspace:principal:1234', limit: 2000,
  id: '11111111-1111-4111-8111-111111111111', outboxId: '22222222-2222-4222-8222-222222222222',
  workspace: 'synthetic-workspace', principal: 'synthetic-principal', hash: 'synthetic-hash',
  key: 'synthetic-key', input: { candidate: 'test' }, snapshot: { application: {}, suite: {} },
};
function poolDouble(rows: unknown[]) {
  const queries: { text: string; values: unknown[] }[] = [];
  const client = Object.assign(new EventEmitter(), {
    query: async (text: string, values: unknown[]) => { queries.push({ text, values }); return { rows }; },
    release() {},
  });
  return { queries, pool: { totalCount: 1, idleCount: 0, waitingCount: 0, connect: async () => client } as unknown as AdmissionPool };
}

test('atomic admission binds the configured limit, identity, idempotency key, job and outbox together', async () => {
  const p = poolDouble([{ job_id: admission.id }]);
  assert.equal(await admitAtomic(p.pool, admission), true);
  assert.equal(p.queries.length, 1);
  assert.deepEqual(p.queries[0].values, [
    admission.rateKey, 2000, admission.id, admission.workspace, admission.principal,
    admission.hash, admission.key, admission.input, admission.snapshot, admission.outboxId,
  ]);
});

test('a rejected reservation reports false and dispatches no follow-up job write', async () => {
  const p = poolDouble([]);
  assert.equal(await admitAtomic(p.pool, admission), false);
  assert.equal(p.queries.length, 1);
});

test('invalid admission limits fail before pool acquisition', async () => {
  const p = poolDouble([]);
  for (const limit of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(admitAtomic(p.pool, { ...admission, limit }), /Invalid admission limit/);
  }
  assert.equal(p.queries.length, 0);
});

test('a zero admission limit stops new jobs without borrowing a database connection', async () => {
  const p = poolDouble([]);
  let borrowed = 0, dispatched = 0;
  p.pool.connect = (async () => { borrowed++; throw new Error('unreachable'); }) as AdmissionPool['connect'];
  assert.equal(await admitAtomic(p.pool, { ...admission, limit: 0 }, { onDispatch: () => { dispatched++; } }), false);
  assert.equal(borrowed, 0); assert.equal(dispatched, 0); assert.equal(p.queries.length, 0);
});
