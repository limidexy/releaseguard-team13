import { server, role, pool } from './common.js';
import { registry } from './registry.js';
import { evaluation } from './evaluation.js';
import { governance } from './governance.js';
import { worker } from './worker.js';
import { gateway } from './gateway.js';
import { support } from './support.js';
import {shutdownTelemetry} from './observability.js';
const app = server();
const initializers: Record<string, (instance: typeof app) => Promise<void>> = { registry, evaluation, governance, worker, gateway, support };
const init = initializers[role]; if (!init) throw new Error('Unknown SERVICE_ROLE');
// Database DDL is owned by each business service, not a cross-service migration.
for (let attempt = 1; ; attempt++) {
  try { await init(app); break; } catch (e) { if (attempt >= 5) throw e; app.log.warn({ error: String(e), attempt }, 'startup dependency unavailable'); await new Promise(r => setTimeout(r, 1000)); }
}
await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 8080) });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { void app.close().then(() => pool.end()).then(()=>shutdownTelemetry()).finally(() => process.exit(0)); });
