import { randomBytes } from 'node:crypto';
import { writeFile, access } from 'node:fs/promises';
try { await access('.env'); console.log('Existing .env retained.'); }
catch {
  const keys = ['AUTH_SECRET', 'INTERNAL_SECRET', 'POSTGRES_PASSWORD', 'REGISTRY_DB_PASSWORD', 'EVALUATION_DB_PASSWORD', 'GOVERNANCE_DB_PASSWORD', 'RABBIT_PASSWORD'];
  await writeFile('.env', keys.map(k => `${k}=${randomBytes(32).toString('hex')}`).join('\n') + '\n', { mode: 0o600 });
  console.log('Generated local-only .env. Credentials were not printed. Never commit this file.');
}
