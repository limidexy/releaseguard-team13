import test from 'node:test';import assert from 'node:assert/strict';
import {runBackup,validateBackup} from '../scripts/backup-core.mjs';
import {backupBoundary} from './fixtures/backup-protocol.mjs';
const run=async o=>{const b=backupBoundary(o),r=await runBackup(b.c,b.io);return {b,r};};
test('complete three-database protocol dumps binary, restores, compares all public rows and cleans only its scratch databases',async()=>{
 const {b,r}=await run();assert.equal(r.passed,true,JSON.stringify(r.errors));assert.equal(r.verified,3);assert.equal(r.denominator,3);assert.equal(b.scratch.size,0);
 for(const kind of ['dump','create','restore','drop'])assert.equal(b.events.filter(x=>x.kind===kind).length,3);
 assert.equal(r.commandIntents,34);assert.equal(r.databases.every(x=>x.cleanup.dropAttempts===1&&x.sourceStableDuringCheck&&x.samePublicRows),true);
 assert.equal(r.regionalDisasterRecoveryProven,false);assert.equal(r.schemaRecoveryProven,false);assert.equal(r.recoverySLAProven,false);
 assert.equal([...b.binaries].filter(([n])=>n.endsWith('stdout.bin')).some(([,v])=>v.equals(b.dump)),true);
 assert.equal([...b.records.values()].some(x=>x.input?.type==='Buffer'),false);
});
test('generic smoke flags, weakened acknowledgement or changed target schema cannot activate the operator',async()=>{
 for(const change of [c=>{delete c.allowCloudBackupRestore;c.allowCloudSmoke=true;},c=>{c.target.acknowledgement='yes';},c=>{c.target.serverVersionNum=160009;},c=>{c.target.databaseOIDs.rg_evaluation=16384;},c=>{c.sourceCommit='main';}]){const b=backupBoundary();change(b.c);assert.throws(()=>validateBackup(b.c));assert.equal((await runBackup(b.c,b.io)).passed,false);assert.equal(b.events.length,0);}
});
test('each mutating boundary follows its durable intent, with fixed three-row denominator',async()=>{
 const {b,r}=await run();for(const [index,e]of b.events.entries())if(['create','restore','drop'].includes(e.kind)){const earlier=b.events.slice(0,index).filter(x=>x.type==='persist'&&x.name.endsWith('intent.json')).at(-1);assert.ok(earlier);assert.equal(b.records.get(earlier.name).kind,e.kind);}assert.equal(r.databases.length,3);
});
test('unknown create is never resent; marked ownership is reconciled once and only then cleaned',async()=>{
 const {b,r}=await run({unknownCreate:true});assert.equal(r.passed,false);assert.equal(r.databases[0].creation.state,'unknown');assert.equal(r.databases[0].cleanup.state,'dropped_observed');assert.equal(b.events.filter(x=>x.kind==='create').length,1);assert.equal(b.events.filter(x=>x.kind==='drop').length,1);assert.equal(r.databases[1].state,'not_attempted');
});
test('unknown unmarked create is preserved with its scratch intent, never guessed to be owned',async()=>{
 const {b,r}=await run({unknownCreate:true,unmarkedCreate:true});assert.equal(r.passed,false);assert.equal(b.scratch.size,1);assert.equal(r.databases[0].cleanup.state,'ownership_unconfirmed_preserved');assert.equal(b.events.some(x=>x.kind==='drop'),false);assert.equal([...b.records.values()].some(x=>x.kind==='create'&&x.scratch===r.databases[0].scratch),true);
});
test('proven not-sent create stays distinct from unknown and needs no scratch cleanup command',async()=>{
 const {b,r}=await run({createNotSent:true});assert.equal(r.databases[0].creation.state,'not_sent');assert.equal(r.databases[0].cleanup.state,'not_needed');assert.equal(b.events.some(x=>x.kind==='owned'||x.kind==='drop'),false);
});
for(const mode of ['unknownRestore','unknownOwned','unknownDrop'])test(mode+' remains failed and never retries or dispatches another database',async()=>{
 const {b,r}=await run({[mode]:true});assert.equal(r.passed,false);assert.equal(r.denominator,3);assert.equal(r.databases[1].state,'not_attempted');assert.ok(b.events.filter(x=>x.kind==='restore').length<=1);assert.ok(b.events.filter(x=>x.kind==='drop').length<=1);
});
test('a reused scratch name/OID is retained, never dropped on the old ownership proof',async()=>{
 const {b,r}=await run({beforeCommand:({kind,scratch})=>{if(kind==='owned')for(const x of scratch.values())x.oid=999999;}});assert.equal(r.passed,false);assert.equal(r.databases[0].cleanup.state,'ownership_unconfirmed_preserved');assert.equal(b.events.some(x=>x.kind==='drop'),false);
});
for(const flag of ['foreignSystem','badDump','badTable'])test(flag+' refuses before any scratch database is created',async()=>{
 const {b,r}=await run({[flag]:true});assert.equal(r.passed,false);assert.equal(b.events.some(x=>x.kind==='create'),false);
});
test('content mismatch preserves original fingerprints and fails after safe owned cleanup',async()=>{
 const {b,r}=await run({mismatch:true});assert.equal(r.passed,false);assert.equal(r.databases[0].source[0].hash,'a'.repeat(32));assert.equal(r.databases[0].restored[0].hash,'b'.repeat(32));assert.equal(b.scratch.size,0);
});
test('intent persistence failure prevents the create boundary rather than claiming unknown dispatch',async()=>{
 const {b,r}=await run({failPersist:(n,v)=>n.endsWith('intent.json')&&v.kind==='create'});assert.equal(r.passed,false);assert.equal(r.databases[0].creation.state,'not_sent');assert.equal(b.events.some(x=>x.kind==='create'||x.kind==='drop'),false);
});
test('lost create receipt still leaves the intent and separately owned cleanup records',async()=>{
 const {b,r}=await run({failPersist:(n,v)=>n.endsWith('observed.json')&&v.kind==='create'});assert.equal(r.passed,false);assert.equal(r.databases[0].creation.state,'unknown');assert.equal(r.databases[0].cleanup.state,'dropped_observed');assert.equal(b.scratch.size,0);
});
for(const mode of ['sourceDrift','terminalFailure','abortAfterTerminal'])test(mode+' cannot return successful completion',async()=>{const {r}=await run({[mode]:true});assert.equal(r.passed,false);});
test('corrupted retained binary archive fails before any scratch creation; original dump hash remains visible',async()=>{
 const {b,r}=await run({corruptArchive:true});assert.equal(r.passed,false);assert.equal(r.errors[0].phase,'archive-readback');assert.equal(b.events.some(x=>x.kind==='create'),false);assert.equal(r.databases[0].dump.readbackMatched,undefined);
});
test('source drift during final cleanup is caught after all three restores, before a successful terminal record',async()=>{
 const b=backupBoundary();let count=0;b.io.verifyRuntime=async()=>{if(++count===4)throw Error('synthetic_final_source_drift');};const r=await runBackup(b.c,b.io);assert.equal(r.verified,3);assert.equal(r.passed,false);assert.equal(b.records.get('terminal.json').passed,false);assert.equal(r.errors.at(-1).phase,'final-runtime-stability');
});
