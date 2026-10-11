// Sends one fictional question. Reads a local ignored secret; never logs it.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { providerAnswer, promptSnapshot } from '../dist/src/provider.js';
if (process.env.RG_CONFIRM_REAL_CALLS !== '1') throw Error('Set RG_CONFIRM_REAL_CALLS=1 for one real provider request');
const local = parseEnv(await readFile('.env.groq', 'utf8'));
if (!local.MODEL_API_KEY || local.MODEL_API_KEY.includes('PASTE_')) throw Error('Local Groq key not configured');
const question = 'I bought an unused item 10 days ago and have the receipt. Can I return it?';
const model = 'openai/gpt-oss-20b';
const start = performance.now();
const report = { source: 'real', provider: 'Groq', model, createdAt: new Date().toISOString(), question, prompt: promptSnapshot('v2'), scope: 'One real API smoke; not an application, semantic quality, or cloud acceptance claim' };
try {
  Object.assign(report, await providerAnswer({ url: 'https://api.groq.com/openai/v1/chat/completions', key: local.MODEL_API_KEY, model }, 'v2', question));
  if (report.error) process.exitCode = 1;
} catch (e) { report.error = e.message; process.exitCode = 1; }
report.latencyMs = performance.now() - start;
await mkdir('evidence/current', { recursive: true });
const path = `evidence/current/provider-smoke-${Date.now()}.json`;
await writeFile(path, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ path, model, requestId: report.metadata?.requestId, finishReason: report.metadata?.finishReason, error: report.error ?? null, latencyMs: report.latencyMs }));
