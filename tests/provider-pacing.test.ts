import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { ProviderStartGate } from '../src/provider-lifecycle.js';
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function clock(t: TestContext) {
  let now = 0; t.mock.method(performance, 'now', () => now);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  return { advance: async (ms: number) => { now += ms; t.mock.timers.tick(ms); await flush(); } };
}
test('concurrent starts are paced at actual monotonic starts, not request reservations', async t => {
  const c = clock(t), gate = new ProviderStartGate(), signal = new AbortController().signal, starts: number[] = [];
  const jobs = [0, 1, 2].map(() => gate.wait(signal).then(() => { starts.push(performance.now()); }));
  await flush(); assert.deepEqual(starts, [0]);
  await c.advance(19999); assert.deepEqual(starts, [0]);
  await c.advance(1); assert.deepEqual(starts, [0, 20000]);
  await c.advance(20000); await Promise.all(jobs); assert.deepEqual(starts, [0, 20000, 40000]);
});
test('cancelling a middle waiter cannot release later starts ahead of a live predecessor', async t => {
  const c = clock(t), gate = new ProviderStartGate(), live = new AbortController().signal, cancel = new AbortController();
  await gate.wait(live); const starts: string[] = [];
  const b = gate.wait(live).then(() => { starts.push('b'); });
  const rejected = assert.rejects(gate.wait(cancel.signal), { name: 'AbortError' });
  const d = gate.wait(live).then(() => { starts.push('d'); }); cancel.abort(); await rejected; await flush();
  await c.advance(20000); assert.deepEqual(starts, ['b']);
  await c.advance(20000); await Promise.all([b, d]); assert.deepEqual(starts, ['b', 'd']);
});
test('cancelled head waiters consume neither a future slot nor an outstanding timer', async t => {
  const c = clock(t), gate = new ProviderStartGate(), live = new AbortController().signal, cancel = new AbortController();
  await gate.wait(live); const stopped = assert.rejects(gate.wait(cancel.signal), { name: 'AbortError' });
  await flush(); await c.advance(10000); cancel.abort(); await stopped;
  let granted = false; const next = gate.wait(live).then(() => { granted = true; }); await flush();
  await c.advance(9999); assert.equal(granted, false);
  await c.advance(1); await next; assert.equal(granted, true);
});
test('local queue capacity is finite and aborted waiters relinquish capacity without bypassing spacing', async t => {
  const c = clock(t), gate = new ProviderStartGate(), live = new AbortController().signal;
  await gate.wait(live); const pending = Array.from({ length: 10 }, () => new AbortController());
  const rejected = pending.map(controller => assert.rejects(gate.wait(controller.signal), { name: 'AbortError' }));
  await assert.rejects(gate.wait(live), /local start queue full/);
  for (const controller of pending) controller.abort(); await Promise.all(rejected); await flush();
  let granted = false; const next = gate.wait(live).then(() => { granted = true; }); await flush();
  assert.equal(granted, false); await c.advance(20000); await next; assert.equal(granted, true);
});
