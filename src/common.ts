import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import pg, { type PoolClient } from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';
import {initializeTelemetry,attachRequestTracing,traceFields,tracedFetch} from './observability.js';

export const role = process.env.SERVICE_ROLE ?? 'gateway';
initializeTelemetry(role);
export const uuid = () => randomUUID();
export const digest = (v: unknown) => createHash('sha256').update(canonical(v)).digest('hex');
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => JSON.stringify(k) + ':' + canonical(x)).join(',') + '}';
  return JSON.stringify(v);
}
export class HttpError extends Error { constructor(public statusCode: number, message: string) { super(message); } }
export type Actor = { sub: string; workspace: string; role: 'owner' | 'contributor' | 'reviewer' | 'viewer'; service: boolean; principal?: string };
export const actorSchema = z.object({ sub: z.string().min(1).max(150), workspace: z.string().min(1).max(100), role: z.enum(['owner', 'contributor', 'reviewer', 'viewer']), service: z.boolean().default(false), principal: z.string().min(1).max(150).optional() }).refine(a => !a.service || Boolean(a.principal), 'Service identity requires issuer-bound accountable principal');
export const accountable = (a: Actor) => a.service ? a.principal! : a.sub;
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8, connectionTimeoutMillis: 3000, statement_timeout: 5000 });
pool.on('error', (e) => console.error(JSON.stringify({ event: 'database_pool_error', error: e.message })));
const authMode = process.env.AUTH_MODE ?? 'oidc';
if (!['dev','oidc'].includes(authMode)) throw new Error('AUTH_MODE must be dev or oidc');
const secret = new TextEncoder().encode(process.env.AUTH_SECRET ?? '');
if (authMode === 'dev' && (process.env.ALLOW_DEV_AUTH !== 'true' || secret.length < 32)) throw new Error('Development JWT requires ALLOW_DEV_AUTH=true and a >=32-character AUTH_SECRET');
if (authMode === 'oidc' && (!process.env.OIDC_JWKS_URL || !process.env.AUTH_ISSUER || new URL(process.env.OIDC_JWKS_URL).protocol !== 'https:')) throw new Error('Cloud identity requires HTTPS OIDC_JWKS_URL and AUTH_ISSUER');
const jwks = authMode === 'oidc' && process.env.OIDC_JWKS_URL ? createRemoteJWKSet(new URL(process.env.OIDC_JWKS_URL)) : undefined;
export async function actor(req: FastifyRequest): Promise<Actor> {
  const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new HttpError(401, 'Bearer token required');
  try {
    const { payload } = await jwtVerify(token, authMode === 'dev' ? secret : jwks ?? (() => { throw new Error('OIDC not configured'); })(), {
      issuer: process.env.AUTH_ISSUER ?? 'releaseguard-local', audience: 'releaseguard', algorithms: authMode === 'dev' ? ['HS256'] : ['RS256'],
    });
    return actorSchema.parse(payload);
  } catch { throw new HttpError(401, 'Invalid or expired identity'); }
}
export function write(a: Actor) { if (!['owner', 'contributor'].includes(a.role)) throw new HttpError(403, 'Write role required'); }
export function review(a: Actor) { if (a.service || !['owner', 'reviewer'].includes(a.role)) throw new HttpError(403, 'Human reviewer required'); }
export async function transaction<T>(f: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { await c.query('BEGIN'); const result = await f(c); await c.query('COMMIT'); return result; }
  catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}
export async function internalHeader(target: string) {
  const key = process.env.INTERNAL_SECRET;
  if (!key || key.length < 32) throw new Error('INTERNAL_SECRET must be >=32 characters');
  const token = await new SignJWT({ caller: role }).setProtectedHeader({ alg: 'HS256' }).setIssuer('releaseguard-services').setAudience(target).setIssuedAt().setExpirationTime('30s').sign(new TextEncoder().encode(key));
  return { authorization: 'Bearer ' + token };
}
export async function internal(req: FastifyRequest, permitted: string[]) {
  try {
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token) throw new Error('no token');
    const { payload } = await jwtVerify(token, new TextEncoder().encode(process.env.INTERNAL_SECRET ?? ''), { issuer: 'releaseguard-services', audience: role, algorithms: ['HS256'] });
    if (!permitted.includes(String(payload.caller))) throw new Error('caller forbidden');
  } catch { throw new HttpError(401, 'Service authentication failed'); }
}
export async function serviceFetch(target: string, path: string, workspace: string) {
  const url = process.env[target.toUpperCase() + '_URL'];
  if (!url) throw new HttpError(503, 'Service endpoint unavailable');
  const res = await tracedFetch(target,url + path + '?workspace=' + encodeURIComponent(workspace), { headers: await internalHeader(target), signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new HttpError(res.status === 404 ? 404 : 503, 'Upstream service unavailable or record not found');
  return res.json() as Promise<any>;
}
export function server(): FastifyInstance {
  const app = Fastify({ disableRequestLogging:true, logger: { level: 'info',
    base:{service:role},mixin:()=>traceFields(),
    redact: ['req.headers.authorization', 'req.headers.cookie','authorization','cookie','password','apiKey','token','body'],
    serializers:{req:req=>({method:req.method}),err:()=>({type:'operation_error',message:'redacted',stack:''})}
  }, bodyLimit: 500000, requestTimeout: 30000 });
  attachRequestTracing(app,role);
  const requests = new Map<string, number>();
  app.addHook('onResponse', async (req, reply) => { const key = `${req.method}:${req.routeOptions.url ?? 'unmatched'}:${reply.statusCode}`; requests.set(key, (requests.get(key) ?? 0) + 1); });
  app.addHook('onSend', async (_req, reply) => { reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff'); });
  app.setErrorHandler((error: any, _req, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ error: 'validation_error', details: error.issues.map(i => ({ path: i.path, message: i.message })) });
    if (error.code === '23505') return reply.code(409).send({ error: 'conflicting_record' });
    const status = error.statusCode ?? 503;
    if (status >= 500) app.log.error({ event:'request_failed',status }, 'request failed');
    return reply.code(status).send({ error: status >= 500 ? 'service_unavailable' : error.message });
  });
  app.get('/health/live', async () => ({ status: 'alive', service: role }));
  app.get('/health/ready', async () => { if (['registry', 'evaluation', 'governance', 'worker'].includes(role)) await pool.query('SELECT 1'); return { status: 'ready', service: role }; });
  app.get('/metrics', async (req, reply) => { await internal(req, ['monitor']); return reply.type('text/plain').send([...requests].map(([k, n]) => { const [m, p, s] = k.split(':'); return `releaseguard_http_requests_total{service="${role}",method="${m}",route="${p}",status="${s}"} ${n}`; }).join('\n') + '\n'); });
  return app;
}
