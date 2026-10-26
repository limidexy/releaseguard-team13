import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { internal, HttpError } from './common.js';
import { caseSchema, type Output } from './domain.js';
import { providerAnswer, promptSnapshot } from './provider.js';
import { ProviderStartGate, PROVIDER_START_INTERVAL_MS, REAL_EXECUTION_TIMEOUT_MS } from './provider-lifecycle.js';
const replay: Record<string, string> = {
  eligibility: 'Unused products can be returned within 30 days with a receipt.',
  receipt: 'Please provide a receipt or order reference before eligibility can be checked.',
  damaged: 'For damaged items, escalate to a human support agent with photographs.',
  expired: 'After 30 days, standard returns are not eligible; a human agent can review exceptions.',
  privacy: 'Do not send passwords or full payment card numbers. Use the secure support channel.',
  action: 'I cannot issue a refund or change an order. A human agent must approve any action.',
  missing: 'Please provide purchase date, product condition and proof of purchase.',
  escalation: 'Contact a human support agent for disputed or exceptional cases.',
  format: '{"eligible":false,"reason":"More information required","nextStep":"Contact support"}',
  greeting: 'Hello. I can explain the fictional returns policy and help you contact support.',
};
export async function support(app: FastifyInstance) {
  const starts = new ProviderStartGate();
  app.post('/execute', async (req, reply) => {
    await internal(req, ['worker']);
    const input = z.object({ source: z.enum(['real', 'replay']), promptVersion: z.enum(['v1', 'v2']), scenario: z.enum(['passing', 'failing', 'error']), cases: z.array(caseSchema).min(1).max(60) }).strict().parse(req.body);
    if (input.source === 'replay') {
      const outputs: Output[] = input.cases.map((c, i) => {
        if (!Object.hasOwn(replay, c.id)) return { caseId: c.id, error: 'Replay fixture missing for case ID' };
        if (i === 0 && input.scenario === 'error') return { caseId: c.id, error: 'Explicit replay fixture error' };
        return { caseId: c.id, output: i === 0 && input.scenario === 'failing' ? 'Returns are accepted forever.' : replay[c.id], latencyMs: 0 };
      });
      return { outputs, provenance: { source: 'replay', fixtureVersion: 'fictional-returns-v1', promptVersion: input.promptVersion, trust: 'labelled_static_fixture', latency: '0 denotes no provider call; exclude from model-latency claims' } };
    }
    const key = process.env.MODEL_API_KEY, providerUrl = process.env.MODEL_API_URL, model = process.env.MODEL_ID;
    if (process.env.ALLOW_REAL_MODEL !== 'true' || !key || !providerUrl || !model) throw new HttpError(503, 'Real provider is not enabled/configured; no simulated fallback');
    if (input.cases.length > 10) throw new HttpError(400, 'Real provider run is limited to ten cases by the course budget guard');
    const url = new URL(providerUrl);
    if (url.protocol !== 'https:' || url.username || url.password) throw new HttpError(503, 'Provider requires HTTPS without URL credentials');
    // One bounded sequential request per case; this is a cost-conscious application adapter.
    // Provider quota is shared across replicas and is not increased by adding workers.
    const outputs: Output[] = [];
    const requestMetadata: unknown[] = [];
    const controller = new AbortController(), deadline = performance.now() + REAL_EXECUTION_TIMEOUT_MS;
    const stop = () => controller.abort(new DOMException('Provider execution cancelled or deadline expired', 'AbortError'));
    const onClose = () => { if (!reply.raw.writableFinished) stop(); };
    reply.raw.once('close', onClose);
    const timer = setTimeout(stop, REAL_EXECUTION_TIMEOUT_MS);
    let stopped = false, dispatched = 0;
    const checkpoint = () => { if (reply.raw.destroyed || performance.now() >= deadline) stop(); controller.signal.throwIfAborted(); };
    try {
    for (const c of input.cases) {
      if (stopped || controller.signal.aborted) {
        const error = 'Provider case not sent: execution stopped';
        outputs.push({ caseId: c.id, error }); requestMetadata.push({ caseId: c.id, attempted: false, error, requestId: null, finishReason: null, usage: {} }); continue;
      }
      let attempted = false, callStarted: number | undefined;
      try {
        checkpoint(); await starts.wait(controller.signal); checkpoint();
        callStarted = performance.now();
        const { output, metadata, error } = await providerAnswer({ url: providerUrl, key, model }, input.promptVersion, c.prompt,
          (target, options) => { attempted = true; dispatched++; return fetch(target, options); }, controller.signal);
        if (performance.now() >= deadline) stop();
        const evidenceError = error ?? (controller.signal.aborted ? 'Provider execution deadline expired; incomplete evidence' : undefined);
        outputs.push({ caseId: c.id, output, ...(evidenceError ? { error: evidenceError } : {}), latencyMs: performance.now() - callStarted });
        requestMetadata.push({ caseId: c.id, attempted, ...metadata });
      } catch (e) {
        // Never return private URL, credential, response-body or JSON parse fragments.
        const error = e instanceof Error && /^Provider (HTTP \d{3}$|response (?:body missing|exceeds size limit)$|local start queue full$)/.test(e.message) ? e.message : e instanceof Error && ['TimeoutError', 'AbortError'].includes(e.name) ? 'Provider request cancelled or timed out' : 'Provider transport or JSON parse error';
        outputs.push({ caseId: c.id, error, ...(attempted ? { latencyMs: performance.now() - callStarted! } : {}) });
        requestMetadata.push({ caseId: c.id, attempted, error, requestId: null, finishReason: null, usage: {} }); stopped = true;
      }
    }
    } finally {
      clearTimeout(timer); reply.raw.off('close', onClose);
      app.log.info({ event: 'provider_execution_end', dispatched, returnedCases: outputs.length, cancelled: controller.signal.aborted, stopped }, 'bounded provider execution evidence');
    }
    if (reply.raw.destroyed) return reply;
    return { outputs, provenance: { source: 'real', providerOrigin: url.origin, model, promptVersion: input.promptVersion, promptSnapshot: promptSnapshot(input.promptVersion), requestMetadata, minimumStartIntervalMs: PROVIDER_START_INTERVAL_MS, executionBudgetMs: REAL_EXECUTION_TIMEOUT_MS, stopped: stopped || controller.signal.aborted, executedAt: new Date().toISOString(), trust: 'application_reported_provider_execution' } };
  });
}
