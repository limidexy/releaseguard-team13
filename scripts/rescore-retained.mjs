// Inactive offline operator CLI. No provider, platform, database or Docker imports.
// Keep old records; this creates a private, additive v2.1 posthoc derivation only.
// Requires Node24.2+ entry-module detection; older runtimes must not silently no-op.
import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
if (typeof import.meta.main !== 'boolean') throw Error('Offline tool requires Node.js24.2+ entry-module detection');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const limit = 2 * 1024 * 1024;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function deny() { throw Error('Offline derivation denied'); }
function object(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function directory(path, privateMode) {
  try { await mkdir(path, { mode: 0o700 }); await syncDirectory(dirname(path)); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const entry = await lstat(path);
  if (!entry.isDirectory() || entry.isSymbolicLink() || (privateMode && (entry.mode & 0o077))) deny();
}
async function boundedFile(path, maximum) {
  const before = await lstat(path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.size > BigInt(maximum)) deny();
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const initial = await handle.stat({ bigint: true });
    if (!initial.isFile() || before.dev !== initial.dev || before.ino !== initial.ino || initial.size > BigInt(maximum)) deny();
    const buffer = Buffer.alloc(maximum + 1); let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (size > maximum || after.size !== initial.size || after.mtimeNs !== initial.mtimeNs || after.ctimeNs !== initial.ctimeNs) deny();
    return buffer.subarray(0, size);
  } finally { await handle.close(); }
}
async function persist(path, bytes) {
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  await syncDirectory(dirname(path));
}
const encoded = value => JSON.stringify(value, null, 2) + '\n';

// JSON.parse alone silently takes the last duplicate member. Check decoded keys
// as well, so minScore/min\u0053core cannot select different retained policies.
function uniqueJSON(text) {
  const result = JSON.parse(text);
  let i = 0;
  const space = () => { while (/\s/.test(text[i] ?? '') && i < text.length) i++; };
  function string() {
    const start = i++;
    while (i < text.length) {
      if (text[i] === '\\') i += 2;
      else if (text[i++] === '"') break;
    }
    return JSON.parse(text.slice(start, i));
  }
  function value(depth) {
    if (depth > 64) deny();
    space();
    if (text[i] === '{') {
      i++; space(); const keys = new Set();
      if (text[i] !== '}') while (true) {
        const key = string(); if (keys.has(key)) deny(); keys.add(key);
        space(); i++; value(depth + 1); space();
        if (text[i] !== ',') break;
        i++; space();
      }
      i++;
    } else if (text[i] === '[') {
      i++; space();
      if (text[i] !== ']') while (true) {
        value(depth + 1); space(); if (text[i] !== ',') break; i++;
      }
      i++;
    } else if (text[i] === '"') string();
    else while (i < text.length && !/[\s,\]}]/.test(text[i])) i++;
  }
  value(0);
  return result;
}
function validate(source, domain, policy) {
  if (!object(source) || source.source !== 'real' || !['2.1', '2.2'].includes(source.schemaVersion) ||
      !Array.isArray(source.cases) || source.cases.length < 1 || source.cases.length > 60 ||
      !Array.isArray(source.runs) || source.runs.length !== 2) deny();
  domain.policySchema.parse(source.policy);
  if (source.policy.minScore !== 95) deny(); // Narrow retained experiment; never clamp a different policy.
  const ids = new Map();
  for (const c of source.cases) {
    domain.caseSchema.parse(c);
    if (!policy.returnsCriteria.includes(c.id) || ids.has(c.id)) deny();
    ids.set(c.id, c);
  }
  const jobs = new Set(), versions = new Set();
  for (const j of source.runs) {
    if (!object(j) || !uuid.test(j.id) || jobs.has(j.id) || !['queued', 'running', 'failed', 'succeeded'].includes(j.status) ||
        !object(j.input) || j.input.source !== 'real' || !['v1', 'v2'].includes(j.input.promptVersion) || versions.has(j.input.promptVersion)) deny();
    jobs.add(j.id); versions.add(j.input.promptVersion);
    for (const field of ['appId', 'suiteId']) if (source[field] !== undefined &&
      (!uuid.test(source[field]) || j.input[field] !== source[field])) deny();
    if (j.result == null) continue;
    if (!object(j.result) || !Number.isFinite(j.result.score) || j.result.score < 0 || j.result.score > 100 ||
        !['blocked', 'passed'].includes(j.result.gate) || !Array.isArray(j.result.results) || j.result.results.length > source.cases.length) deny();
    const seen = new Set();
    for (const r of j.result.results) {
      const c = object(r) ? ids.get(r.caseId) : undefined;
      if (!c || seen.has(r.caseId) || !['passed', 'failed', 'error', 'not_run'].includes(r.status) ||
          r.critical !== c.critical || r.rule !== c.rule || r.expected !== c.expected ||
          (r.output != null && (typeof r.output !== 'string' || r.output.length > 10000)) ||
          (r.latencyMs != null && (!Number.isFinite(r.latencyMs) || r.latencyMs < 0 || r.latencyMs > 600000)) ||
          (r.reason != null && (typeof r.reason !== 'string' || r.reason.length > 10000)) ||
          (r.status === 'error' && (typeof r.reason !== 'string' || !r.reason.length))) deny();
      seen.add(r.caseId);
    }
  }
}
async function main() {
  const id = process.env.RG_OFFLINE_RESCORE_RUN_ID;
  let runDir, phase = 'guard';
  try {
    // No compiled imports, input reads or writes before these operator guards.
    if (process.env.RG_CONFIRM_OFFLINE_RESCORE !== '1' || !uuid.test(id ?? '') ||
        process.env.CI || process.env.GITHUB_ACTIONS || !['darwin', 'linux'].includes(process.platform) ||
        process.argv.length !== 3 || !/\.json$/.test(process.argv[2]) || /[\x00-\x1f\x7f]/.test(process.argv[2])) deny();
    const input = resolve(process.argv[2]);
    if (input.split(/[/\\]/).some(p => /^\.env|^(?:credentials?|secrets?|tokens?)(?:[.-]|$)/i.test(p))) deny();
    let parent = root;
    for (const segment of ['evidence', 'private', 'rescore-retained']) {
      parent = join(parent, segment); await directory(parent, segment !== 'evidence');
    }
    const proposed = join(parent, id);
    await mkdir(proposed, { mode: 0o700 }); // Existing/interrupted IDs are not resumable.
    runDir = proposed; await syncDirectory(parent);
    phase = 'reservation';
    await persist(join(runDir, 'reserved.json'), encoded({ runId:id, kind:'OFFLINE_RESCORING', newProviderCalls:0, status:'reserved', at:new Date().toISOString() }));
    phase = 'input';
    const raw = await boundedFile(input, limit);
    const source = uniqueJSON(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw));
    phase = 'evaluator_identity';
    const evaluatorBytes = {};
    for (const path of ['src/domain.ts', 'src/returns-policy.ts', 'dist/src/domain.js', 'dist/src/returns-policy.js', 'package-lock.json']) {
      evaluatorBytes[path] = digest(await boundedFile(join(root, path), limit));
    }
    const domain = await import('../dist/src/domain.js');
    const policy = await import('../dist/src/returns-policy.js');
    if (policy.returnsEvaluatorVersion !== 'returns-policy-v2.1') deny();
    phase = 'validation'; validate(source, domain, policy);
    phase = 'source_persistence';
    await persist(join(runDir, 'source.json'), raw); // Exact bytes; never rewrite source or previous jobs.
    phase = 'derivation';
    const cases = policy.revisedReturnsSuite({ name:'Retained comparison', description:'Offline re-score', cases:source.cases, policy:source.policy }).cases.map(c => domain.caseSchema.parse(c));
    const runs = source.runs.map(j => {
      const original = j.result?.results ?? [], byId = new Map(original.map(r => [r.caseId, r]));
      const outputs = original.map(r => ({
        caseId:r.caseId, ...(typeof r.output === 'string' ? { output:r.output } : {}),
        ...(r.latencyMs != null ? { latencyMs:r.latencyMs } : {}),
        ...(r.status === 'error' || r.status === 'not_run' ? { error:r.reason || 'Retained sample marked not_run' } : {}),
      }));
      const result = domain.evaluate(cases, source.policy, outputs);
      const retainedExecution = cases.map(c => {
        const old = byId.get(c.id);
        return { caseId:c.id, state:old ? old.status === 'not_run' ? 'unexecuted' : old.status === 'error' ? 'execution_error' : 'recorded' :
          j.result != null ? 'missing' : j.status === 'queued' ? 'unexecuted' : j.status === 'failed' ? 'protocol_failure_or_result_unavailable' : 'result_unknown' };
      });
      return { originalJobId:j.id, promptVersion:j.input.promptVersion, originalJobStatus:j.status,
        originalScore:j.result?.score ?? null, originalGate:j.result?.gate ?? null, retainedExecution, result,
        changedCases:result.results.flatMap(r => {
          const old = byId.get(r.caseId);
          return !old || old.status !== r.status || old.reason !== r.reason ? [{ caseId:r.caseId, from:old?.status ?? null, to:r.status, oldReason:old?.reason ?? null, newReason:r.reason }] : [];
        }) };
    });
    for (const [path, hash] of Object.entries(evaluatorBytes)) if (digest(await boundedFile(join(root, path), limit)) !== hash) deny();
    const report = {
      at:new Date().toISOString(), runId:id, kind:'OFFLINE_RESCORING', newProviderCalls:0,
      shadowOnly:true, reviewer:'calibration_pending', sourceSha256:digest(raw), sourceDeclaration:'real (retained claim, not independently verified)',
      originalEvaluatorVersion:source.evaluatorVersion ?? null, evaluatorVersion:policy.returnsEvaluatorVersion,
      evaluatorBytes, evaluatorCommit:null, lineageLimit:'Actual source/compiled/lock bytes captured separately; no Git or build-lineage assertion.',
      originalPolicy:source.policy, originalCases:source.cases, derivedCases:cases, runs,
      limitation:'Evaluator v2.1 was refined after inspecting retained answers. This is explanatory posthoc re-scoring, NOT a new/blind validation, NOT new provider calls and NOT human approval. Original jobs, raw reports, policies and scores remain unchanged. Independent holdout and human review remain pending.',
    };
    phase = 'derivation_persistence'; await persist(join(runDir, 'derivation.json'), encoded(report));
    phase = 'terminal_persistence'; await persist(join(runDir, 'terminal.json'), encoded({ runId:id, status:'completed', kind:'OFFLINE_RESCORING', newProviderCalls:0, denominator:cases.length, sourceSha256:report.sourceSha256 }));
    console.log(JSON.stringify({ runId:id, status:'completed', kind:'OFFLINE_RESCORING', newProviderCalls:0, denominator:cases.length }));
  } catch {
    if (runDir && phase !== 'terminal_persistence') {
      try { await persist(join(runDir, 'terminal.json'), encoded({ runId:id, status:'failed', phase, newProviderCalls:0 })); } catch { /* Keep incomplete evidence, never overwrite/retry. */ }
    }
    console.error('Offline derivation denied or incomplete. Preserve any existing private run; do not retry its ID.');
    process.exitCode = 1;
  }
}
// Node24 identifies the actual entry module, including macOS /tmp path aliases.
if (import.meta.main) await main();
