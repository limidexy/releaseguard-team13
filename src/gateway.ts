import { returnsSuiteV30 } from './returns-policy-v30.js';
import { returnsSuiteV29 } from './returns-policy-v29.js';
import { returnsSuiteV28 } from './returns-policy-v28.js';
import { returnsSuiteV27 } from './returns-policy-v27.js';
import type { FastifyInstance } from 'fastify';
import {tracedFetch} from './observability.js';
import { readFile } from 'node:fs/promises';
import { HttpError } from './common.js';
import { revisedReturnsSuite, returnsSuiteV22, returnsSuiteV23, returnsSuiteV24, returnsSuiteV25, returnsSuiteV26 } from './returns-policy.js';
export async function gateway(app: FastifyInstance) {
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
  app.get('/returns-fixtures-v2-3.json', async () => {
    const legacy = JSON.parse(await readFile('public/demo-fixtures.json', 'utf8'));
    const suite = returnsSuiteV23(revisedReturnsSuite(legacy.suite));
    return { application: legacy.application, cases: suite.cases, suite };
  });

  app.get('/returns-fixtures-v2-4.json', async () => {
    const legacy = JSON.parse(await readFile('public/demo-fixtures.json', 'utf8'));
    const suite = returnsSuiteV24(revisedReturnsSuite(legacy.suite));
    return { application: legacy.application, cases: suite.cases, suite };
  });
  app.get('/returns-fixtures-v2-5.json', async () => {
    const legacy = JSON.parse(await readFile('public/demo-fixtures.json', 'utf8'));
    const suite = returnsSuiteV25(revisedReturnsSuite(legacy.suite));
    return { application: legacy.application, cases: suite.cases, suite };
  });
  app.get('/returns-fixtures-v2-6.json', async () => {
    const legacy = JSON.parse(await readFile('public/demo-fixtures.json', 'utf8'));
    const suite = returnsSuiteV26(revisedReturnsSuite(legacy.suite));
    return { application: legacy.application, cases: suite.cases, suite };
  });
  app.get('/returns-fixtures-v2-7.json', async () => {
    const legacy = JSON.parse(await readFile('public/demo-fixtures.json', 'utf8'));
    const suite = returnsSuiteV27(revisedReturnsSuite(legacy.suite));
    return { application: legacy.application, cases: suite.cases, suite };
  });
  app.get('/returns-fixtures-v2-10.json', async () => {
    const legacy = JSON.parse(await readFile('public/demo-fixtures.json', 'utf8'));
    const suite = returnsSuiteV30(revisedReturnsSuite(legacy.suite));
    return { application: legacy.application, cases: suite.cases, suite };
  });
  app.get('/returns-fixtures-v2-9.json', async () => {
    const legacy = JSON.parse(await readFile('public/demo-fixtures.json', 'utf8'));
    const suite = returnsSuiteV29(revisedReturnsSuite(legacy.suite));
    return { application: legacy.application, cases: suite.cases, suite };
  });
  app.get('/returns-fixtures-v2-8.json', async () => {
    const legacy = JSON.parse(await readFile('public/demo-fixtures.json', 'utf8'));
    const suite = returnsSuiteV28(revisedReturnsSuite(legacy.suite));
    return { application: legacy.application, cases: suite.cases, suite };
  });
  app.get('/environment.json', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    // Explicit server configuration, never guessed from hostname or client-side state.
    const environment = process.env.RG_DEPLOYMENT_ENV === 'gcp-trial' ? 'gcp-trial' : process.env.AUTH_MODE === 'dev' ? 'local' : 'unconfirmed';
    return { environment, provider: environment === 'gcp-trial' ? 'Google Cloud / GKE' : null, region: environment === 'gcp-trial' ? 'asia-southeast1' : null, modelApproval: 'See each job; human review required' };
  });
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
    const res = await tracedFetch(target,base + '/' + tail, { method: req.method, headers, body: req.method === 'POST' ? JSON.stringify(req.body) : undefined, signal: AbortSignal.timeout(10000), redirect: 'error' });
    return reply.code(res.status).type('application/json').send(await res.text());
  });
}
