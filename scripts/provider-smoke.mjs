// Inactive operator CLI. This tool cannot verify provider billing or authorize a call.
// Build first; a separately authorized operator must acknowledge budget and choose a
// stable UUID. Never remove/reuse its private ledger, including an interrupted run.
import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const url = 'https://api.groq.com/openai/v1/chat/completions';
const model = 'openai/gpt-oss-20b';
const question = 'I bought an unused item 10 days ago and have the receipt. Can I return it?';
const id = process.env.RG_PROVIDER_SMOKE_RUN_ID;
const started = performance.now();
let runDir, report, responseObserved = false, httpStatus = null, transportInvocations = 0, reservedRequests = 0, phase = 'guard';

function deny() { throw Error('Operator guard denied'); }
async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function directory(path) {
  try { await mkdir(path, { mode: 0o700 }); await syncDirectory(dirname(path)); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const entry = await lstat(path);
  if (!entry.isDirectory() || entry.isSymbolicLink()) deny();
}
async function persist(name, value) {
  const handle = await open(join(runDir, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
  await syncDirectory(runDir);
}
async function credential() {
  const handle = await open(join(root, '.env.groq'), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const entry = await handle.stat();
    if (!entry.isFile() || entry.size > 65536) deny();
    const buffer = Buffer.alloc(65537); let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > 65536) deny();
    const key = parseEnv(buffer.subarray(0, size).toString('utf8')).MODEL_API_KEY;
    if (typeof key !== 'string' || !/^[\x21-\x7e]{16,512}$/.test(key) || key.includes('PASTE_')) deny();
    return key;
  } finally { await handle.close(); }
}

try {
  // No compiled provider import, directory writes or credential access before guards.
  if (process.env.RG_CONFIRM_REAL_CALLS !== '1' || process.env.RG_CONFIRM_PROVIDER_BUDGET !== '1' ||
      process.env.GITHUB_ACTIONS || process.env.CI || !['darwin', 'linux'].includes(process.platform) ||
      typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) deny();
  let parent = root;
  for (const segment of ['evidence', 'private', 'provider-smoke']) { parent = join(parent, segment); await directory(parent); }
  const proposed = join(parent, id);
  // An existing directory is a consumed authorization, not a resumable/retry queue.
  await mkdir(proposed, { mode: 0o700 });
  runDir = proposed;
  await syncDirectory(parent);
  report = {
    runId: id, source: 'operator_provider_smoke', provider: 'Groq', model,
    createdAt: new Date().toISOString(), budgetAcknowledged: true,
    freeEligibility: 'not_verified_by_this_tool', semanticResult: 'not_evaluated',
    scope: 'One request at most per retained run ID; protocol evidence only, not semantic quality, application, cloud or release acceptance',
  };
  phase = 'reservation';
  await persist('reserved.json', { ...report, status: 'reserved', maxRequests: 1 });
  phase = 'provider_load';
  const { providerAnswer, promptSnapshot } = await import('../dist/src/provider.js');
  const snapshot = promptSnapshot('v2');
  phase = 'credential';
  const key = await credential();
  const expectedBody = { model, messages: [{ role: 'system', content: snapshot.text }, { role: 'user', content: question }], max_completion_tokens: snapshot.maxOutputTokens };
  let fetchEntered = false;
  const once = async (target, init) => {
    if (fetchEntered) deny();
    fetchEntered = true;
    if (String(target) !== url || init.method !== 'POST' || init.redirect !== 'error' ||
        init.headers?.authorization !== 'Bearer ' + key || init.headers?.['content-type'] !== 'application/json' ||
        init.body !== JSON.stringify(expectedBody) || !init.signal) deny();
    phase = 'request_persistence';
    await persist('request.json', { url, method: 'POST', body: expectedBody, prompt: snapshot, capturedAt: new Date().toISOString() });
    reservedRequests = 1;
    await persist('attempt.json', {
      runId: id, status: 'started', reservedRequests, maxRequests: 1,
      requestSha256: createHash('sha256').update(init.body).digest('hex'), createdAt: new Date().toISOString(),
    });
    init.signal.throwIfAborted();
    phase = 'provider_transport';
    transportInvocations = 1;
    const response = await fetch(target, init); // The only transport invocation; no retry.
    responseObserved = true;
    httpStatus = Number.isSafeInteger(response.status) ? response.status : null;
    return response;
  };
  const extraction = await providerAnswer({ url, key, model }, 'v2', question, once);
  phase = 'extraction_persistence';
  if (JSON.stringify(extraction).includes(JSON.stringify(key).slice(1, -1))) {
    report.outcome = 'credential_echo_withheld';
    // Do not rewrite the answer into a passing result or persist a leaked key.
    report.extraction = 'withheld_entirely_due_to_exact_credential_echo';
  } else {
    await persist('extraction.json', extraction);
    report.extraction = 'exact_providerAnswer_return_not_full_raw_http';
    report.outcome = extraction.error ? 'protocol_failure' : 'protocol_success';
  }
} catch {
  // Never print raw exception messages, provider error bodies or credential values.
  if (report) {
    report.failurePhase = phase;
    report.outcome = transportInvocations === 0 ? 'not_sent' : phase === 'extraction_persistence' ? 'evidence_persistence_failure' : httpStatus !== null && (httpStatus < 200 || httpStatus >= 300) ? 'provider_http_error' : responseObserved ? 'protocol_failure' : 'response_unconfirmed';
  }
  else {
    console.error('Provider smoke denied or reservation unavailable; no new request sent. Keep any existing run ledger.');
    process.exitCode = 1;
  }
}
if (report) {
  Object.assign(report, { reservedRequests, transportInvocations, responseObserved, httpStatus, latencyMs: performance.now() - started });
  try {
    await persist('terminal.json', report);
    console.log(JSON.stringify({ runId: id, model, outcome: report.outcome, reservedRequests, transportInvocations, evidenceDirectory: runDir, latencyMs: report.latencyMs }));
    if (report.outcome !== 'protocol_success') process.exitCode = 1;
  } catch {
    console.error('Provider smoke evidence persistence failed; retain this run as incomplete/unknown and never resend its ID.');
    process.exitCode = 1;
  }
}
