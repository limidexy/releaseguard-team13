// Frozen PR1 executable contract with controlled IO, never a live cloud result.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {benchmarkSource,benchmarkFixtures} from './fixtures/cloud-benchmark-source-pr1.mjs';
import {legacyBenchmark} from './fixtures/cloud-benchmark-source-harness.mjs';
import {protocolBoundary,fixture} from './fixtures/cloud-benchmark-protocol.mjs';
import {runPairedBenchmark} from '../scripts/cloud-benchmark-core.mjs';
test('frozen source hash and original ten-case95policy fixture are unchanged',()=>{
 assert.equal(createHash('sha256').update(benchmarkSource).digest('hex'),'bed3abd1316843d7df3fce8dc472ab3d16b585ef3d7a918221965bcdb1b9add8');
 assert.deepEqual(benchmarkFixtures,fixture);assert.equal(fixture.suite.policy.minScore,95);assert.equal(fixture.suite.policy.maxLatencyMs,null);
});
test('original and replacement normal contracts both preserve four paired stages,5warmups,8lanes,800history and100jobs atn20',async()=>{
 const old=await legacyBenchmark(),b=protocolBoundary(),next=await runPairedBenchmark(b.c,b.io);assert.equal(old.report.passed,true);assert.equal(next.passed,true);
 assert.deepEqual(old.report.stages.map(s=>[s.round,s.replicas,s.requested,s.completed,s.readSuccessful]),next.summaries.map(s=>[s.round,s.replicas,s.requested,s.outcomes.uniqueSucceededJobs,s.readsComplete?200:0]));
 assert.equal(old.calls.filter(c=>c.route==='jobs'&&c.data).length,b.calls.filter(c=>c.route==='/api/v2/jobs'&&c.method==='POST').length);assert.equal(old.tokens,4);
});
test('preserved source permits a failed warmup and negative times to coexist with passed:true; candidate rejects both',async()=>{
 for(const fault of ['failed-warmup','negative-server-time']){const r=await legacyBenchmark({fault});assert.equal(r.report.passed,true);}
 for(const mutateJob of [j=>{j.status='failed';},j=>{j.finished_at='2026-10-10T23:59:59.999Z';}]){const b=protocolBoundary({mutateJob});assert.equal((await runPairedBenchmark(b.c,b.io)).passed,false);}
});
test('preserved source continues later writes after an unknown POST; candidate latches new dispatch off',async()=>{
 const r=await legacyBenchmark({fault:'unknown-after-accepted'});assert.equal(r.calls.filter(c=>c.route==='jobs'&&c.data&&!c.data.candidate.includes('warm-')).length,80);
 const b=protocolBoundary({disconnectPost:6}),next=await runPairedBenchmark(b.c,b.io);assert.equal(next.passed,false);assert.equal(b.calls.filter(c=>c.route==='/api/v2/jobs'&&c.method==='POST').length<=13,true);
});
test('preserved source overwrites a concurrent replica change; candidate refuses to overwrite it',async()=>{
 const r=await legacyBenchmark({fault:'concurrent-replica-change'});assert.equal(r.externalChange,true);assert.equal(r.replicas,1);
 const b=protocolBoundary({onPersist:(name,v,{f})=>{if(name==='stage-0.json'){f.state.worker.spec.replicas=2;f.reconcile();}}}),next=await runPairedBenchmark(b.c,b.io);assert.equal(next.passed,false);assert.equal(b.f.state.worker.spec.replicas,2);
});
