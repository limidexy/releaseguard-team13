import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { acceptanceProcess } from '../scripts/acceptance-process.mjs';
const env = { PATH: process.env.PATH, ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot } : {}) };
test('actual bounded child preserves stdout, stderr and exit23 rather than a launch failure', async () => {
  const r = await acceptanceProcess(process.execPath, ['-e', "process.stdout.write('owned out');process.stderr.write('owned err');process.exit(23)"], { env, timeout: 5000 });
  assert.equal(r.status, 23); assert.equal(r.stdout, 'owned out'); assert.equal(r.stderr, 'owned err'); assert.equal(r.error, undefined);
});
test('actual child spawn failure remains distinct from an executed rejection', async () => {
  const r = await acceptanceProcess('/definitely-not-an-owned-executable/absent', [], { env, timeout: 1000 });
  assert.equal(r.status, null); assert.equal(r.error.code, 'ENOENT');
});
test('actual excessive output is bounded and cannot be treated as a successful complete log', async () => {
  const r = await acceptanceProcess(process.execPath, ['-e', "process.stdout.write('x'.repeat(10000));setTimeout(()=>{},5000)"], { env, timeout: 1000, maxBuffer: 100 });
  assert.equal(r.error.code, 'ENOBUFS'); assert.equal(r.outputTruncated, true); assert.ok(Buffer.byteLength(r.stdout + r.stderr) <= 100);
});
for (const rootExits of [false, true]) test('owned POSIX process group prevents a late descendant write after ' + (rootExits ? 'root exit' : 'deadline'),
  { skip: process.platform === 'win32' ? 'Full acceptance uses POSIX groups; no Windows group guarantee' : false }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rg-acceptance-process-')), marker = join(dir, 'late-write'), ready = join(dir, 'ready');
    try {
      const grandchild = "require('node:fs').writeFileSync(" + JSON.stringify(ready) + ",'ready');setTimeout(()=>require('node:fs').writeFileSync(" + JSON.stringify(marker) + ",'forbidden'),1500);";
      const source = "const {spawn}=require('node:child_process');spawn(process.execPath,['-e'," + JSON.stringify(grandchild) + "],{stdio:'ignore'});" +
        (rootExits ? "const t=setInterval(()=>{if(require('node:fs').existsSync(" + JSON.stringify(ready) + "))clearInterval(t)},5);" : 'setTimeout(()=>{},5000);');
      const r = await acceptanceProcess(process.execPath, ['-e', source], { env, timeout: 1000 });
      assert.ok(['ETIMEDOUT', 'CHILDREN_UNKNOWN'].includes(r.error?.code), JSON.stringify(r));
      assert.equal(existsSync(ready), true, 'the owned descendant actually started; an early failed launch is not a passing test');
      await delay(1700); assert.equal(existsSync(marker), false, 'a child must not mutate after the orchestrator starts cleanup');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
test('invalid subprocess budget starts no child', async () => {
  const r = await acceptanceProcess(process.execPath, ['-e', "throw Error('must not run')"], { timeout: 0 });
  assert.equal(r.status, null); assert.equal(r.error.code, 'EINVAL'); assert.equal(r.stdout, '');
});
test('an already cancelled command is never started', async () => {
  const c = new AbortController(); c.abort();
  const r = await acceptanceProcess(process.execPath, ['-e', "process.stdout.write('must-not-run')"], { env, timeout: 1000, signal: c.signal });
  assert.equal(r.status, null); assert.equal(r.error?.code, 'ABORT_ERR'); assert.equal(r.stdout, '');
});
test('cancellation ends an owned running child instead of waiting out the original timeout', async () => {
  const c = new AbortController(), started = performance.now();
  const p = acceptanceProcess(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], { env, timeout: 5000, signal: c.signal });
  setTimeout(() => c.abort(), 100);
  const r = await p; assert.equal(r.error?.code, 'ABORT_ERR'); assert.ok(performance.now() - started < 2500);
});
