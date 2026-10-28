import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

export type DatabaseOperation = 'existing_lookup' | 'lineage_lookup' | 'admission_atomic' | 'registry_snapshot';
type PoolCounts = { total: number; idle: number; waiting: number };
export type DatabaseSpan = {
  operation: DatabaseOperation;
  // Correlation hints, not proof of SQL/lock/CPU causality. Join a retained
  // server observation from the same database/instance and overlapping window.
  // Wall clocks can differ; durations below remain monotonic.
  operationStartedAtUnixMs: number;
  backendPid: number | null;
  poolAtRequest: PoolCounts;
  poolAtAcquire: PoolCounts | null;
  acquiredMs: number | null;
  queryDispatchedMs: number | null;
  queryCompletedMs: number | null;
  releasedMs: number | null;
  poolWaitMs: number | null;
  databaseRoundTripMs: number | null;
  totalMs: number;
  outcome: 'cancelled_before_dispatch' | 'acquire_failed' | 'query_failed' | 'completed';
};
export type DatabaseBoundary = {
  isAbandoned?: () => boolean;
  onDispatch?: () => void;
  observe?: (span: DatabaseSpan) => void;
};
export class SubmissionAbandonedError extends Error {
  readonly code = 'RG_SUBMISSION_ABANDONED';
  constructor() { super('Request abandoned before database dispatch'); }
}

// Timing covers client-observed intervals. Database round-trip includes any
// server lock, execution and transport wait and must not be called SQL CPU time.
// SQL text, parameters, identities and credentials never enter these spans.
export async function databaseQuery<Row extends QueryResultRow = any>(
  pool: Pick<Pool, 'connect' | 'totalCount' | 'idleCount' | 'waitingCount'>,
  operation: DatabaseOperation, text: string, values: unknown[], boundary: DatabaseBoundary = {},
): Promise<QueryResult<Row>> {
  const started = performance.now();
  const elapsed = () => performance.now() - started;
  const counts = (): PoolCounts => ({ total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount });
  const span: DatabaseSpan = {
    operation, operationStartedAtUnixMs: Date.now(), backendPid: null,
    poolAtRequest: counts(), poolAtAcquire: null,
    acquiredMs: null, queryDispatchedMs: null, queryCompletedMs: null,
    releasedMs: null, poolWaitMs: null, databaseRoundTripMs: null,
    totalMs: 0, outcome: 'acquire_failed',
  };
  let client: PoolClient | undefined;
  let releaseError: Error | undefined;
  let onClientError: ((error: Error) => void) | undefined;
  const check = () => {
    if (boundary.isAbandoned?.()) {
      span.outcome = 'cancelled_before_dispatch';
      throw new SubmissionAbandonedError();
    }
  };
  try {
    check();
    client = await pool.connect();
    // node-postgres supplies this from BackendKeyData. Do not send another
    // query on the hot path, or fabricate a PID when it is unavailable.
    const backendPid = (client as PoolClient & { processID?: unknown }).processID;
    if (typeof backendPid === 'number' && Number.isSafeInteger(backendPid) && backendPid > 0) span.backendPid = backendPid;
    // Pool.query normally owns this listener. Once we explicitly borrow a
    // client, preserve that protection against a broken backend/socket.
    const connectionFailure = new Promise<never>((_resolve, reject) => {
      onClientError = error => { releaseError = error; reject(error); };
    });
    client.on('error', onClientError!);
    span.acquiredMs = elapsed(); span.poolWaitMs = span.acquiredMs;
    span.poolAtAcquire = counts();
    // A Pool.query call would queue its SQL internally. Explicit acquisition
    // lets this boundary recheck cancellation before any SQL can be dispatched.
    check();
    span.outcome = 'query_failed';
    boundary.onDispatch?.();
    span.queryDispatchedMs = elapsed();
    const result = await Promise.race([client.query<Row>(text, values), connectionFailure]);
    span.queryCompletedMs = elapsed();
    span.outcome = 'completed';
    return result;
  } catch (error) {
    if (span.queryDispatchedMs !== null) releaseError ??= error instanceof Error ? error : new Error('Database operation failed');
    throw error;
  } finally {
    if (span.queryDispatchedMs !== null) {
      span.queryCompletedMs ??= elapsed();
      span.databaseRoundTripMs = span.queryCompletedMs - span.queryDispatchedMs;
    }
    if (client) {
      if (onClientError) client.off('error', onClientError);
      client.release(releaseError); span.releasedMs = elapsed();
    }
    span.totalMs = elapsed();
    // Logging must not turn a committed operation into an application failure.
    try { boundary.observe?.(span); } catch { /* no effect on database outcome */ }
  }
}
