import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actor, write, pool, transaction, uuid, HttpError, internal, digest } from './common.js';
import { suiteSchema } from './domain.js';
import { databaseQuery, type DatabaseSpan } from './database-evidence.js';
import { keyHash } from './submission-state.js';
import { configuredClockSkewBound, receiveSubmissionDeadline, InvalidSubmissionDeadlineError,
  SUBMISSION_BUDGET_HEADER, SUBMISSION_KEY_HASH_HEADER } from './submission-deadline.js';
export async function registry(app: FastifyInstance) {
  const clockSkewBoundMs = configuredClockSkewBound(process.env.SUBMISSION_CLOCK_SKEW_BOUND_MS);
  await pool.query(`CREATE TABLE IF NOT EXISTS applications(id uuid PRIMARY KEY,workspace text NOT NULL,data jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
  CREATE INDEX IF NOT EXISTS applications_workspace ON applications(workspace);
  CREATE TABLE IF NOT EXISTS suites(id uuid PRIMARY KEY,workspace text NOT NULL,version integer NOT NULL,parent_id uuid REFERENCES suites(id),data jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
  CREATE INDEX IF NOT EXISTS suites_workspace ON suites(workspace);`);
  app.post('/applications', async (req, reply) => {
    const a = await actor(req); write(a);
    const data = z.object({ name: z.string().min(2).max(100), description: z.string().min(5).max(1000), runnerUrl: z.string().url().optional() }).strict().parse(req.body);
    if (data.runnerUrl && !(process.env.RUNNER_ORIGINS ?? '').split(',').includes(new URL(data.runnerUrl).origin)) throw new HttpError(400, 'Runner origin not allowed');
    const id = uuid(); await pool.query('INSERT INTO applications(id,workspace,data) VALUES($1,$2,$3)', [id, a.workspace, data]); return reply.code(201).send({ id, ...data });
  });
  app.get('/applications', async req => { const a = await actor(req); return (await pool.query('SELECT id,data,created_at FROM applications WHERE workspace=$1 ORDER BY created_at DESC LIMIT 100', [a.workspace])).rows; });
  app.post('/suites', async (req, reply) => {
    const a = await actor(req); write(a); const data = suiteSchema.parse(req.body); const id = uuid();
    const version = await transaction(async c => {
      let version = 1;
      if (data.parentId) { const parent = (await c.query('SELECT version FROM suites WHERE id=$1 AND workspace=$2', [data.parentId, a.workspace])).rows[0]; if (!parent) throw new HttpError(404, 'Parent suite not found'); version = parent.version + 1; }
      await c.query('INSERT INTO suites(id,workspace,version,parent_id,data) VALUES($1,$2,$3,$4,$5)', [id, a.workspace, version, data.parentId ?? null, data]); return version;
    });
    return reply.code(201).send({ id, version, ...data });
  });
  app.get('/suites', async req => { const a = await actor(req); return (await pool.query('SELECT id,version,data,created_at FROM suites WHERE workspace=$1 ORDER BY created_at DESC LIMIT 100', [a.workspace])).rows; });
  app.get('/internal/snapshot/:appId/:suiteId', async (req, reply) => {
    const started = performance.now(), databaseSpans: DatabaseSpan[] = [];
    const traceId = typeof req.headers['x-rg-trace-id'] === 'string' && /^[a-f0-9-]{36}$/.test(req.headers['x-rg-trace-id']) ? req.headers['x-rg-trace-id'] : uuid();
    const closed = new AbortController();
    const onClose = () => { if (!reply.raw.writableFinished) closed.abort(); };
    reply.raw.once('close', onClose);
    let budget: ReturnType<typeof receiveSubmissionDeadline> | undefined;
    const disconnected = () => closed.signal.aborted || reply.raw.destroyed;
    const abandoned = () => disconnected() || Boolean(budget?.expired());
    let snapshotReadyMs: number | null = null;
    try {
    await internal(req, ['evaluation']); const { appId, suiteId } = z.object({ appId: z.string().uuid(), suiteId: z.string().uuid() }).parse(req.params); const { workspace } = z.object({ workspace: z.string().min(1) }).parse(req.query);
    try { budget = receiveSubmissionDeadline(req.headers[SUBMISSION_BUDGET_HEADER], { traceId, method: req.method, route: req.url,
      keySha256: String(req.headers[SUBMISSION_KEY_HASH_HEADER] ?? ''), bodySha256: digest(null), authorizationSha256: keyHash(req.headers.authorization ?? '') },
      process.env.INTERNAL_SECRET, clockSkewBoundMs, undefined, 'registry'); }
    catch (error) { if (error instanceof InvalidSubmissionDeadlineError) throw new HttpError(401, 'Invalid submission deadline context'); throw error; }
    const application = (await databaseQuery(pool, 'registry_application', 'SELECT id,data FROM applications WHERE id=$1 AND workspace=$2', [appId, workspace], { isAbandoned: abandoned, observe: s => databaseSpans.push(s) })).rows[0];
    const suite = (await databaseQuery(pool, 'registry_suite', 'SELECT id,version,data FROM suites WHERE id=$1 AND workspace=$2', [suiteId, workspace], { isAbandoned: abandoned, observe: s => databaseSpans.push(s) })).rows[0];
    if (disconnected()) return reply;
    if (budget.expired()) return reply.code(504).send({ error: 'snapshot_deadline_expired' });
    if (!application || !suite) throw new HttpError(404, 'Application or suite not found');
    snapshotReadyMs = performance.now() - started;
    return { application, suite };
    } catch (error) {
      if (disconnected()) return reply;
      if (budget?.expired()) return reply.code(504).send({ error: 'snapshot_deadline_expired' });
      throw error;
    } finally {
      reply.raw.off('close', onClose);
      budget?.dispose();
      app.log.info({ event: 'submission_registry_timing', traceId, databaseSpans, deadline: budget?.publicState() ?? null, snapshotReadyMs, totalMs: performance.now() - started }, 'snapshot database boundary evidence');
    }
  });
}
