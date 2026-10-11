import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { cpus, totalmem, platform, arch } from 'node:os';
import { token } from './dev-tokens.mjs';
import { application, suite } from './fixtures.mjs';
import { required, completed, key, base } from './client.mjs';

// A bounded repeated local experiment, NOT a cloud benchmark or autoscaling proof.
if (!['localhost','127.0.0.1'].includes(new URL(base).hostname)) throw Error('Local target only');
const jobsPerStage = Number(process.env.RG_JOBS ?? 120), producers = Number(process.env.RG_PRODUCERS ?? 8);
if (!Number.isInteger(jobsPerStage) || jobsPerStage < 20 || jobsPerStage > 200 || !Number.isInteger(producers) || producers < 1 || producers > 12) throw Error('Experiment limits exceeded');
const docker = (...args) => execFileSync('docker', ['compose', ...args], { encoding: 'utf8', stdio: ['ignore','pipe','pipe'], timeout: 120000 });
const percentile = (values, q) => { const a = values.filter(Number.isFinite).sort((a,b)=>a-b); return a.length ? a[Math.ceil(q*a.length)-1] : null; };
const initialWorkers = docker('ps','-q','worker').trim().split('\n').filter(Boolean).length;
if (initialWorkers < 1 || initialWorkers > 5) throw Error('Start between one and five workers first');
const report = { startedAt: new Date().toISOString(), cloud: false, automaticScaling: false, providerCalls: 0, workload: 'Ten-case static replay; no artificial evaluation delays', jobsPerStage, producers,
  host: { platform: platform(), arch: arch(), logicalCpus: cpus().length, hostMemoryBytes: totalmem() },
  limits: '0.5 CPU/384MB per application container; shared local Docker host/PostgreSQL/RabbitMQ; Docker VM allocation may be lower than host memory',
  protocol: 'Three paired rounds, order 1/3,3/1,1/3. Per stage 10 warm-ups excluded. Submit and observe concurrently, with bounded admission concurrency. Short burst results only, not sustained capacity.',
  stages: [], limitations: ['No cloud or automatic scaling', 'Provider excluded', 'No confidence interval from only three rounds', 'Same physical host and shared infrastructure', 'Observer polling adds API load', 'No CPU/DB bottleneck attribution without additional telemetry'] };
try {
  for (const [round, order] of [[1,[1,3]], [2,[3,1]], [3,[1,3]]]) for (const replicas of order) {
    docker('up','-d','--no-deps','--scale',`worker=${replicas}`,'--wait','worker');
    const workspace = `repeat-${round}-${replicas}-${Date.now()}`, t = await token('benchmark','contributor',workspace);
    const a = await required('applications',t,application), s = await required('suites',t,suite);
    const body = i => ({ appId:a.id,suiteId:s.id,candidate:`load-${i}`,commitRef:'course-v2',source:'replay',scenario:'passing' });
    for (let i=0;i<10;i++) await completed((await required('jobs',t,body('warm-'+i),key())).id,t);
    const submitted=[], observations=[]; let next=0; const start=performance.now();
    await Promise.all(Array.from({length:producers},async()=>{
      while(next<jobsPerStage) {
        const i=next++, began=performance.now();
        try {
          const q=await required('jobs',t,body(i),key());
          const row={i,id:q.id,submitMs:performance.now()-began}; submitted.push(row);
          // Attach rejection handler immediately; preserve failures rather than dropping them.
          observations.push(completed(q.id,t).then(job=>({...row,job}),error=>({...row,error:String(error)})));
        } catch(error) { submitted.push({i,error:String(error),submitMs:performance.now()-began}); }
      }
    }));
    const rows=await Promise.all(observations), elapsedMs=performance.now()-start;
    const terminal=rows.filter(r=>r.job), durations=terminal.map(r=>Date.parse(r.job.finished_at)-Date.parse(r.job.created_at));
    const queue=terminal.map(r=>Date.parse(r.job.started_at)-Date.parse(r.job.created_at));
    const execution=terminal.map(r=>r.job.execution?.durationMs);
    const successful=terminal.filter(r=>r.job.status==='succeeded');
    const errors=submitted.filter(r=>r.error).length+rows.filter(r=>r.error||r.job?.status==='failed').length;
    const stage={round,replicas,workspace,elapsedMs,requested:jobsPerStage,completed:successful.length,errors,errorRate:errors/jobsPerStage,
      blocked:terminal.filter(r=>r.job.result?.gate==='blocked').length,jobsPerSecond:successful.length*1000/elapsedMs,
      completionP50Ms:percentile(durations,.5),completionP95Ms:percentile(durations,.95),queueP95Ms:percentile(queue,.95),executionP95Ms:percentile(execution,.95),
      submissionP95Ms:percentile(submitted.map(r=>r.submitMs),.95),workerIds:[...new Set(terminal.map(r=>r.job.worker_id))],
      raw:rows.map(r=>({id:r.id,error:r.error,submitMs:r.submitMs,status:r.job?.status,gate:r.job?.result?.gate,createdAt:r.job?.created_at,startedAt:r.job?.started_at,finishedAt:r.job?.finished_at,workerId:r.job?.worker_id,executionMs:r.job?.execution?.durationMs})),
      admissionErrors:submitted.filter(r=>r.error)};
    report.stages.push(stage); console.log(JSON.stringify({...stage,raw:undefined,admissionErrors:undefined}));
  }
  report.summary=[1,3].map(replicas=>{const stages=report.stages.filter(s=>s.replicas===replicas);return {replicas,rounds:stages.length,medianJobsPerSecond:percentile(stages.map(s=>s.jobsPerSecond),.5),medianCompletionP95Ms:percentile(stages.map(s=>s.completionP95Ms),.5),totalErrors:stages.reduce((n,s)=>n+s.errors,0)};});
  report.throughputRatio=report.summary[1].medianJobsPerSecond/report.summary[0].medianJobsPerSecond;
  report.interpretation=report.throughputRatio>1?'Observed higher median burst throughput; not proof of proportional scaling or sustained capacity.':'No median throughput improvement. Preserve this result; do not claim a scaling speedup.';
  if(report.stages.some(s=>s.errors))process.exitCode=1;
} catch(error) { report.error=String(error);process.exitCode=1; }
finally {
  try { docker('up','-d','--no-deps','--scale',`worker=${initialWorkers}`,'--wait','worker');report.restoredWorkers=initialWorkers; }
  catch(error){report.cleanupError=String(error);process.exitCode=1;}
  report.finishedAt=new Date().toISOString();await mkdir('evidence/current',{recursive:true});
  await writeFile('evidence/current/scaling-repeated.json',JSON.stringify(report,null,2));
}
