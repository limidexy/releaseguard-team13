// Offline child-process boundary. Never falls through to a real provider or socket.
import fs from 'node:fs/promises';
import net from 'node:net';
import child from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { resolve } from 'node:path';

const suppliedRoot = resolve(process.env.RG_SMOKE_FIXTURE_ROOT ?? '');
if (!/[/\\]rg-provider-smoke-[^/\\]+$/.test(suppliedRoot)) throw Error('Invalid owned smoke fixture');
// macOS may canonicalize /tmp to /private/tmp when loading the copied module.
const root = await fs.realpath(suppliedRoot);
const readFile = fs.readFile.bind(fs), open = fs.open.bind(fs);
const mode = process.env.RG_SMOKE_FIXTURE_MODE;
const key = 'OFFLINE_FAKE_KEY_NOT_A_REAL_CREDENTIAL_123';
function blocked(category) {
  console.error('BOUNDARY_ATTEMPT:' + category);
  throw Error('Offline boundary denied');
}
function credential(path) {
  const value = path instanceof URL ? path.pathname : String(path);
  if (!value.endsWith('.env.groq')) return;
  if (mode === 'guard' || resolve(value) !== resolve(root, '.env.groq')) {
    blocked('credential');
  }
}
fs.readFile = async (path, ...args) => { credential(path); return readFile(path, ...args); };
fs.open = async (path, ...args) => {
  credential(path);
  const handle = await open(path, ...args);
  if (mode === 'attempt-sync-failure' && String(path).endsWith('/attempt.json')) {
    handle.sync = async () => { throw Error('Synthetic persistence failure ' + key); };
  }
  if (mode === 'extraction-sync-failure' && String(path).endsWith('/extraction.json')) {
    handle.sync = async () => { throw Error('Synthetic persistence failure ' + key); };
  }
  return handle;
};
net.Socket.prototype.connect = function () { blocked('TCP'); };
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
  child[name] = () => { blocked('process'); };
}
syncBuiltinESMExports();
globalThis.fetch = async (url, init) => {
  if (mode === 'guard') blocked('fetch');
  if (String(url) !== 'https://api.groq.com/openai/v1/chat/completions' || init.method !== 'POST' || init.redirect !== 'error') {
    blocked('unexpected-request');
  }
  const body = JSON.parse(init.body);
  if (body.model !== 'openai/gpt-oss-20b' || body.max_completion_tokens !== 1536 || body.messages.length !== 2 || init.headers.authorization !== 'Bearer ' + key) {
    blocked('request-contract');
  }
  const runDir = resolve(root, 'evidence/private/provider-smoke', process.env.RG_PROVIDER_SMOKE_RUN_ID);
  const attempt = JSON.parse(await readFile(resolve(runDir, 'attempt.json'), 'utf8'));
  const request = JSON.parse(await readFile(resolve(runDir, 'request.json'), 'utf8'));
  if (attempt.status !== 'started' || attempt.reservedRequests !== 1 || JSON.stringify(request.body) !== init.body || JSON.stringify(request).includes(key)) {
    blocked('persist-before-send');
  }
  await fs.appendFile(resolve(root, 'fake-transport-count.txt'), '1\n', { mode: 0o600 });
  if (mode === 'terminal-collision') await fs.writeFile(resolve(runDir, 'terminal.json'), 'retained-original-terminal\n', { flag: 'wx' });
  if (mode === 'network-unknown') throw Error('Synthetic private provider details ' + key);
  if (mode === 'http429') return new Response('Private error body ' + key, { status: 429 });
  if (mode === 'invalid-json') return new Response('Not JSON ' + key);
  return Response.json({
    id: 'offline-request-id', model: 'openai/gpt-oss-20b',
    choices: [{ message: { content: mode === 'credential-echo' ? key : ' \nOriginal synthetic answer. \n' }, finish_reason: mode === 'length' ? 'length' : 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
  });
};
