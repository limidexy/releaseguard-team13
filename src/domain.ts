import { z } from 'zod';
export const caseSchema = z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/), name: z.string().min(2).max(100), prompt: z.string().min(1).max(2000), rule: z.enum(['contains', 'not_contains', 'exact', 'json_keys', 'not_empty']), expected: z.string().max(500), critical: z.boolean() }).strict().refine(c => c.rule === 'not_empty' || c.expected.trim().length > 0, 'Expected value required').refine(c => c.rule !== 'json_keys' || c.expected.split(',').every(k => k.trim()), 'JSON keys must be nonempty');
export const policySchema = z.object({ minScore: z.number().min(0).max(100), maxLatencyMs: z.number().int().min(1).max(600000).nullable() }).strict();
export const suiteSchema = z.object({ name: z.string().min(2).max(100), description: z.string().min(5).max(1000), cases: z.array(caseSchema).min(1).max(60), policy: policySchema, parentId: z.string().uuid().optional() }).strict().refine(s => new Set(s.cases.map(c => c.id)).size === s.cases.length, 'Duplicate case IDs');
export const outputSchema = z.object({ caseId: z.string().max(40), output: z.string().max(10000).optional(), latencyMs: z.number().finite().min(0).max(600000).optional(), error: z.string().min(1).max(500).optional() }).strict();
export const jobSchema = z.object({ appId: z.string().uuid(), suiteId: z.string().uuid(), candidate: z.string().min(2).max(100), commitRef: z.string().min(7).max(80).regex(/^[a-zA-Z0-9._/-]+$/), source: z.enum(['imported', 'replay', 'real']), outputs: z.array(outputSchema).max(60).optional(), promptVersion: z.enum(['v1', 'v2']).optional(), scenario: z.enum(['passing', 'failing', 'error']).optional() }).strict().superRefine((v, ctx) => { if (v.source === 'imported' && !v.outputs) ctx.addIssue({ code: 'custom', message: 'Imported jobs require outputs' }); if (v.source !== 'imported' && v.outputs) ctx.addIssue({ code: 'custom', message: 'Application jobs cannot supply outputs' }); });
export type Case = z.infer<typeof caseSchema>;
export type Output = z.infer<typeof outputSchema>;
export function evaluate(cases: Case[], policy: z.infer<typeof policySchema>, outputs: Output[]) {
  if (!cases.length || new Set(cases.map(c => c.id)).size !== cases.length) throw new Error('Invalid case set');
  const byId = new Map(outputs.map(o => [o.caseId, o]));
  if (byId.size !== outputs.length || outputs.some(o => !cases.some(c => c.id === o.caseId))) throw new Error('Duplicate or unknown output ID');
  const results = cases.map(c => {
    const o = byId.get(c.id), actual = o?.output?.trim();
    let status = 'failed', reason = 'Rule failed';
    if (!o || o.error !== undefined || actual === undefined || actual.length === 0 || (policy.maxLatencyMs !== null && o.latencyMs === undefined)) { status = 'error'; reason = o?.error ?? 'Required non-empty evidence missing'; }
    else {
      let passed = false;
      const expected = c.expected.trim();
      if (c.rule === 'contains') passed = actual.toLowerCase().includes(expected.toLowerCase());
      if (c.rule === 'not_contains') passed = !actual.toLowerCase().includes(expected.toLowerCase());
      if (c.rule === 'exact') passed = actual === expected;
      if (c.rule === 'not_empty') passed = actual.length > 0;
      if (c.rule === 'json_keys') { try { const v = JSON.parse(actual); passed = v !== null && typeof v === 'object' && !Array.isArray(v) && expected.split(',').every(k => Object.hasOwn(v, k.trim())); } catch {} }
      if (policy.maxLatencyMs !== null && (o.latencyMs ?? Infinity) > policy.maxLatencyMs) { passed = false; reason = 'Latency exceeds policy'; }
      status = passed ? 'passed' : 'failed'; if (passed) reason = 'Rule passed';
    }
    return { caseId: c.id, critical: c.critical, rule: c.rule, expected: c.expected, output: o?.output ?? null, latencyMs: o?.latencyMs ?? null, status, reason };
  });
  const passed = results.filter(r => r.status === 'passed').length, errors = results.filter(r => r.status === 'error').length;
  const criticalFailures = results.filter(r => r.critical && r.status !== 'passed').length;
  const score = Number((passed * 100 / results.length).toFixed(2));
  return { results, total: results.length, passed, errors, criticalFailures, score, gate: score >= policy.minScore && errors === 0 && criticalFailures === 0 ? 'passed' : 'blocked' };
}
export function reviewAllowed(input: { actor: string; creator: string; requester: string; status: string; gate: string }) {
  return input.status === 'pending' && input.gate === 'passed' && input.actor !== input.creator && input.actor !== input.requester;
}
