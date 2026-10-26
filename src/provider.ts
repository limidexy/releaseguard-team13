import { createHash } from 'node:crypto';
import { PROVIDER_MAX_OUTPUT_TOKENS, PROVIDER_REQUEST_TIMEOUT_MS } from './provider-lifecycle.js';

export const promptTemplates = {
  v1: 'You are a retail support assistant. Help the customer with returns. Fictional policy: unused items within 30 days with receipt. Escalate damaged items and exceptions.',
  v2: 'You explain a fictional retail returns policy. Unused products may be returned within 30 days with a receipt. Ask for purchase date, condition and receipt if missing. Escalate damaged items, disputes and exceptions to a human support agent. Never claim to issue refunds or alter orders. Never request passwords or card numbers. If asked for JSON, return eligible, reason, nextStep. Do not invent policy facts.',
};
export function promptSnapshot(version: keyof typeof promptTemplates) {
  const text = promptTemplates[version];
  return { version, text, sha256: createHash('sha256').update(text).digest('hex'), maxOutputTokens: PROVIDER_MAX_OUTPUT_TOKENS, requestTimeoutMs: PROVIDER_REQUEST_TIMEOUT_MS };
}
export async function boundedJson(response: Response, maxBytes = 100000, signal?: AbortSignal) {
  if (!response.body) throw new Error('Provider response body missing');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let bytes = 0;
  const onAbort = () => { void reader.cancel(signal?.reason).catch(() => {}); };
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();
  try {
    signal?.throwIfAborted();
    while (true) {
      const { value, done } = await reader.read(); signal?.throwIfAborted(); if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); throw new Error('Provider response exceeds size limit'); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { signal?.removeEventListener('abort', onAbort); reader.releaseLock(); }
}
export async function providerAnswer(config: { url: string; key: string; model: string }, prompt: keyof typeof promptTemplates, question: string, fetcher: typeof fetch = fetch, parentSignal?: AbortSignal) {
  const url = new URL(config.url);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Provider requires HTTPS without URL credentials');
  const snapshot = promptSnapshot(prompt);
  const deadline = performance.now() + snapshot.requestTimeoutMs;
  const signal = AbortSignal.any([AbortSignal.timeout(snapshot.requestTimeoutMs), ...(parentSignal ? [parentSignal] : [])]);
  signal.throwIfAborted();
  const response = await fetcher(url, {
    method: 'POST', headers: { authorization: 'Bearer ' + config.key, 'content-type': 'application/json' },
    signal, redirect: 'error',
    body: JSON.stringify({ model: config.model, messages: [{ role: 'system', content: snapshot.text }, { role: 'user', content: question }], max_completion_tokens: snapshot.maxOutputTokens }),
  });
  if (performance.now() >= deadline) {
    await response.body?.cancel().catch(() => {});
    throw new DOMException('Provider request timed out', 'TimeoutError');
  }
  if (!response.ok) { await response.body?.cancel(); throw new Error('Provider HTTP ' + response.status); }
  const body = await boundedJson(response, 100000, signal);
  const output = body?.choices?.[0]?.message?.content;
  // Capture only bounded, known metadata. Provider error bodies may contain private data.
  const usage: Record<string, number> = {};
  for (const field of ['prompt_tokens', 'completion_tokens', 'total_tokens']) {
    const n = body?.usage?.[field]; if (Number.isSafeInteger(n) && n >= 0) usage[field] = n;
  }
  const finishReason = typeof body?.choices?.[0]?.finish_reason === 'string' ? body.choices[0].finish_reason.slice(0, 80) : null;
  const valid = typeof output === 'string' && output.trim().length > 0 && output.length <= 10000;
  const error = finishReason === 'length' ? 'Provider answer truncated at token limit; incomplete evidence' : !valid ? 'Provider response contract invalid: nonempty text answer required (max 10000 characters)' : finishReason && finishReason !== 'stop' ? 'Provider did not finish a text answer' : performance.now() >= deadline ? 'Provider request timed out; incomplete evidence' : undefined;
  return { ...(typeof output === 'string' && output.length <= 10000 ? { output } : {}), ...(error ? { error } : {}), metadata: { requestId: typeof body?.id === 'string' ? body.id.slice(0, 200) : null, reportedModel: typeof body?.model === 'string' ? body.model.slice(0, 200) : null, finishReason, usage, httpStatus: response.status, contentType: typeof output, contentCharacters: typeof output === 'string' ? output.length : null } };
}
