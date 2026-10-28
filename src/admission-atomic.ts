import type { Pool } from 'pg';
import { databaseQuery, type DatabaseBoundary } from './database-evidence.js';

export type Admission = {
  rateKey: string; limit: number; id: string; outboxId: string;
  workspace: string; principal: string; hash: string; key: string;
  input: unknown; snapshot: unknown;
};

// The VOLATILE database function uses separate READ COMMITTED snapshots when a
// concurrent first initializer commits. The slot, job and outbox still belong
// to this one outer statement/transaction. No client-side retry or early202.
// A cold rollout must drain legacy writers first: old and new quota algorithms
// must not serve the same minute concurrently. Existing legacy usage is kept.
export async function admitAtomic(pool: Pick<Pool, 'connect' | 'totalCount' | 'idleCount' | 'waitingCount'>, a: Admission, boundary: DatabaseBoundary = {}): Promise<boolean> {
  if (!Number.isSafeInteger(a.limit) || a.limit < 0 || a.limit > 10000) throw new Error('Invalid admission limit (supported: 0..10000)');
  // A configured zero keeps the existing stop-admission behavior without
  // borrowing a connection or dispatching a statement that cannot admit a job.
  if (a.limit === 0) return false;
  const result = await databaseQuery(pool, 'admission_atomic', `
    WITH admitted AS MATERIALIZED (
      SELECT claimed_slot FROM claim_admission_slot_v1($1,$2)
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
