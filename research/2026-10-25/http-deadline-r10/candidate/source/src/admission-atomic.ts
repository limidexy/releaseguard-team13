import type { Pool } from 'pg';
import { databaseQuery, type DatabaseBoundary } from './database-evidence.js';

export type Admission = {
  rateKey: string; limit: number; id: string; outboxId: string;
  workspace: string; principal: string; hash: string; key: string;
  input: unknown; snapshot: unknown;
};

// One database statement owns the limit reservation, durable job and durable
// outbox. The contended rate-key row is no longer held across client round trips.
// No larger pool, longer timeout, relaxed limit, retry or early202 is required.
export async function admitAtomic(pool: Pick<Pool, 'connect' | 'totalCount' | 'idleCount' | 'waitingCount'>, a: Admission, boundary: DatabaseBoundary = {}): Promise<boolean> {
  if (!Number.isInteger(a.limit) || a.limit < 1 || a.limit > 1000) throw new Error('Invalid admission limit');
  const result = await databaseQuery(pool, 'admission_atomic', `
    WITH expired AS (
      DELETE FROM admission_limits WHERE expires_at < now()
    ), admitted AS (
      INSERT INTO admission_limits(key,count,expires_at)
      VALUES($1,1,now()+interval '2 minutes')
      ON CONFLICT(key) DO UPDATE SET count=admission_limits.count+1
      WHERE admission_limits.count < $2
      RETURNING key
    ), job AS (
      INSERT INTO jobs(id,workspace,created_by,request_hash,idempotency_key,input,snapshot)
      SELECT $3,$4,$5,$6,$7,$8,$9 FROM admitted
      RETURNING id
    ), published_intent AS (
      INSERT INTO outbox(id,job_id)
      SELECT $10,id FROM job
      RETURNING job_id
    )
    SELECT job_id FROM published_intent`,
  [a.rateKey,a.limit,a.id,a.workspace,a.principal,a.hash,a.key,a.input,a.snapshot,a.outboxId], boundary);
  return result.rows.length === 1;
}
