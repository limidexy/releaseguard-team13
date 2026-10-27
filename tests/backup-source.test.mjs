import test from 'node:test';import assert from 'node:assert/strict';
import {simulateBackup} from './fixtures/backup-source-harness.mjs';import {backupBoundary} from './fixtures/backup-protocol.mjs';import {runBackup} from '../scripts/backup-core.mjs';
test('frozen original and replacement execute all3DB full dump/restore/fingerprint/cleanup paths under fake boundaries',async()=>{
 const old=await simulateBackup(),b=backupBoundary(),now=await runBackup(b.c,b.io);assert.equal(old.report.passed,true);assert.equal(now.passed,true);assert.equal(old.report.databases.length,3);assert.equal(now.verified,3);
 for(const [original,current]of [['pg_dump','dump'],['pg_restore','restore'],['dropdb','drop']])assert.equal(old.calls.filter(x=>x.tool===original).length,b.events.filter(x=>x.kind===current).length);
 assert.equal(now.regionalDisasterRecoveryProven,false);assert.equal(now.schemaRecoveryProven,false);assert.equal(now.recoverySLAProven,false);assert.equal(old.simulation.actualDatabase,0);
});
test('original generic smoke flag activates DB mutation; replacement requires a distinct acknowledgement and schema',async()=>{
 const old=await simulateBackup();assert.equal(old.calls.some(x=>x.tool==='createdb'),true);const b=backupBoundary();delete b.c.allowCloudBackupRestore;assert.equal((await runBackup(b.c,b.io)).passed,false);assert.equal(b.events.length,0);
});
test('original second run overwrites fixed dump paths; replacement keeps run reservation/receipts exclusive',async()=>{
 const first=await simulateBackup({dumpVersion:'v1'}),old=await simulateBackup({writes:first.writes,dumpVersion:'v2',startMs:1000});assert.equal(old.overwrites.filter(x=>x.path.endsWith('.dump')).length,3);
 const b=backupBoundary();assert.equal((await runBackup(b.c,b.io)).passed,true);const before=JSON.stringify([...b.records]);assert.equal((await runBackup(b.c,b.io)).passed,false);assert.equal(JSON.stringify([...b.records]),before);
});
test('original unknown createdb lacks recoverable scratch intent; replacement retains it and does not drop an unmarked DB',async()=>{
 const old=await simulateBackup({unknownCreateAfter:true});assert.equal(old.remainingScratch.length,1);assert.equal(old.report.databases.length,0);assert.equal(old.rawReport.includes(old.remainingScratch[0]),false);
 const b=backupBoundary({unknownCreate:true,unmarkedCreate:true}),r=await runBackup(b.c,b.io);assert.equal(r.passed,false);assert.equal(b.scratch.size,1);assert.equal(b.events.some(x=>x.kind==='drop'),false);assert.equal([...b.records.values()].some(x=>x.kind==='create'&&x.scratch===r.databases[0].scratch),true);
});
