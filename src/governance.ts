import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actor, accountable, write, review, pool, transaction, uuid, digest, HttpError, serviceFetch } from './common.js';
import { decideReview } from './contexts/review.js';
export async function governance(app: FastifyInstance) {
  await pool.query(`CREATE TABLE IF NOT EXISTS releases(id uuid PRIMARY KEY,workspace text NOT NULL,job_id uuid NOT NULL UNIQUE,created_by text NOT NULL,requested_by text NOT NULL,status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),version integer NOT NULL DEFAULT 1,evidence jsonb NOT NULL,request_note text NOT NULL,review_note text,reviewed_by text,created_at timestamptz NOT NULL DEFAULT now(),reviewed_at timestamptz);
  CREATE INDEX IF NOT EXISTS releases_workspace ON releases(workspace,created_at DESC);
  CREATE TABLE IF NOT EXISTS audit(seq bigserial PRIMARY KEY,id uuid NOT NULL UNIQUE,workspace text NOT NULL,actor text NOT NULL,action text NOT NULL,entity_id uuid NOT NULL,details jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
  CREATE INDEX IF NOT EXISTS audit_workspace ON audit(workspace,seq DESC);`);
  app.post('/releases', async (req, reply) => {
    const a = await actor(req); write(a); const { jobId, note } = z.object({ jobId: z.string().uuid(), note: z.string().min(5).max(2000) }).strict().parse(req.body);
    const evidence = await serviceFetch('evaluation', '/internal/jobs/' + jobId, a.workspace);
    if (evidence.status !== 'succeeded' || evidence.result?.gate !== 'passed') throw new HttpError(409, 'Completed passing evaluation required');
    const id = uuid(); await transaction(async c => {
      await c.query('INSERT INTO releases(id,workspace,job_id,created_by,requested_by,evidence,request_note) VALUES($1,$2,$3,$4,$5,$6,$7)', [id, a.workspace, jobId, evidence.created_by, accountable(a), evidence, note]);
      await c.query('INSERT INTO audit(id,workspace,actor,action,entity_id,details) VALUES($1,$2,$3,$4,$5,$6)', [uuid(), a.workspace, a.sub, 'ReleaseRequested', id, { jobId, note, evidenceDigest: digest(evidence) }]);
    }); return reply.code(201).send({ id, status: 'pending', version: 1 });
  });
  app.get('/releases', async req => { const a = await actor(req); return (await pool.query('SELECT id,job_id,status,version,requested_by,reviewed_by,created_at FROM releases WHERE workspace=$1 ORDER BY created_at DESC LIMIT 100', [a.workspace])).rows; });
  app.post('/releases/:id/review', async req => {
    const a = await actor(req); review(a); const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const data = z.object({ decision: z.enum(['approved', 'rejected']), note: z.string().min(10).max(2000), version: z.number().int().positive() }).strict().parse(req.body);
    return transaction(async c => {
      const row = (await c.query('SELECT * FROM releases WHERE id=$1 AND workspace=$2 FOR UPDATE', [id, a.workspace])).rows[0];
      if (!row) throw new HttpError(404, 'Release not found');
      const transition = decideReview({ creator: row.created_by, requester: row.requested_by, status: row.status, version: row.version, gate: row.evidence.result.gate }, { actor: a.sub, decision: data.decision, expectedVersion: data.version });
      if (!transition.ok) throw new HttpError(409, transition.reason);
      await c.query('UPDATE releases SET status=$3,version=version+1,review_note=$4,reviewed_by=$5,reviewed_at=now() WHERE id=$1 AND workspace=$2', [id, a.workspace, data.decision, data.note, a.sub]);
      await c.query('INSERT INTO audit(id,workspace,actor,action,entity_id,details) VALUES($1,$2,$3,$4,$5,$6)', [uuid(), a.workspace, a.sub, transition.action, id, { ...data, jobId: row.job_id }]);
      return { id, status: transition.status, version: transition.version };
    });
  });
  app.get('/evidence/:id', async req => {
    const a = await actor(req); const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const release = (await pool.query('SELECT * FROM releases WHERE id=$1 AND workspace=$2', [id, a.workspace])).rows[0]; if (!release) throw new HttpError(404, 'Release not found');
    const audit = (await pool.query('SELECT * FROM audit WHERE entity_id=$1 AND workspace=$2 ORDER BY seq', [id, a.workspace])).rows;
    return { schemaVersion: '2.0', release, audit, evidenceDigest: digest(release.evidence), scope: 'Rule evidence and human decision; no automatic external deployment or cryptographic provenance guarantee' };
  });
}
