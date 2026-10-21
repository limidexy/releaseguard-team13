import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CircuitBreaker, MemoryCircuitStore, CircuitOpenError} from '../src/circuit-breaker.js';

test('shared breaker opens, skips transport, admits one probe and recovers', async () => {
  let now=1000, calls=0;
  const store=new MemoryCircuitStore(()=>now);
  const a=new CircuitBreaker(store,{threshold:2,cooldownMs:100,probeLeaseMs:50});
  const b=new CircuitBreaker(store,{threshold:2,cooldownMs:100,probeLeaseMs:50});
  const fail=async()=>{calls++;throw new Error('Provider HTTP 503');};
  await assert.rejects(a.run('quota',fail)); await assert.rejects(b.run('quota',fail));
  await assert.rejects(a.run('quota',fail),CircuitOpenError); assert.equal(calls,2);
  now+=101;
  let resolve!:()=>void;
  const probe=a.run('quota',()=>new Promise<void>(r=>{calls++;resolve=r;}));
  await new Promise(r=>setImmediate(r));
  await assert.rejects(b.run('quota',fail),CircuitOpenError);
  resolve(); await probe;
  assert.equal(await b.run('quota',async()=>{calls++;return 'healthy';}),'healthy');
  assert.equal(calls,4);
});
test('late successful closed requests cannot close an already opened breaker', async()=>{
  const store=new MemoryCircuitStore(()=>1000), c=new CircuitBreaker(store,{threshold:1,cooldownMs:100,probeLeaseMs:50});
  let resolve!:()=>void;
  const earlier=c.run('key',()=>new Promise<void>(r=>{resolve=r;}));
  await new Promise(r=>setImmediate(r));
  await assert.rejects(c.run('key',async()=>{throw new Error('Provider HTTP 429');}));
  resolve();await earlier;
  await assert.rejects(c.run('key',async()=>1),CircuitOpenError);
});
test('probe failure or expired probe lease reopens; caller errors do not trip',async()=>{
  let now=0;const store=new MemoryCircuitStore(()=>now), c=new CircuitBreaker(store,{threshold:1,cooldownMs:100,probeLeaseMs:50});
  await assert.rejects(c.run('k',async()=>{throw new Error('Provider HTTP 400');}));
  assert.equal(await c.run('k',async()=>1),1);
  await assert.rejects(c.run('k',async()=>{throw new Error('Provider HTTP 503');}));
  now=101;
  await assert.rejects(c.run('k',async()=>{throw new Error('Provider HTTP 503');}));
  await assert.rejects(c.run('k',async()=>1),CircuitOpenError);
  now=202;
  let resolve!:()=>void;const pending=c.run('k',()=>new Promise<void>(r=>{resolve=r;}));
  await new Promise(r=>setImmediate(r));now+=51;
  await assert.rejects(c.run('k',async()=>1),CircuitOpenError);
  resolve();await pending;
  await assert.rejects(c.run('k',async()=>1),CircuitOpenError);
});
test('breaker state-store failure is fail closed and never calls provider',async()=>{
  const c=new CircuitBreaker({mutate:async()=>{throw new Error('db down');}},{threshold:1,cooldownMs:100,probeLeaseMs:50});
  let calls=0;await assert.rejects(c.run('key',async()=>{calls++;}));assert.equal(calls,0);
});
