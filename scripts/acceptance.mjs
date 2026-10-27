// Inactive by import. A bare invocation runs only the unit gate; full local
// acceptance requires explicit isolated-engine opt-in and an exclusive run ID.
import { execFileSync } from 'node:child_process';
import { constants } from 'node:fs';
import { readdir, lstat, realpath, mkdir, open } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acceptanceOptions, runAcceptance, safeProcessCode } from './acceptance-core.mjs';
import { npmSpawn, spawnFailure } from './npm-command.mjs';
import { acceptanceProcess } from './acceptance-process.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
if (typeof import.meta.main !== 'boolean') throw Error('Acceptance requires Node24.2+ entry detection');
const deny = () => { throw Error('Acceptance denied'); };
async function syncDirectory(path) {
  if (process.platform === 'win32') return; // Unit-only: no claim of directory-fsync/Unix-mode ACL semantics.
  const h = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await h.sync(); } finally { await h.close(); }
}
async function directory(path, privateMode = true) {
  try { await mkdir(path, { mode: 0o700 }); await syncDirectory(dirname(path)); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const s = await lstat(path);
  if (!s.isDirectory() || s.isSymbolicLink() || (privateMode && process.platform !== 'win32' && (s.mode & 0o077))) deny();
}
async function persist(path, bytes) {
  const h = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
  try { await h.writeFile(bytes); await h.sync(); } finally { await h.close(); }
  await syncDirectory(dirname(path));
}
async function json(path, value) { await persist(path, JSON.stringify(value, null, 2) + '\n'); }
async function manifest(dir = root, prefix = '') {
  const rows = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git', 'evidence'].includes(ent.name) || ent.name.startsWith('.env')) continue;
    const name = prefix + ent.name, file = join(dir, ent.name);
    if (ent.isSymbolicLink()) deny();
    if (ent.isDirectory()) rows.push(...await manifest(file, name + '/'));
    else if (ent.isFile()) {
      const h = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try { rows.push({ path: name, sha256: createHash('sha256').update(await h.readFile()).digest('hex') }); }
      finally { await h.close(); }
    } else deny();
  }
  return rows.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
function redacted(value, secrets = []) {
  let text = String(value ?? '');
  for (const secret of secrets.filter(x => typeof x === 'string' && x.length)) text = text.split(secret).join('[REDACTED]');
  return text.replace(/Bearer\s+[^\s"',;]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:gh[pousr]_|github_pat_|gsk_|sk-proj-)[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/((?:password|authorization|api[_-]?key|auth[_-]?secret|internal[_-]?secret)\s*[:=]\s*)[^\s",;]+/gi, '$1[REDACTED]');
}
function childEnvironment(parent, dir) {
  const env = {};
  for (const key of ['PATH', 'SystemRoot', 'ComSpec', 'COMSPEC', 'SYSTEMDRIVE', 'PATHEXT', 'TEMP', 'TMP']) if (parent[key]) env[key] = parent[key];
  Object.assign(env, { ALLOW_REAL_MODEL: 'false', npm_config_offline: 'true', npm_config_audit: 'false',
    npm_config_fund: 'false', npm_config_update_notifier: 'false', npm_config_cache: join(dir, 'npm-cache'),
    npm_config_userconfig: join(dir, 'empty-npm-config'), npm_config_globalconfig: join(dir, 'empty-npm-global') });
  return env;
}
async function main() {
  let runDir, phase = 'guard', target, sequence = 0;
  const controller = new AbortController(); let interruptedBy = null;
  const onInt = () => { interruptedBy ??= 'SIGINT'; controller.abort(); };
  const onTerm = () => { interruptedBy ??= 'SIGTERM'; controller.abort(); };
  try {
    const options = acceptanceOptions(process.argv.slice(2), process.env);
    if (await realpath(process.cwd()) !== await realpath(root)) deny();
    const id = options.id ?? randomUUID();
    let parent = root;
    for (const part of ['evidence', 'private', 'acceptance']) { parent = join(parent, part); await directory(parent, part !== 'evidence'); }
    const proposed = join(parent, id);
    await mkdir(proposed, { mode: 0o700 }); runDir = proposed; await syncDirectory(parent);
    await directory(join(runDir, 'events')); await directory(join(runDir, 'logs'));
    await json(join(runDir, 'reserved.json'), { runId: id, status: 'reserved', profile: options.profile, automaticResume: false });
    process.once('SIGINT', onInt); process.once('SIGTERM', onTerm);
    const record = value => json(join(runDir, 'events', String(++sequence).padStart(6, '0') + '.json'), value);
    phase = 'source_snapshot';
    const sourceFiles = await manifest(), startedAt = new Date().toISOString();
    const env = childEnvironment(process.env, runDir);
    await persist(join(runDir, 'empty-npm-config'), ''); await persist(join(runDir, 'empty-npm-global'), '');
    let gitCommit = null, gitDirty = null;
    try {
      const git = args => execFileSync('git', args, { cwd: root, env: { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(runDir, 'empty-npm-config') },
        encoding: 'utf8', timeout: 10000, maxBuffer: 2e6, stdio: 'pipe' }).trim();
      const commit = git(['rev-parse', 'HEAD']); if (/^[a-f0-9]{40}$/.test(commit)) gitCommit = commit;
      gitDirty = !!git(['status', '--porcelain']);
    } catch { /* Unknown source metadata stays null; never fabricate a revision. */ }
    phase = 'coordinator';
    const report = await runAcceptance({ profile: options.profile, runId: id, node: process.execPath,
      clock: { now: () => performance.now() }, deadlineMs: performance.now() + 1800000, record,
      cancelled: () => controller.signal.aborted,
      prepare: async ({ remaining }) => {
        // The full lifecycle implementation must prove an otherwise-empty local
        // engine before reading credentials or using shared source image aliases.
        if (!gitCommit || gitDirty === null) deny();
        const { acceptanceTarget } = await import('./acceptance-target.mjs');
        target = acceptanceTarget({ root, runDir, runId: id, env, sourceFiles, sourceCommit: gitCommit, remaining, record });
        await target.prepare();
      },
      beforeStep: async step => { if (target) await target.beforeStep(step); },
      afterStep: async (step, result) => { if (target) await target.afterStep(step, result); },
      cleanup: async () => target ? await target.cleanup() : { stoppedAndVerified: true },
      verifySource: async () => JSON.stringify(sourceFiles) === JSON.stringify(await manifest()),
      run: async (step, { timeoutMs }) => {
        const base = { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024,
          cwd: target?.cwd ?? root, env: target?.env ?? env, stdio: 'pipe', signal: controller.signal };
        const spec = step.command === 'npm' ? npmSpawn(step.args, base) : { command: step.command, args: step.args, options: base };
        const r0 = await acceptanceProcess(spec.command, spec.args, spec.options);
        let r = r0;
        target?.observeOutcome(step, r);
        // Operational diagnostics are explicitly redacted; original child evidence
        // stays in the private worktree, never rewritten into a better result.
        try { await persist(join(runDir, 'logs', step.name + '.log'), redacted((r.stdout ?? '') + '\n' + (r.stderr ?? ''), target?.secrets)); }
        catch { r = { ...r, evidenceError: true }; }
        const safe = { ...r, error: r.error ? { code: safeProcessCode(r.error), message: 'Process boundary error' } : undefined };
        const failure = spawnFailure(step.name, safe);
        if (failure) console.error(failure);
        return r;
      },
    });
    Object.assign(report, { startedAt, finishedAt: new Date().toISOString(), sourceFiles, gitCommit, gitDirty,
      scope: options.profile === 'full' ? 'Explicit isolated local replay acceptance; not cloud/model/HA/performance-capacity acceptance'
        : 'Unit gate only; the other ten full-local steps are NOT_RUN, not passed acceptance',
      provenance: 'Source bytes, Git metadata, compiled bytes and runtime image proof are separate; Git HEAD is not build attestation.',
      durability: process.platform === 'win32' ? 'Exclusive files + file fsync; no directory-fsync or ACL guarantee; unit-only'
        : 'Private exclusive files and fsynced directory entries; not hard-kill cleanup assurance',
      target: target?.summary ?? null, evidenceLogPolicy: 'Private redacted operational logs; original child reports retained separately.' });
    if (interruptedBy) report.interruptedBy = interruptedBy;
    phase = 'report'; await json(join(runDir, 'report.json'), report);
    phase = 'terminal'; await json(join(runDir, 'terminal.json'), { runId: id, status: report.status, report: 'report.json' });
    console.log(JSON.stringify({ runId: id, status: report.status, allPlannedLocalStepsPassed: report.allPlannedLocalStepsPassed }));
    if (!['completed', 'unit_only_completed'].includes(report.status)) process.exitCode = 1;
  } catch {
    if (runDir && phase !== 'terminal') {
      try { await json(join(runDir, 'terminal.json'), { status: 'incomplete_or_failed', phase, automaticResume: false }); } catch {}
    }
    console.error('Acceptance denied or incomplete. Preserve the private run; do not retry an uncertain full run ID.');
    process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', onInt); process.removeListener('SIGTERM', onTerm);
  }
}
if (import.meta.main) await main();
