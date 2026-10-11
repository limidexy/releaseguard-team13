import type { FastifyInstance } from 'fastify';
import { readFile } from 'node:fs/promises';
import { HttpError } from './common.js';
export async function gateway(app: FastifyInstance) {
  app.get('/', async (_req, reply) => reply.type('text/html').send(await readFile('public/index.html', 'utf8')));
  app.get('/app.js', async (_req, reply) => reply.type('application/javascript').send(await readFile('public/app.js', 'utf8')));
  app.get('/style.css', async (_req, reply) => reply.type('text/css').send(await readFile('public/style.css', 'utf8')));
  app.get('/demo-fixtures.json', async (_req, reply) => reply.type('application/json').send(await readFile('public/demo-fixtures.json', 'utf8')));
  app.addHook('onSend', async (_req, reply) => { reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'").header('Referrer-Policy', 'no-referrer'); });
  app.all('/api/v2/*', async (req, reply) => {
    const tail = req.url.replace(/^\/api\/v2\//, ''), resource = tail.split(/[/?]/)[0];
    const target = ['applications', 'suites'].includes(resource) ? 'registry' : resource === 'jobs' ? 'evaluation' : ['releases', 'evidence'].includes(resource) ? 'governance' : undefined;
    if (!target) throw new HttpError(404, 'Unknown API resource');
    if (!['GET', 'POST'].includes(req.method)) throw new HttpError(405, 'Method not allowed');
    if (req.method === 'POST') {
      if (req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'Cross-site mutation rejected');
      if (req.headers.origin && req.headers.origin !== (process.env.PUBLIC_ORIGIN ?? 'http://localhost:5189')) throw new HttpError(403, 'Origin rejected');
    }
    const base = process.env[target.toUpperCase() + '_URL'];
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (req.headers.authorization) headers.authorization = req.headers.authorization;
    if (req.headers['idempotency-key']) headers['idempotency-key'] = String(req.headers['idempotency-key']);
    const res = await fetch(base + '/' + tail, { method: req.method, headers, body: req.method === 'POST' ? JSON.stringify(req.body) : undefined, signal: AbortSignal.timeout(10000), redirect: 'error' });
    return reply.code(res.status).type('application/json').send(await res.text());
  });
}
