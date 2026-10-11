import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { internal, HttpError } from './common.js';
import { caseSchema, type Output } from './domain.js';
import { providerAnswer, promptSnapshot } from './provider.js';
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
  app.post('/execute', async req => {
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
    if (new URL(providerUrl).protocol !== 'https:') throw new HttpError(503, 'Provider requires HTTPS');
    // One bounded sequential request per case; this is a cost-conscious application adapter.
    // Provider quota is shared across replicas and is not increased by adding workers.
    const outputs: Output[] = [];
    const requestMetadata: unknown[] = [];
    for (const c of input.cases) {
      const start = performance.now();
      try {
        const { output, metadata, error } = await providerAnswer({ url: providerUrl, key, model }, input.promptVersion, c.prompt);
        outputs.push({ caseId: c.id, output, ...(error ? { error } : {}), latencyMs: performance.now() - start });
        requestMetadata.push({ caseId: c.id, ...metadata });
      } catch (e) { outputs.push({ caseId: c.id, error: e instanceof Error ? e.message.slice(0, 500) : 'Provider error', latencyMs: performance.now() - start }); }
    }
    return { outputs, provenance: { source: 'real', providerOrigin: new URL(providerUrl).origin, model, promptVersion: input.promptVersion, promptSnapshot: promptSnapshot(input.promptVersion), requestMetadata, executedAt: new Date().toISOString(), trust: 'application_reported_provider_execution' } };
  });
}
