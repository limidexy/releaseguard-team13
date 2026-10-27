import test from 'node:test';
import assert from 'node:assert/strict';
import {backupProcess} from '../scripts/backup-process.mjs';
const opts={cwd:process.cwd(),env:{PATH:process.env.PATH},timeout:3000,maxBuffer:1024*1024};
test('binary backup input/output preserves every byte, including invalid UTF8 and NUL',async()=>{
 const input=Buffer.from(Array.from({length:4096},(_,i)=>i%256));const r=await backupProcess(process.execPath,['-e','process.stdin.on("data",b=>process.stdout.write(b));'],{...opts,input});
 assert.equal(r.status,0);assert.equal(r.error,undefined);assert.ok(Buffer.isBuffer(r.stdout));assert.deepEqual(r.stdout,input);assert.equal(r.spawnEntered,true);assert.equal(r.outputTruncated,false);
});
test('no-input output and stderr retain separate byte buffers',async()=>{
 const r=await backupProcess(process.execPath,['-e','process.stdout.write(Buffer.from([0,255,195]));process.stderr.write(Buffer.from([254,0]));'],opts);assert.equal(r.status,0);assert.deepEqual([...r.stdout],[0,255,195]);assert.deepEqual([...r.stderr],[254,0]);
});
test('invalid limits or aborted signal never enters spawn',async()=>{
 for(const bad of [{timeout:0},{maxBuffer:0},{input:'text is not a dump'},{maxBuffer:67*1024*1024}])assert.equal((await backupProcess(process.execPath,[],{...opts,...bad})).spawnEntered,false);
 const c=new AbortController();c.abort();assert.equal((await backupProcess(process.execPath,[],{...opts,signal:c.signal})).spawnEntered,false);
});
test('nonzero child result retains exact output without a successful outcome or retry',async()=>{
 const r=await backupProcess(process.execPath,['-e','process.stdout.write(Buffer.from([255,0]));process.exitCode=7;'],opts);assert.equal(r.status,7);assert.deepEqual([...r.stdout],[255,0]);
});
test('overflow retains bounded original bytes and fails the owned process boundary',async()=>{
 const r=await backupProcess(process.execPath,['-e','process.stdout.write(Buffer.alloc(4096,255));setInterval(()=>{},1000);'],{...opts,maxBuffer:128});assert.equal(r.outputTruncated,true);assert.equal(r.error.code,'ENOBUFS');assert.equal(r.stdout.length,128);
});
test('timeout stops only its owned local child and is not remote rollback proof',async()=>{
 const r=await backupProcess(process.execPath,['-e','setInterval(()=>{},1000);'],{...opts,timeout:100});assert.equal(r.error.code,'ETIMEDOUT');assert.match(r.localProcessBoundary,/remote/);
});
