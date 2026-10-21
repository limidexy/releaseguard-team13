import type { FastifyInstance } from 'fastify';
import os from 'node:os';
import { pool, uuid, internalHeader } from './common.js';
import { evaluationSchema } from './evaluation.js';
import { evaluate, outputSchema, type Output } from './domain.js';
import { broker, queueName } from './queue.js';
import { z } from 'zod';
import { evaluateControlledV13 } from './controlled-evaluation-v13.js';
import { evaluateControlledV14 } from './controlled-evaluation-v14.js';
import {evaluateControlledV17} from './controlled-evaluation-v17.js';
import {inSpan,SpanKind,extracted,tracedFetch} from './observability.js';
export async function worker(app: FastifyInstance) {
  await evaluationSchema(); const workerId = os.hostname(), leaseMs = Number(process.env.LEASE_MS ?? 60000);
  const { channel } = await broker(); await channel.prefetch(1);
  await channel.consume(queueName, async msg => {
    if (!msg) return;
    await inSpan('rabbitmq process',SpanKind.CONSUMER,async span=>{
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let claimed: { id: string; lease: string } | undefined;
    try {
      const { jobId } = z.object({ jobId: z.string().uuid() }).parse(JSON.parse(msg.content.toString()));
      span.setAttributes({'messaging.system':'rabbitmq','messaging.destination.name':queueName,'job.id':jobId});
      const lease = uuid();
      const job = (await pool.query("UPDATE jobs SET status='running',lease_id=$2,lease_until=now()+$3::integer*interval '1 millisecond',attempts=attempts+1,worker_id=$4,started_at=COALESCE(started_at,now()) WHERE id=$1 AND (status='queued' OR (status='running' AND lease_until<now())) RETURNING *", [jobId, lease, leaseMs, workerId])).rows[0];
      if (!job) { channel.ack(msg); return; } // Terminal duplicates are safe; expired leases are swept into the outbox.
      claimed = { id: jobId, lease };
      if (job.attempts > (job.input.source === 'real' ? 1 : 3)) { await pool.query("UPDATE jobs SET status='failed',error='Worker retry limit exceeded; real provider jobs require explicit resubmission',finished_at=now(),lease_until=NULL WHERE id=$1 AND lease_id=$2", [jobId, lease]); channel.ack(msg); return; }
      heartbeat = setInterval(() => { void pool.query("UPDATE jobs SET lease_until=now()+$3::integer*interval '1 millisecond' WHERE id=$1 AND lease_id=$2 AND status='running'", [jobId, lease, leaseMs]).catch(e => app.log.error(e)); }, Math.max(1000, Math.floor(leaseMs / 3)));
      const start = performance.now();
      let outputs: Output[], provenance: unknown;
      if (job.input.source === 'imported') { outputs = job.input.outputs; provenance = { source: 'imported', trust: 'caller_supplied' }; }
      else {
        const runnerUrl = job.snapshot.application.data.runnerUrl;
        if (!(process.env.RUNNER_ORIGINS ?? '').split(',').includes(new URL(runnerUrl).origin)) throw new Error('Runner origin no longer allowed');
        const res = await tracedFetch('support',runnerUrl, { method: 'POST', headers: { ...await internalHeader('support'), 'content-type': 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(job.input.source === 'real' ? 450000 : 120000), body: JSON.stringify({ source: job.input.source, promptVersion: job.input.promptVersion ?? 'v1', scenario: job.input.scenario ?? 'passing', cases: job.snapshot.suite.data.cases }) });
        if (!res.ok) throw new Error('Runner failed with HTTP ' + res.status);
        const reader = res.body?.getReader(); if (!reader) throw new Error('Missing runner body');
        const chunks: Uint8Array[] = []; let length = 0;
        while (true) { const { value, done } = await reader.read(); if (done) break; length += value.length; if (length > 1000000) { await reader.cancel(); throw new Error('Runner response too large'); } chunks.push(value); }
        const raw = JSON.parse(Buffer.concat(chunks).toString()); outputs = z.array(outputSchema).max(60).parse(raw.outputs); provenance = raw.provenance;
        if (!provenance || (provenance as any).source !== job.input.source) throw new Error('Runner source mismatch');
      }
      const controlled = job.input.promptVersion === 'v17' ? evaluateControlledV17(job.snapshot.suite.data.cases, job.snapshot.suite.data.policy, outputs) : (job.input.promptVersion === 'v14' || job.input.promptVersion === 'v15' || job.input.promptVersion === 'v16') ? evaluateControlledV14(job.snapshot.suite.data.cases, job.snapshot.suite.data.policy, outputs) : job.input.promptVersion === 'v13' ? evaluateControlledV13(job.snapshot.suite.data.cases, job.snapshot.suite.data.policy, outputs) : undefined;
      const result = controlled?.result ?? evaluate(job.snapshot.suite.data.cases, job.snapshot.suite.data.policy, outputs);
      await pool.query("UPDATE jobs SET status='succeeded',result=$3,execution=$4,finished_at=now(),lease_until=NULL WHERE id=$1 AND lease_id=$2 AND status='running'", [jobId, lease, result, { workerId, durationMs: performance.now() - start, provenance, ...(controlled ? { rawModelEvaluation: controlled.rawModelEvaluation, explanationValidation: controlled.records } : {}) }]);
      app.log.info({ jobId, workerId, gate: result.gate }, 'evaluation completed'); channel.ack(msg);
    } catch (e) {
      span.setAttribute('error.type','worker_attempt_failed');
      span.setStatus({code:2,message:'worker_attempt_failed'});
      app.log.error({ event:'worker_attempt_failed',jobId:claimed?.id }, 'worker attempt failed');
      if (claimed) await pool.query('UPDATE jobs SET error=$3 WHERE id=$1 AND lease_id=$2', [claimed.id, claimed.lease, String(e).slice(0,500)]).catch(error => app.log.error(error));
      // Keep the job running until its lease expires. Sweep republishes it; retries are bounded.
      channel.ack(msg);
    } finally { if (heartbeat) clearInterval(heartbeat); }
    },extracted(msg.properties.headers));
  }, { noAck: false });
}
