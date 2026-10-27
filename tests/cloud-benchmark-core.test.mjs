import test from 'node:test';
import assert from 'node:assert/strict';
import {runPairedBenchmark,validatePairedBenchmark} from '../scripts/cloud-benchmark-core.mjs';
import {protocolBoundary} from './fixtures/cloud-benchmark-protocol.mjs';
const run=b=>runPairedBenchmark(b.c,b.io);
test('complete original four-stage contract:100POSTs including20excluded warmups,800history reads,4auth and owned restoration',async()=>{
 const b=protocolBoundary(),r=await run(b);assert.equal(r.passed,true,JSON.stringify(r.errors));assert.equal(r.requests,1008);assert.deepEqual(r.stages.map(s=>[s.round,s.replicas]),[[1,1],[1,3],[2,3],[2,1]]);
 assert.equal(b.calls.filter(c=>c.route==='/api/v2/jobs'&&c.method==='POST').length,100);assert.equal(b.auth.filter(x=>x==='authorize').length,4);
 const reads=b.calls.filter(c=>c.route==='/api/v2/jobs'&&c.method==='GET');assert.equal(reads.length,800);assert.equal(reads.every((c,i)=>c.query==='?limit=25&offset='+(i%4)*25),true);
 assert.equal(r.summaries.reduce((n,s)=>n+s.outcomes.uniqueSucceededJobs,0),80);assert.equal(r.stages.every(s=>s.warmups.length===5&&s.tasks.length===20&&s.reads.length===200),true);
 assert.equal(r.restoration.state,'restored');assert.equal(b.f.state.worker.spec.replicas,1);assert.equal(r.summaries.every(s=>s.fullCohortCompletionP95Ms===30),true);
 assert.equal(r.automaticScalingBenefitProven,false);assert.equal(r.maximumCapacityProven,false);assert.equal(r.modelCallsRequested,0);
 assert.equal(new Set(b.calls.filter(c=>c.method==='POST'&&c.route==='/api/v2/jobs').map(c=>c.key)).size,100);
 assert.equal(b.calls.some(c=>/review|release|admin|execute/.test(c.route)),false);assert.equal(b.records.get('terminal.json').passed,true);
});
test('failed warmup stops before measured submissions or later assets and retains all80 planned slots',async()=>{
 const b=protocolBoundary({mutateJob:j=>{j.status='failed';j.result=null;}}),r=await run(b);assert.equal(r.passed,false);assert.equal(r.stages[0].warmups[0].job.status,'failed');
 assert.equal(b.calls.filter(c=>c.method==='POST'&&c.route==='/api/v2/jobs').length,1);assert.equal(r.stages.flatMap(s=>s.tasks).length,80);assert.equal(r.stages.flatMap(s=>s.tasks).every(t=>t.submission.state==='not_sent'),true);assert.equal(r.restoration.state,'restored');
});
test('negative observed raw time is retained and cannot produce a successful comparison',async()=>{
 const b=protocolBoundary({mutateJob:j=>{if(j.input.candidate.includes('measured-0'))j.finished_at='2026-10-10T23:59:59.999Z';}}),r=await run(b);assert.equal(r.passed,false);assert.equal(r.summaries[0].rows[0].completionMs,-1);assert.equal(r.summaries[0].fullCohortCompletionP95Ms,null);assert.equal(r.throughputRatio,null);assert.equal(r.stages[1].state,'not_started');
});
for(const option of ['disconnectPost','statusPost'])test(option+' after possible acceptance stops new dispatch; in-flight receipts remain without resend',async()=>{
 const b=protocolBoundary({[option]:6}),r=await run(b),sent=b.calls.filter(c=>c.route==='/api/v2/jobs'&&c.method==='POST');
 assert.equal(r.passed,false);assert.equal(sent.length<=13,true);assert.equal(sent.length>=6,true);assert.equal(new Set(sent.map(c=>c.key)).size,sent.length);
 assert.equal(r.stages[0].tasks[0].submission.commitState,'unknown');assert.equal(r.stages[0].tasks.length,20);assert.equal(r.stages[1].state,'not_started');
 assert.equal(r.restoration.state,'restored');const intents=[...b.records].filter(([n,v])=>n.endsWith('-intent.json')&&v.request.route==='/jobs'&&v.request.method==='POST');
 assert.equal(intents.length,sent.length);for(const [name]of intents)assert.equal(b.records.has(name.replace('-intent','-observed')),true);
});
for(const mutation of [j=>{j.workspace='other';},j=>{j.input.source='model';},j=>{j.result.gate='failed';},j=>{j.worker_id='foreign-worker';},j=>{delete j.finished_at;},j=>{j.snapshot.suite.data.policy.minScore=0;}])test('unassociated/misleading job observation remains raw and invalid',async()=>{
 const b=protocolBoundary({mutateJob:(j,row)=>{if(row.index===6)mutation(j);}}),r=await run(b);assert.equal(r.passed,false);assert.equal(r.stages[0].tasks[0].job!==null,true);assert.equal(r.throughputRatio,null);assert.equal(r.restoration.state,'restored');
});
test('successful nonterminal observation uses1000ms cadence, never resends POST',async()=>{
 const b=protocolBoundary({queued:true}),r=await run(b);assert.equal(r.passed,true);assert.equal(r.requests,1108);assert.equal(b.calls.filter(c=>c.route==='/api/v2/jobs'&&c.method==='POST').length,100);assert.equal(b.f.io.now()>=100000,true);
});
test('read-only target proof failure prevents auth and all asset/job mutations',async()=>{
 const b=protocolBoundary({targetRefused:true}),r=await run(b);assert.equal(r.passed,false);assert.equal(b.auth.length,0);assert.equal(b.calls.length,0);assert.equal(b.f.patches(),0);
});
test('source drift cannot promote otherwise completed comparison',async()=>{
 const b=protocolBoundary({sourceDrift:true}),r=await run(b);assert.equal(r.passed,false);assert.equal(r.restoration.state,'restored');assert.equal(b.records.get('terminal.json').passed,false);
});
test('failed intent persistence prevents that request and subsequent writes, with all planned rows retained',async()=>{
 const b=protocolBoundary({onPersist:n=>{if(n==='operations/000001-intent.json')throw Error('Synthetic disk failure');}}),r=await run(b);assert.equal(r.passed,false);assert.equal(b.calls.length,0);assert.equal(r.stages.flatMap(s=>s.tasks).length,80);assert.equal(r.restoration.state,'restored');
});
test('failed response persistence leaves request unknown and still restores target',async()=>{
 const b=protocolBoundary({onPersist:n=>{if(n==='operations/000003-observed.json')throw Error('Synthetic disk failure');}}),r=await run(b);assert.equal(r.passed,false);assert.equal(r.stages[0].warmups[0].submission.state,'unknown');assert.equal(r.restoration.state,'restored');assert.equal(b.calls.length,3);
});
test('concurrent external replica mutation is retained, never automatically reset or called restored',async()=>{
 const b=protocolBoundary({onPersist:(name,v,{f})=>{if(name==='stage-0.json'){f.state.worker.spec.replicas=2;f.state.worker.metadata.resourceVersion='900';f.reconcile();}}}),r=await run(b);assert.equal(r.passed,false);assert.equal(b.f.state.worker.spec.replicas,2);assert.equal(r.restoration.workerRestored,false);assert.equal(r.throughputRatio,null);
});
test('a completed run ID cannot be resumed or reused',async()=>{
 const b=protocolBoundary();assert.equal((await run(b)).passed,true);const calls=b.calls.length;assert.equal((await run(b)).passed,false);assert.equal(b.calls.length,calls);
});
test('explicit configuration rejects wider bounds and unselected topology without IO',async()=>{
 for(const patch of [{allowPairedReplay:false},{jobs:19},{jobs:201},{deadlineMs:1200001},{origin:'http://localhost:5193'},{authFile:'.env'},{fixtureSHA256:'-'.repeat(64)},{extra:true}]){
  const b=protocolBoundary();Object.assign(b.c,patch);assert.throws(()=>validatePairedBenchmark(b.c));assert.equal((await run(b)).state,'refused_before_reservation');assert.equal(b.calls.length,0);assert.equal(b.f.patches(),0);
 }
});
for(const n of [100,200])test('original n'+n+' preserves full'+(4*n)+' measured denominator and'+(4*n+20)+' unique replay submissions',async()=>{
 const b=protocolBoundary();b.c.jobs=n;const r=await run(b);assert.equal(r.passed,true);assert.equal(r.stages.flatMap(s=>s.tasks).length,4*n);assert.equal(b.calls.filter(c=>c.route==='/api/v2/jobs'&&c.method==='POST').length,4*n+20);assert.equal(r.stages.every(s=>s.reads.length===200),true);
});
test('cancelled dispatch still attempts only owned cleanup and never marks a run passed',async()=>{
 const b=protocolBoundary({onPersist:(name,v,{controller})=>{if(name==='operations/000003-intent.json')controller.abort();}}),r=await run(b);assert.equal(r.passed,false);assert.equal(b.calls.length,2);assert.equal(r.stages[0].warmups[0].submission.state,'not_sent');assert.equal(r.restoration.state,'restored');
});
test('deadline prevents next dispatch while separate restoration budget remains available',async()=>{
 const b=protocolBoundary({onPersist:(name,v,{f})=>{if(name==='operations/000003-intent.json')f.advance(900001);}}),r=await run(b);assert.equal(r.passed,false);assert.equal(b.calls.length,2);assert.equal(r.stages[0].warmups[0].submission.state,'not_sent');assert.equal(r.restoration.state,'restored');
});
test('job observation has a bounded120second deadline and does not resend its accepted POST',async()=>{
 const b=protocolBoundary({mutateJob:j=>{j.status='running';j.result=null;}}),r=await run(b);assert.equal(r.passed,false);assert.equal(b.calls.filter(c=>c.method==='POST'&&c.route==='/api/v2/jobs').length,1);assert.equal(r.stages[0].warmups[0].job.status,'running');assert.equal(r.restoration.state,'restored');
});
test('omitting jobs retains the original default100 while explicitly invalid jobs still refuse',async()=>{
 const b=protocolBoundary();delete b.c.jobs;assert.equal(validatePairedBenchmark(b.c).jobs,100);const r=await run(b);assert.equal(r.passed,true);assert.equal(r.stages.flatMap(s=>s.tasks).length,400);assert.equal(b.calls.filter(c=>c.route==='/api/v2/jobs'&&c.method==='POST').length,420);
 const invalid=protocolBoundary();invalid.c.jobs=undefined;assert.throws(()=>validatePairedBenchmark(invalid.c));
});
