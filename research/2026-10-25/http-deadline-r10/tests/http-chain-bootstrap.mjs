import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

// Test-only IPC controls: no new HTTP control routes and no Worker/Support imports.
const config = await new Promise(resolve => process.once('message', resolve));
if (!['gateway', 'evaluation', 'registry'].includes(config.role)) throw Error('Isolated HTTP role required');
if (!config.env.DATABASE_URL.includes('@127.0.0.1:') || !config.env.AMQP_URL.includes('@127.0.0.1:')) throw Error('Loopback dependencies required');
Object.assign(process.env, config.env, { SERVICE_ROLE: config.role, ALLOW_REAL_MODEL: 'false', MODEL_API_KEY: '', MODEL_API_URL: '', MODEL_ID: '', SUBMISSION_CLOCK_SKEW_BOUND_MS: '0' });
const { server, pool } = await import(pathToFileURL(config.source + '/dist/src/common.js'));
const module = await import(pathToFileURL(config.source + '/dist/src/' + config.role + '.js'));
const emit = value => process.send?.({ role: config.role, ...value });
const keyHash = key => typeof key === 'string' ? createHash('sha256').update(key).digest('hex') : null;
const originalConnect = pool.connect.bind(pool), held = [], wrapped = new WeakSet();
pool.on('acquire', client => {
  if (wrapped.has(client)) return; wrapped.add(client);
  const query = client.query.bind(client);
  client.query = function (...args) {
    const text = typeof args[0] === 'string' ? args[0] : args[0]?.text ?? '';
    if (/INSERT INTO admission_limits/.test(text)) emit({ event: 'admission_sql_dispatch' });
    if (/SELECT id,data FROM applications/.test(text)) emit({ event: 'registry_application_sql_dispatch' });
    return query(...args);
  };
});
pool.connect = function (...args) {
  // The native async stack identifies only the fixed operation, not SQL/values.
  const admission = /admitAtomic/.test(new Error().stack ?? '');
  if (admission) emit({ event: 'admission_pool_requested' });
  return originalConnect(...args);
};
const app = server();
app.addHook('onRequest', async (req, reply) => {
  const submission = req.method === 'POST' && /^\/(?:api\/v2\/)?jobs(?:\?|$)/.test(req.url);
  const snapshot = req.method === 'GET' && /^\/internal\/snapshot\//.test(req.url);
  if (!submission && !snapshot) return;
  const internalHash = req.headers['x-rg-submission-key-sha256'];
  const hash = snapshot && typeof internalHash === 'string' && /^[a-f0-9]{64}$/.test(internalHash) ? internalHash : keyHash(req.headers['idempotency-key']);
  const trace = req.headers['x-rg-trace-id'];
  const traceId = typeof trace === 'string' && /^[a-f0-9-]{36}$/.test(trace) ? trace : null;
  const kind = snapshot ? 'registry_snapshot' : 'submission';
  emit({ event: 'http_request', kind, keySha256: hash, traceId });
  reply.raw.once('close', () => emit({ event: 'http_close', kind, keySha256: hash, traceId, writableFinished: reply.raw.writableFinished }));
});
await module[config.role](app);
await app.listen({ host: '127.0.0.1', port: 0 });
emit({ event: 'ready', port: app.server.address().port });
process.on('message', async message => {
  const id = message?.id;
  try {
    if (message?.action === 'hold_pool') {
      for (let i = 0; i < 8; i++) held.push(await originalConnect());
      emit({ event: 'control_result', id, action: message.action, held: held.length });
    } else if (message?.action === 'release_pool') {
      while (held.length) held.pop().release();
      emit({ event: 'control_result', id, action: message.action, held: 0 });
    } else if (message?.action === 'pool_stats') {
      emit({ event: 'control_result', id, action: message.action, total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount });
    }
  } catch (error) { emit({ event: 'control_error', id, action: message?.action, message: error.message }); }
});
let stopping = false;
process.on('SIGTERM', () => {
  if (stopping) return; stopping = true;
  while (held.length) held.pop().release();
  void app.close().then(() => pool.end()).finally(() => process.exit(0));
});
