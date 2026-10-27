import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pauseProgramVM} from './fixtures/worker-pause-program-vm.mjs';
import {workerPauseInitProgram,workerPauseInitSHA256} from '../scripts/worker-pause-init.mjs';
test('opt-in launcher starts unchanged compiled Worker as a child; only pure program text is exported',()=>{
 const h=pauseProgramVM();assert.equal(createHash('sha256').update(workerPauseInitProgram).digest('hex'),workerPauseInitSHA256);
 assert.equal(h.init.process.pid,1);assert.equal(h.spawns.length,1);assert.deepEqual(h.spawns[0].args,['dist/src/main.js']);
 assert.equal(h.spawns[0].pid,7);assert.equal(h.spawns[0].parentPID,1);assert.equal(h.spawns[0].options.stdio,'inherit');assert.equal(h.signals.length,0);
});
test('launcher owns and reaps recovery agent after remote exec returns; fault signals never target PID1',async()=>{
 const h=pauseProgramVM(),c=h.ready();const r=await h.run(c);assert.equal(r.exitCode,0);assert.equal(r.context.settled,true);
 const a=h.spawns.find(s=>s.kind==='agent');assert.equal(a.parentPID,1);assert.equal(a.options.detached,true);assert.equal(a.options.stdio,'ignore');
 assert.deepEqual(Object.keys(JSON.parse(a.args[2])).sort(),Object.keys(c).sort());assert.equal(Object.hasOwn(JSON.parse(a.args[2]),'createdAt'),false);
 await h.advance(17000);assert.equal(h.contexts.find(x=>x.c.mode==='agent').exited,true);assert.equal(Object.values(h.records()).some(r=>r.code===0&&r.noRetry===true),true);
 assert.deepEqual(h.signals.map(s=>[s.pid,s.signal]),[[7,'SIGSTOP'],[7,'SIGCONT']]);assert.equal(h.spawns.filter(s=>s.kind==='agent').length,1);
});
test('killed synthetic agent is reaped with unknown outcome and is never restarted',async()=>{
 const h=pauseProgramVM(),c=h.ready();await h.run(c);h.killAgent();await h.advance(20000);
 assert.equal(h.spawns.filter(s=>s.kind==='agent').length,1);assert.equal(Object.values(h.records()).some(r=>r.code===null&&r.noRetry===true),true);
 assert.equal(h.state.workerState,'T');assert.equal((await h.run({...c,mode:'status'})).output[0].finished,null);
});
test('launcher forwards one shutdown, bounded escalation and observed Worker exit under fake processes',async()=>{
 const h=pauseProgramVM();h.launcherSignal('SIGTERM');h.launcherSignal('SIGTERM');assert.deepEqual(h.signals.map(s=>s.signal),['SIGCONT','SIGTERM']);
 await h.advance(24999);assert.equal(h.signals.length,2);await h.advance(1);assert.equal(h.signals.at(-1).signal,'SIGKILL');
 h.workerExit(3);assert.equal(h.init.exited,true);assert.equal(h.init.process.exitCode,3);
});
test('journal bound disables new agents but does not disable Worker shutdown forwarding',async()=>{
 const h=pauseProgramVM();for(let i=0;i<129;i++)h.files.set('/run/releaseguard-fault/owned/synthetic-'+i,{data:Buffer.alloc(0),dir:true,uid:1000,mode:0o40700,ino:1000+i});
 await h.advance(100);assert.equal(h.init.errors.length,1);assert.equal(h.spawns.length,1);h.launcherSignal('SIGTERM');assert.deepEqual(h.signals.map(s=>s.signal),['SIGCONT','SIGTERM']);
});
