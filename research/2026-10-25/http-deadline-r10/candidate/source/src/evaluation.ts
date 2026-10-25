import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actor, accountable, write, pool, transaction, uuid, digest, HttpError, internal, internalHeader } from './common.js';
import { jobSchema } from './domain.js';
import { broker, queueName } from './queue.js';
import { admitAtomic } from './admission-atomic.js';
import { databaseQuery, type DatabaseSpan } from './database-evidence.js';
import { installFetchTiming, newFetchTiming, withinFetch, publicFetchTiming, unknownSubmission, keyHash } from './submission-state.js';
import { configuredClockSkewBound, createSubmissionDeadline, receiveSubmissionDeadline, InvalidSubmissionDeadlineError,
  SUBMISSION_BUDGET_HEADER, SUBMISSION_KEY_HASH_HEADER } from './submission-deadline.js';
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
    CREATE TABLE IF NOT EXISTS admission_limits(key text PRIMARY KEY,count integer NOT NULL,expires_at timestamptz NOT NULL);`);
}
export async function evaluation(app: FastifyInstance) {
  const clockSkewBoundMs = configuredClockSkewBound(process.env.SUBMISSION_CLOCK_SKEW_BOUND_MS);
  installFetchTiming(app);
  await evaluationSchema();
  const { channel } = await broker();
  let publishing = false;
  const timer = setInterval(async () => {
    if (publishing) return; publishing = true;
    try {
      await transaction(async c => {
        const rows = (await c.query('SELECT id,job_id FROM outbox WHERE sent_at IS NULL ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 50')).rows;
        for (const row of rows) channel.sendToQueue(queueName, Buffer.from(JSON.stringify({ jobId: row.job_id })), { persistent: true, messageId: row.id });
        await channel.waitForConfirms();
        if (rows.length) await c.query('UPDATE outbox SET sent_at=now() WHERE id=ANY($1::uuid[])', [rows.map(r => r.id)]);
      });
      // Recovery sweep also works when a worker was killed after receiving a job.
      await transaction(async c => {
        const expired = (await c.query("UPDATE jobs SET status='queued',lease_id=NULL,lease_until=NULL WHERE status='running' AND lease_until<now() RETURNING id")).rows;
        for (const row of expired) await c.query('INSERT INTO outbox(id,job_id) VALUES($1,$2)', [uuid(), row.id]);
      });
    } catch (e) { app.log.error({ error: String(e) }, 'outbox or recovery failed'); } finally { publishing = false; }
  }, 250);
  app.addHook('onClose', async () => { clearInterval(timer); await channel.close(); });
  app.post('/jobs', async (req, reply) => {
    const started = performance.now(), traceId = typeof req.headers['x-rg-trace-id'] === 'string' && /^[a-f0-9-]{36}$/.test(req.headers['x-rg-trace-id']) ? req.headers['x-rg-trace-id'] : uuid();
    const closed = new AbortController(), stages: Record<string, number> = {}, snapshotTiming = newFetchTiming(), databaseSpans: DatabaseSpan[] = [];
    const onClose = () => { if (!reply.raw.writableFinished) closed.abort(); }; reply.raw.once('close', onClose);
    let mutationMayHaveStarted = false, outcome = 'before_mutation', keyForLog: string | undefined;
    let budget: ReturnType<typeof receiveSubmissionDeadline> | undefined;
    const checkpoint = (name: string) => { stages[name] = performance.now() - started; };
    const disconnected = () => closed.signal.aborted || reply.raw.destroyed;
    const abandoned = () => disconnected() || Boolean(budget?.expired());
    const stoppedReply = () => disconnected() ? reply : reply.code(504).send(unknownSubmission(req.headers['idempotency-key']));
    try {
    const a = await actor(req); write(a); const input = jobSchema.parse(req.body);
    const key = z.string().regex(/^[-a-zA-Z0-9_]{8,100}$/).parse(req.headers['idempotency-key']);
    keyForLog = key; checkpoint('authAndValidation');
    try { budget = receiveSubmissionDeadline(req.headers[SUBMISSION_BUDGET_HEADER], { traceId, method: req.method, route: req.url,
      keySha256: keyHash(key), bodySha256: digest(req.body), authorizationSha256: keyHash(req.headers.authorization ?? '') },
      process.env.INTERNAL_SECRET, clockSkewBoundMs); }
    catch (error) { if (error instanceof InvalidSubmissionDeadlineError) throw new HttpError(401, 'Invalid submission deadline context'); throw error; }
    checkpoint('budgetVerified'); if (abandoned()) return stoppedReply();
    const hash = digest(input);
    const existing = async () => (await databaseQuery(pool, 'existing_lookup', 'SELECT id,status,request_hash FROM jobs WHERE workspace=$1 AND idempotency_key=$2', [a.workspace, key], { isAbandoned: abandoned, observe: s => databaseSpans.push(s) })).rows[0];
    const replay = (r: any) => { if (r.request_hash !== hash) throw new HttpError(409, 'Idempotency key payload conflict'); return { id: r.id, status: r.status, replayed: true }; };
    const previous = await existing(); checkpoint('existingLookup'); if (abandoned()) return stoppedReply(); if (previous) { outcome = 'existing'; return replay(previous); }
    const registryUrl = process.env.REGISTRY_URL; if (!registryUrl) throw new HttpError(503, 'Service endpoint unavailable');
    snapshotTiming.started = performance.now();
    const snapshotPath = `/internal/snapshot/${input.appId}/${input.suiteId}?workspace=` + encodeURIComponent(a.workspace);
    const registryHeaders = { ...await internalHeader('registry'), 'x-rg-trace-id': traceId, [SUBMISSION_KEY_HASH_HEADER]: keyHash(key) };
    const registryBudget = createSubmissionDeadline({ traceId, method: 'GET', route: snapshotPath,
      keySha256: keyHash(key), bodySha256: digest(null), authorizationSha256: keyHash(registryHeaders.authorization) },
      process.env.INTERNAL_SECRET, budget.startedAtMs, 'registry');
    if (abandoned()) return stoppedReply();
    const response = await withinFetch(snapshotTiming, async () => fetch(registryUrl + snapshotPath, { headers: { ...registryHeaders, [SUBMISSION_BUDGET_HEADER]: registryBudget }, signal: AbortSignal.any([AbortSignal.timeout(5000), closed.signal, budget!.signal]) }));
    if (!response.ok) throw new HttpError(response.status === 404 ? 404 : 503, 'Upstream service unavailable or record not found');
    const snapshot = await response.json() as any; checkpoint('registrySnapshot'); if (abandoned()) return stoppedReply();
    if (input.outputs?.some(o => !snapshot.suite.data.cases.some((c: any) => c.id === o.caseId)) || (input.outputs && new Set(input.outputs.map(o => o.caseId)).size !== input.outputs.length)) throw new HttpError(400, 'Unknown or duplicate output case');
    if (input.source !== 'imported' && !snapshot.application.data.runnerUrl) throw new HttpError(400, 'Application runner required');
    const id = uuid();
    try {
      const minute = Math.floor(Date.now()/60000), rateKey = a.workspace + ':' + accountable(a) + ':' + minute;
      if (abandoned()) return stoppedReply();
      // Pool acquisition is still before mutation. Mark possible mutation only
      // immediately before the acquired client dispatches the unchanged SQL.
      const admitted = await admitAtomic(pool, {rateKey, limit:Number(process.env.MAX_JOBS_PER_MINUTE ?? 1000), id, outboxId:uuid(),workspace:a.workspace,principal:accountable(a),hash,key,input,snapshot}, {
        isAbandoned: abandoned,
        onDispatch: () => { mutationMayHaveStarted = true; checkpoint('admissionDispatched'); },
        observe: s => databaseSpans.push(s),
      });
      if (!admitted) throw new HttpError(429, 'Evaluation admission limit reached');
    } catch (e: any) { if (e.code === '23505') { const raced = await existing(); if (raced) { outcome = 'existing'; return replay(raced); } } throw e; }
    checkpoint('commitAcknowledged'); outcome = 'committed'; if (abandoned()) return stoppedReply();
    return reply.code(202).send({ id, status: 'queued', replayed: false });
    } catch (error: any) {
      if (abandoned()) { outcome = mutationMayHaveStarted ? 'unknown_after_mutation_dispatch' : disconnected() ? 'cancelled_before_mutation' : 'deadline_before_mutation'; return stoppedReply(); }
      if (mutationMayHaveStarted && !(error instanceof HttpError) && error.code !== '23505') { outcome = 'unknown_after_mutation_dispatch'; return reply.code(503).send(unknownSubmission(req.headers['idempotency-key'])); }
      throw error;
    } finally {
      reply.raw.off('close', onClose);
      budget?.dispose();
      if (abandoned() && !mutationMayHaveStarted && outcome === 'before_mutation') outcome = disconnected() ? 'cancelled_before_mutation' : 'deadline_before_mutation';
      app.log.info({ event: 'submission_evaluation_timing', traceId, requestId: req.id, keySha256: keyForLog ? keyHash(keyForLog) : null,
        stages, databaseSpans, deadline: budget?.publicState() ?? null, snapshotFetch: publicFetchTiming(snapshotTiming), registryDeadlineMs: 5000, mutationMayHaveStarted, outcome, totalMs: performance.now() - started }, 'submission evaluation phase evidence');
    }
  });
  app.get('/jobs/submissions/:key', async (req, reply) => {
    const a = await actor(req), { key } = z.object({ key: z.string().regex(/^[-a-zA-Z0-9_]{8,100}$/) }).parse(req.params);
    const row = (await pool.query("SELECT id,status,request_hash AS \"requestHash\",created_at AS \"createdAt\",input->>'source' AS source FROM jobs WHERE workspace=$1 AND idempotency_key=$2", [a.workspace, key])).rows[0];
    // Absence now cannot prove that a previously dispatched request will never
    // commit. This endpoint is read-only and never resends or creates a job.
    if (!row) return reply.code(404).send({ error: 'submission_not_observed', definitive: false, doNotResubmit: true, automaticRetry: false });
    return { submissionState: 'accepted', ...row, doNotResubmit: true, automaticRetry: false };
  });
  app.get('/jobs', async req => {
    const a = await actor(req); const { limit, offset } = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25), offset: z.coerce.number().int().min(0).max(10000).default(0) }).parse(req.query);
    return (await pool.query("SELECT id,status,created_by,created_at,started_at,finished_at,worker_id,input->>'candidate' AS candidate,input->>'source' AS source,result->>'gate' AS gate,result->>'score' AS score FROM jobs WHERE workspace=$1 ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3", [a.workspace, limit, offset])).rows;
  });
  app.get('/jobs/:id', async req => { const a = await actor(req); const { id } = z.object({ id: z.string().uuid() }).parse(req.params); return detail(id, a.workspace); });
  app.get('/internal/jobs/:id', async req => { await internal(req, ['governance']); const { id } = z.object({ id: z.string().uuid() }).parse(req.params); const { workspace } = z.object({ workspace: z.string() }).parse(req.query); return detail(id, workspace); });
}
async function detail(id: string, workspace: string) {
  const row = (await pool.query('SELECT id,workspace,created_by,input,snapshot,status,result,execution,error,attempts,worker_id,created_at,started_at,finished_at FROM jobs WHERE id=$1 AND workspace=$2', [id, workspace])).rows[0];
  if (!row) throw new HttpError(404, 'Job not found'); return row;
}
