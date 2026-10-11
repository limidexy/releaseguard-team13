import { createHash } from 'node:crypto';

export const promptTemplates = {
  v1: 'You are a retail support assistant. Help the customer with returns. Fictional policy: unused items within 30 days with receipt. Escalate damaged items and exceptions.',
  v2: 'You explain a fictional retail returns policy. Unused products may be returned within 30 days with a receipt. Ask for purchase date, condition and receipt if missing. Escalate damaged items, disputes and exceptions to a human support agent. Never claim to issue refunds or alter orders. Never request passwords or card numbers. If asked for JSON, return eligible, reason, nextStep. Do not invent policy facts.',
};
export function promptSnapshot(version: keyof typeof promptTemplates) {
  const text = promptTemplates[version];
  return { version, text, sha256: createHash('sha256').update(text).digest('hex'), maxOutputTokens: 300 };
}
export async function boundedJson(response: Response, maxBytes = 100000) {
  if (!response.body) throw new Error('Provider response body missing');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); throw new Error('Provider response exceeds size limit'); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { reader.releaseLock(); }
}
export async function providerAnswer(config: { url: string; key: string; model: string }, prompt: keyof typeof promptTemplates, question: string, fetcher: typeof fetch = fetch) {
  const url = new URL(config.url);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Provider requires HTTPS without URL credentials');
  const snapshot = promptSnapshot(prompt);
  const response = await fetcher(url, {
    method: 'POST', headers: { authorization: 'Bearer ' + config.key, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(8000), redirect: 'error',
    body: JSON.stringify({ model: config.model, messages: [{ role: 'system', content: snapshot.text }, { role: 'user', content: question }], max_tokens: snapshot.maxOutputTokens }),
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error('Provider HTTP ' + response.status); }
  const body = await boundedJson(response);
  const output = body.choices?.[0]?.message?.content;
  if (typeof output !== 'string' || !output.trim() || output.length > 10000) throw new Error('Provider response contract invalid');
  // Capture only bounded, known metadata. Provider error bodies may contain private data.
  const usage: Record<string, number> = {};
  for (const field of ['prompt_tokens', 'completion_tokens', 'total_tokens']) {
    const n = body.usage?.[field]; if (Number.isSafeInteger(n) && n >= 0) usage[field] = n;
  }
  return { output, metadata: { requestId: typeof body.id === 'string' ? body.id.slice(0, 200) : null, reportedModel: typeof body.model === 'string' ? body.model.slice(0, 200) : null, usage } };
}
