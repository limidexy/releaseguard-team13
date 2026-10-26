import type { FastifyInstance } from 'fastify';
import { readFile } from 'node:fs/promises';
import { HttpError, uuid, digest } from './common.js';
import { installFetchTiming, newFetchTiming, withinFetch, publicFetchTiming, unknownSubmission, validSubmissionKey, keyHash } from './submission-state.js';
import { SubmissionTransport } from './submission-transport.js';
import { createSubmissionDeadline, SUBMISSION_BUDGET_HEADER, SUBMISSION_BUDGET_MS } from './submission-deadline.js';
import { revisedReturnsSuite, returnsSuiteV22 } from './returns-policy.js';
export async function gateway(app: FastifyInstance) {
  installFetchTiming(app);
  const submissions = new SubmissionTransport(16);
  app.addHook('onClose', async () => submissions.close());
  app.get('/', async (_req, reply) => reply.type('text/html').send(await readFile('public/index.html', 'utf8')));
  app.get('/app.js', async (_req, reply) => reply.type('application/javascript').send(await readFile('public/app.js', 'utf8')));
  app.get('/style.css', async (_req, reply) => reply.type('text/css').send(await readFile('public/style.css', 'utf8')));
  app.get('/demo-fixtures.json', async (_req, reply) => reply.type('application/json').send(await readFile('public/demo-fixtures.json', 'utf8')));
  app.get('/returns-fixtures-v2.json', async () => {
    const legacy = JSON.parse(await readFile('public/demo-fixtures.json', 'utf8'));
    const suite = revisedReturnsSuite(legacy.suite);
    return { application: legacy.application, cases: suite.cases, suite };
  });
  app.get('/returns-fixtures-v2-2.json', async () => {
    const legacy = JSON.parse(await readFile('public/demo-fixtures.json', 'utf8'));
    const suite = returnsSuiteV22(legacy.suite);
    return { application: legacy.application, cases: suite.cases, suite };
  });
  app.addHook('onSend', async (_req, reply) => { reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'").header('Referrer-Policy', 'no-referrer'); });
  app.all('/api/v2/*', async (req, reply) => {
    const entryMonotonic = performance.now(), entryEpochMs = Date.now();
    const tail = req.url.replace(/^\/api\/v2\//, ''), resource = tail.split(/[/?]/)[0];
    const target = ['applications', 'suites'].includes(resource) ? 'registry' : resource === 'jobs' ? 'evaluation' : ['releases', 'evidence'].includes(resource) ? 'governance' : undefined;
    if (!target) throw new HttpError(404, 'Unknown API resource');
    if (!['GET', 'POST'].includes(req.method)) throw new HttpError(405, 'Method not allowed');
    if (req.method === 'POST') {
      if (req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'Cross-site mutation rejected');
      if (req.headers.origin && req.headers.origin !== (process.env.PUBLIC_ORIGIN ?? 'http://localhost:5189')) throw new HttpError(403, 'Origin rejected');
    }
    const base = process.env[target.toUpperCase() + '_URL'];
    if (!base) throw new HttpError(503, 'Service endpoint unavailable');
    const upstream = new URL(base + '/' + tail);
    // Bind the exact path sent by Node's HTTP client, after URL normalization
    // (including an empty query marker or Unicode in the original request).
    const upstreamPath = upstream.pathname + upstream.search;
    // Only public headers are forwarded; external internal-context headers are
    // ignored and the submission signature is always issued by this gateway.
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (req.headers.authorization) headers.authorization = req.headers.authorization;
    if (req.headers['idempotency-key']) headers['idempotency-key'] = String(req.headers['idempotency-key']);
    const isSubmission = req.method === 'POST' && upstream.pathname === '/jobs', traceId = uuid(), closed = new AbortController(), timing = newFetchTiming();
    headers['x-rg-trace-id'] = traceId;
    const onClose = () => { if (!reply.raw.writableFinished) closed.abort(); };
    reply.raw.once('close', onClose);
    let status: number | null = null, outcome = 'before_forwarding', submissionAttempted = false;
    const transportTiming = isSubmission ? submissions.timing() : null;
    try {
      if (isSubmission) headers[SUBMISSION_BUDGET_HEADER] = createSubmissionDeadline({ traceId, method: req.method, route: upstreamPath,
        keySha256: keyHash(String(req.headers['idempotency-key'] ?? '')), bodySha256: digest(req.body ?? null),
        authorizationSha256: keyHash(req.headers.authorization ?? '') }, process.env.INTERNAL_SECRET, entryEpochMs);
      const remaining = SUBMISSION_BUDGET_MS - (performance.now() - entryMonotonic);
      if (remaining <= 0) throw new Error('Submission deadline expired before forwarding');
      const signal = AbortSignal.any([AbortSignal.timeout(Math.ceil(remaining)), closed.signal]);
      const requestBody = req.method === 'POST' ? JSON.stringify(req.body ?? null) : undefined;
      let res: { status: number; text: () => Promise<string> };
      if (isSubmission) {
        submissionAttempted = true;
        res = await submissions.submit(upstream.href, headers, requestBody!, signal, timing, transportTiming!);
      } else {
        res = await withinFetch(timing, () => fetch(upstream.href, { method: req.method, headers, body: requestBody, signal, redirect: 'error' }));
      }
      status = res.status; const body = await res.text();
      // A busy event loop may deliver the response callback before an overdue
      // timeout callback; the original monotonic budget still governs it.
      if (isSubmission && performance.now() - entryMonotonic >= SUBMISSION_BUDGET_MS) throw new Error('Submission response exceeded deadline');
      outcome = 'response_received';
      if (reply.raw.destroyed) return reply;
      return reply.code(res.status).type('application/json').send(body);
    } catch (error) {
      outcome = closed.signal.aborted ? 'downstream_closed' : submissionAttempted ? 'transport_outcome_unknown' : 'before_forwarding_failed';
      if (reply.raw.destroyed) return reply;
      // A timeout cannot undo a transaction already committed upstream. Do not
      // issue another POST, claim rejection, or convert a lookup into202.
      if (submissionAttempted) return reply.code(504).send(unknownSubmission(req.headers['idempotency-key']));
      throw error;
    } finally {
      reply.raw.off('close', onClose);
      if (isSubmission) app.log.info({ event: 'submission_gateway_timing', traceId, requestId: req.id,
        keySha256: validSubmissionKey(req.headers['idempotency-key']) ? keyHash(req.headers['idempotency-key']) : null,
        deadlineMs: SUBMISSION_BUDGET_MS, status, outcome, totalMs: performance.now() - timing.started, fetch: publicFetchTiming(timing), transport: transportTiming }, 'submission gateway phase evidence');
    }
  });
}
