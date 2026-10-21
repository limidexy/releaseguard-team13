import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actor, accountable, write, pool, transaction, uuid, digest, HttpError, internal, serviceFetch } from './common.js';
import { jobSchema } from './domain.js';
import { broker, queueName } from './queue.js';
import {inSpan,SpanKind,traceCarrier,extracted} from './observability.js';
export async function evaluationSchema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS jobs(
    id uuid PRIMARY KEY,workspace text NOT NULL,created_by text NOT NULL,request_hash text NOT NULL,idempotency_key text NOT NULL,
    input jsonb NOT NULL,snapshot jsonb NOT NULL,status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','failed')),
    result jsonb,execution jsonb,error text,attempts integer NOT NULL DEFAULT 0,lease_id uuid,lease_until timestamptz,worker_id text,
    created_at timestamptz NOT NULL DEFAULT now(),started_at timestamptz,finished_at timestamptz,UNIQUE(workspace,idempotency_key));
    CREATE INDEX IF NOT EXISTS jobs_workspace_created ON jobs(workspace,created_at DESC,id);
    CREATE INDEX IF NOT EXISTS jobs_status_lease ON jobs(status,lease_until);
    CREATE TABLE IF NOT EXISTS outbox(id uuid PRIMARY KEY,job_id uuid NOT NULL REFERENCES jobs(id),sent_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS outbox_pending ON outbox(created_at) WHERE sent_at IS NULL;
    ALTER TABLE jobs ADD COLUMN IF NOT EXISTS trace_context jsonb;
    ALTER TABLE outbox ADD COLUMN IF NOT EXISTS trace_context jsonb;
    CREATE TABLE IF NOT EXISTS admission_limits(key text PRIMARY KEY,count integer NOT NULL,expires_at timestamptz NOT NULL);`);
}
export async function evaluation(app: FastifyInstance) {
  await evaluationSchema();
  const { channel } = await broker();
  let publishing = false;
  const timer = setInterval(async () => {
    if (publishing) return; publishing = true;
    try {
      await transaction(async c => {
        const rows = (await c.query('SELECT id,job_id,trace_context FROM outbox WHERE sent_at IS NULL ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 50')).rows;
        for (const row of rows) await inSpan('rabbitmq publish',SpanKind.PRODUCER,async span=>{
          span.setAttributes({'messaging.system':'rabbitmq','messaging.destination.name':queueName,'job.id':row.job_id});
          channel.sendToQueue(queueName, Buffer.from(JSON.stringify({ jobId: row.job_id })), { persistent: true, messageId: row.id,headers:traceCarrier() });
          await channel.waitForConfirms();
          app.log.info({event:'job_published',jobId:row.job_id},'job published');
        },extracted(row.trace_context));
        await channel.waitForConfirms();
        if (rows.length) await c.query('UPDATE outbox SET sent_at=now() WHERE id=ANY($1::uuid[])', [rows.map(r => r.id)]);
      });
      // Recovery sweep also works when a worker was killed after receiving a job.
      await transaction(async c => {
        const expired = (await c.query("UPDATE jobs SET status='queued',lease_id=NULL,lease_until=NULL WHERE status='running' AND lease_until<now() RETURNING id,trace_context")).rows;
        for (const row of expired) await c.query('INSERT INTO outbox(id,job_id,trace_context) VALUES($1,$2,$3)', [uuid(), row.id,row.trace_context]);
      });
    } catch (e) { app.log.error({ error: String(e) }, 'outbox or recovery failed'); } finally { publishing = false; }
  }, 250);
  app.addHook('onClose', async () => { clearInterval(timer); await channel.close(); });
  app.post('/jobs', async (req, reply) => {
    const a = await actor(req); write(a); const input = jobSchema.parse(req.body);
    const key = z.string().regex(/^[-a-zA-Z0-9_]{8,100}$/).parse(req.headers['idempotency-key']);
    const hash = digest(input);
    const existing = async () => (await pool.query('SELECT id,status,request_hash FROM jobs WHERE workspace=$1 AND idempotency_key=$2', [a.workspace, key])).rows[0];
    const replay = (r: any) => { if (r.request_hash !== hash) throw new HttpError(409, 'Idempotency key payload conflict'); return { id: r.id, status: r.status, replayed: true }; };
    const previous = await existing(); if (previous) return replay(previous);
    if (input.previousJobId) {
      const parent = (await pool.query('SELECT status,input FROM jobs WHERE id=$1 AND workspace=$2', [input.previousJobId, a.workspace])).rows[0];
      if (!parent) throw new HttpError(404, 'Previous job not found');
      if (!['succeeded', 'failed'].includes(parent.status)) throw new HttpError(409, 'Previous job must be completed');
      if (parent.input.appId !== input.appId) throw new HttpError(409, 'Previous job belongs to another application');
    }
    const snapshot = await serviceFetch('registry', `/internal/snapshot/${input.appId}/${input.suiteId}`, a.workspace);
    if (input.outputs?.some(o => !snapshot.suite.data.cases.some((c: any) => c.id === o.caseId)) || (input.outputs && new Set(input.outputs.map(o => o.caseId)).size !== input.outputs.length)) throw new HttpError(400, 'Unknown or duplicate output case');
    if (input.source !== 'imported' && !snapshot.application.data.runnerUrl) throw new HttpError(400, 'Application runner required');
    const id = uuid();
    try { await transaction(async c => {
      const minute = Math.floor(Date.now()/60000), rateKey = a.workspace + ':' + accountable(a) + ':' + minute;
      const count = (await c.query("INSERT INTO admission_limits(key,count,expires_at) VALUES($1,1,now()+interval '2 minutes') ON CONFLICT(key) DO UPDATE SET count=admission_limits.count+1 RETURNING count", [rateKey])).rows[0].count;
      if (count > Number(process.env.MAX_JOBS_PER_MINUTE ?? 1000)) throw new HttpError(429, 'Evaluation admission limit reached');
      await c.query('DELETE FROM admission_limits WHERE expires_at<now()');
      await c.query('INSERT INTO jobs(id,workspace,created_by,request_hash,idempotency_key,input,snapshot,trace_context) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [id, a.workspace, accountable(a), hash, key, input, snapshot,traceCarrier()]);
      await c.query('INSERT INTO outbox(id,job_id,trace_context) VALUES($1,$2,$3)', [uuid(), id,traceCarrier()]);
    }); } catch (e: any) { if (e.code === '23505') { const raced = await existing(); if (raced) return replay(raced); } throw e; }
    return reply.code(202).send({ id, status: 'queued', replayed: false });
  });
  app.get('/jobs', async req => {
    const a = await actor(req); const { limit, offset } = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25), offset: z.coerce.number().int().min(0).max(10000).default(0) }).parse(req.query);
    return (await pool.query("SELECT id,status,created_by,created_at,started_at,finished_at,worker_id,input->>'candidate' AS candidate,input->>'source' AS source,input->>'previousJobId' AS previous_job_id,result->>'gate' AS gate,result->>'score' AS score FROM jobs WHERE workspace=$1 ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3", [a.workspace, limit, offset])).rows;
  });
  app.get('/jobs/:id', async req => { const a = await actor(req); const { id } = z.object({ id: z.string().uuid() }).parse(req.params); return detail(id, a.workspace); });
  app.get('/internal/jobs/:id', async req => { await internal(req, ['governance']); const { id } = z.object({ id: z.string().uuid() }).parse(req.params); const { workspace } = z.object({ workspace: z.string() }).parse(req.query); return detail(id, workspace); });
}
async function detail(id: string, workspace: string) {
  const row = (await pool.query('SELECT id,workspace,created_by,input,snapshot,status,result,execution,error,attempts,worker_id,created_at,started_at,finished_at FROM jobs WHERE id=$1 AND workspace=$2', [id, workspace])).rows[0];
  if (!row) throw new HttpError(404, 'Job not found'); return row;
}
