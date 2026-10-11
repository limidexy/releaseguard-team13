import { randomUUID } from 'node:crypto';
export const base = process.env.RELEASEGUARD_URL ?? 'http://localhost:5189';
export async function request(path, token, body, key) {
  const response = await fetch(base + '/api/v2/' + path, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(key ? { 'idempotency-key': key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  return { status: response.status, data: await response.json() };
}
export async function required(path, token, body, key) { const r = await request(path, token, body, key); if (r.status >= 400) throw new Error(`${path}: HTTP ${r.status} ${JSON.stringify(r.data)}`); return r.data; }
export async function completed(id, token, timeout = 120000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const j = await required('jobs/' + id, token); if (['succeeded', 'failed'].includes(j.status)) return j; await new Promise(r => setTimeout(r, 150)); }
  throw new Error('Job completion deadline exceeded: ' + id);
}
export const key = () => randomUUID();
