import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import Fastify from 'fastify';
import amqp from 'amqplib';
const secret = 'synthetic-worker-lifecycle-secret-not-real';
Object.assign(process.env, { AUTH_MODE: 'dev', ALLOW_DEV_AUTH: 'true', AUTH_SECRET: secret, INTERNAL_SECRET: secret, SERVICE_ROLE: 'worker', RUNNER_ORIGINS: 'http://synthetic-runner.invalid' });
const common = await import('../src/common.js');
const { worker } = await import('../src/worker.js');
const jobId = '00000000-0000-4000-8000-000000000001';
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
async function harness(t: TestContext, source: 'real' | 'replay', attempts = 1) {
  const saved: any = { status: 'running' }, logs: string[] = [];
  const app = Fastify({ logger: { level: 'error', stream: { write: (line: string) => { logs.push(line); } } } });
  const c = { id: 'receipt', name: 'Synthetic', prompt: 'Synthetic', rule: 'contains', expected: 'receipt', critical: true };
  const job = { id: jobId, attempts, input: { source, promptVersion: 'v1', scenario: 'passing' }, snapshot: { application: { data: { runnerUrl: 'http://synthetic-runner.invalid/execute' } }, suite: { data: { cases: [c], policy: { minScore: 95, maxLatencyMs: null } } } } };
  let consume!: (msg: any) => Promise<void>, acknowledged = 0;
  const channel = { assertQueue: async () => {}, prefetch: async () => {}, consume: async (_name: string, fn: typeof consume) => { consume = fn; }, ack: () => { acknowledged++; } };
  const connection = Object.assign(new EventEmitter(), { createConfirmChannel: async () => channel });
  t.mock.method(amqp, 'connect', async () => connection as any);
  t.mock.method(common.pool, 'query', (async (sql: string, values: any[] = []) => {
    if (sql.includes('RETURNING *')) return { rows: [job] };
    if (sql.includes("SET status='succeeded'")) { saved.status = 'succeeded'; saved.result = values[2]; saved.execution = values[3]; }
    else if (sql.includes("SET status='failed'")) { saved.status = 'failed'; saved.error = values[2]; }
    else if (sql.includes('SET error=')) saved.error = values[2];
    else assert.match(sql, /^CREATE TABLE|UPDATE jobs SET lease_until/);
    return { rows: [] };
  }) as any);
  await worker(app);
  return { app, saved, logs, job, acknowledged: () => acknowledged, run: () => consume({ content: Buffer.from(JSON.stringify({ jobId })) }) };
}
test('a recovered real task never dispatches a second runner request, while replay keeps its bounded recovery', async t => {
  for (const source of ['real', 'replay'] as const) {
    await t.test(source, async sub => {
      let calls = 0; sub.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ outputs: [{ caseId: 'receipt', output: 'receipt' }], provenance: { source, trust: 'synthetic-no-provider' } }); });
      const h = await harness(sub, source, 2);
      try { await h.run(); assert.equal(calls, source === 'real' ? 0 : 1); assert.equal(h.saved.status, source === 'real' ? 'failed' : 'succeeded'); assert.equal(h.acknowledged(), 1); }
      finally { await h.app.close(); }
    });
  }
});
test('an unknown real-runner failure becomes terminal, is redacted and cannot silently enter the retry sweep', async t => {
  let calls = 0; t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('PRIVATE-RUNNER-DETAIL https://name:password@synthetic.invalid'); });
  const h = await harness(t, 'real');
  try {
    await h.run(); assert.equal(calls, 1); assert.equal(h.saved.status, 'failed'); assert.match(h.saved.error, /unconfirmed|no automatic retry/);
    assert.ok(!JSON.stringify(h.saved).includes('PRIVATE-RUNNER')); assert.ok(!h.logs.join('').includes('password@'));
    assert.equal(h.saved.result, undefined); assert.equal(h.acknowledged(), 1);
  } finally { await h.app.close(); }
});
test('a real runner can outlive120s but is aborted by450s and never replayed', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const controllers: AbortController[] = [];
  t.mock.method(AbortSignal, 'timeout', (milliseconds: number) => {
    const controller = new AbortController(); controllers.push(controller); setTimeout(() => controller.abort(new DOMException('Synthetic timeout', 'TimeoutError')), milliseconds); return controller.signal;
  });
  let started!: () => void;
  const dispatched = new Promise<void>(resolve => { started = resolve; });
  let calls = 0; t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    calls++; started(); return new Promise<Response>((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true }));
  });
  const h = await harness(t, 'real'); let finished = false;
  const running = h.run().then(() => { finished = true; });
  try {
    // JWT signing is real async crypto: wait for actual dispatch, not a guessed
    // number of promise turns. No mock may be restored while work is in flight.
    await Promise.race([dispatched, running.then(() => { throw Error('Runner ended before synthetic dispatch'); })]); assert.equal(calls, 1);
    t.mock.timers.tick(120000); await flush(); assert.equal(finished, false);
    t.mock.timers.tick(329999); await flush(); assert.equal(finished, false);
    t.mock.timers.tick(1); await running; assert.equal(finished, true); assert.equal(h.saved.status, 'failed'); assert.equal(calls, 1);
  } finally { for (const controller of controllers) controller.abort(); await running; await h.app.close(); }
});
