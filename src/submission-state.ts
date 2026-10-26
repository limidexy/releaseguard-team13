import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { channel } from 'node:diagnostics_channel';
import type { FastifyInstance } from 'fastify';

export const validSubmissionKey = (v: unknown): v is string => typeof v === 'string' && /^[-a-zA-Z0-9_]{8,100}$/.test(v);
export const keyHash = (key: string) => createHash('sha256').update(key).digest('hex');
export function unknownSubmission(key: unknown) {
  const known = validSubmissionKey(key);
  return { error: 'submission_outcome_unknown', submissionState: 'unknown',
    idempotencyKey: known ? key : null, statusUrl: known ? '/api/v2/jobs/submissions/' + encodeURIComponent(key) : null,
    doNotResubmit: true, automaticRetry: false };
}
export type FetchTiming = { started: number; requestCreatedMs: number | null; headersSentMs: number | null; bodySentMs: number | null; responseHeadersMs: number | null; responseCompleteMs: number | null };
const scope = new AsyncLocalStorage<FetchTiming>();
export const newFetchTiming = (): FetchTiming => ({ started: performance.now(), requestCreatedMs: null, headersSentMs: null, bodySentMs: null, responseHeadersMs: null, responseCompleteMs: null });
export const withinFetch = <T>(timing: FetchTiming, f: () => T): T => scope.run(timing, f);
export const publicFetchTiming = ({ started: _started, ...values }: FetchTiming) => values;
// Observe only timing, never request headers, tokens, bodies or response content.
// Missing diagnostics remain null. Body-sent is not server receipt or commit.
export function installFetchTiming(app: FastifyInstance) {
  const requests = new WeakMap<object, FetchTiming>();
  const events: [string, (message: any) => void][] = [
    ['create', ({ request }) => { const t = scope.getStore(); if (t && request && typeof request === 'object') { requests.set(request, t); t.requestCreatedMs = performance.now() - t.started; } }],
    ['bodySent', ({ request }) => { const t = requests.get(request); if (t) t.bodySentMs = performance.now() - t.started; }],
    ['headers', ({ request }) => { const t = requests.get(request); if (t) t.responseHeadersMs = performance.now() - t.started; }],
    ['trailers', ({ request }) => { const t = requests.get(request); if (t) t.responseCompleteMs = performance.now() - t.started; }],
  ];
  for (const [name, listener] of events) channel('undici:request:' + name).subscribe(listener);
  const sent = ({ request }: any) => { const t = requests.get(request); if (t) t.headersSentMs = performance.now() - t.started; };
  channel('undici:client:sendHeaders').subscribe(sent);
  app.addHook('onClose', async () => { for (const [name, listener] of events) channel('undici:request:' + name).unsubscribe(listener); channel('undici:client:sendHeaders').unsubscribe(sent); });
}
