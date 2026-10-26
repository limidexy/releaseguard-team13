// Pure acceptance coordinator. External processes, filesystem and lifecycle
// boundaries are supplied by the operator; importing this module does no work.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const denied = () => { throw Error('Acceptance denied'); };

export function acceptanceOptions(args, env, platform = process.platform) {
  if (!Array.isArray(args) || args.length > 1 || (args.length && !['--full', '--unit-only'].includes(args[0]))) denied();
  const profile = args[0] === '--full' ? 'full' : 'unit_only';
  const id = env.RG_ACCEPTANCE_RUN_ID;
  if (id !== undefined && !uuid.test(id)) denied();
  if (profile === 'full') {
    if (!uuid.test(id ?? '') || env.RG_ACCEPTANCE_INTEGRATION !== '1' || env.CI || env.GITHUB_ACTIONS ||
      !['linux', 'darwin'].includes(platform)) denied();
    for (const key of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH',
      'COMPOSE_FILE', 'COMPOSE_PATH_SEPARATOR', 'COMPOSE_PROFILES', 'COMPOSE_ENV_FILES', 'COMPOSE_DISABLE_ENV_FILE', 'BUILDX_BUILDER',
      'RELEASEGUARD_TOKEN', 'RG_APPROVED_ORIGIN', 'MODEL_API_URL', 'MODEL_API_KEY', 'MODEL_ID']) if (env[key]) denied();
    if (env.ALLOW_REAL_MODEL && env.ALLOW_REAL_MODEL !== 'false') denied();
    if (env.COMPOSE_PROJECT_NAME && env.COMPOSE_PROJECT_NAME !== 'rg-contracts-' + id) denied();
    let url; try { url = new URL(env.RELEASEGUARD_URL); } catch { denied(); }
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.port !== '5189' ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) denied();
  }
  return { profile, id, project: id ? 'rg-contracts-' + id : null };
}

export function acceptancePlan(node = process.execPath) {
  return [
    ['unit-tests', 'npm', ['test']],
    ['container-build', 'docker', ['compose', 'build', 'gateway', 'postgres']],
    ['container-start', 'docker', ['compose', 'up', '-d', '--no-build', '--wait']],
    ['integration', node, ['scripts/verify.mjs', '--restart']],
    ['improvements', node, ['scripts/verify-improvements.mjs']],
    ['ddd-contracts', node, ['scripts/verify-contracts.mjs']],
    ['fault-recovery', node, ['scripts/fault-test.mjs']],
    ['prompt-replay', node, ['scripts/compare-prompts.mjs', 'replay']],
    ['repeated-scaling', node, ['scripts/benchmark-repeated.mjs']],
    ['mixed-read-write', node, ['scripts/mixed-load.mjs']],
    ['dependency-audit', 'npm', ['audit', '--audit-level=high', '--json']],
  ].map(([name, command, args]) => ({ name, command, args }));
}

export function safeProcessCode(error) {
  const known = ['EACCES', 'EAGAIN', 'EBADF', 'ECANCELED', 'ENOENT', 'ENOEXEC', 'ENOBUFS', 'ENOMEM',
    'EPERM', 'ESRCH', 'ETIMEDOUT', 'EINVAL', 'ABORT_ERR', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', 'DEADLINE',
    'CHILDREN_UNKNOWN', 'CHILD_TERMINATION_UNKNOWN'];
  return known.includes(error?.code) ? error.code : 'UNKNOWN';
}

// A command exit is not proof of its output contract, clean teardown, source
// preservation, deployment or production acceptance. Keep those gates separate.
export async function runAcceptance({ profile, runId, node, clock, record, run,
  prepare, beforeStep, afterStep, cleanup, verifySource, deadlineMs, cancelled = () => false }) {
  if (!['full', 'unit_only'].includes(profile) || !uuid.test(runId ?? '')) denied();
  if (!Number.isFinite(deadlineMs)) denied();
  const plan = acceptancePlan(node), began = clock.now();
  const report = { runId, profile, node: node ?? process.execPath,
    steps: [], plannedSteps: plan.map(s => ({ name: s.name, status: 'not_run' })),
    allPlannedLocalStepsPassed: false, sourceUnchangedDuringRun: null,
    cloudDeployed: false, realModelExecuted: false, hostedCIExecuted: false,
    lifecycle: { preparation: 'not_run', cleanup: 'not_required' },
    status: 'failed_or_incomplete', timing: 'Coordinator wall time includes evidence persistence; not API/job/SQL latency.' };
  const remaining = () => {
    if (cancelled()) throw Object.assign(Error('Acceptance cancelled'), { code: 'ABORT_ERR' });
    const n = deadlineMs - clock.now();
    if (!Number.isFinite(n) || n <= 0) throw Object.assign(Error('Acceptance deadline'), { code: 'DEADLINE' });
    return Math.max(1, Math.floor(n));
  };
  let preparationAttempted = false, failurePhase = null;
  const selected = profile === 'full' ? plan : plan.slice(0, 1);
  try {
    for (const step of selected) {
      failurePhase = step.name; remaining();
      if (step.name === 'container-build') {
        await record({ kind: 'preparation_intent', runId });
        preparationAttempted = true;
        report.lifecycle.preparation = 'started_or_unknown';
        await prepare({ remaining });
        report.lifecycle.preparation = 'completed';
        await record({ kind: 'preparation_result', status: 'completed' });
      }
      remaining();
      const planned = report.plannedSteps.find(s => s.name === step.name);
      const row = { name: step.name, command: step.command, args: [...step.args],
        exitCode: null, signal: null, error: null, errorCode: null, status: 'started_or_unknown' };
      // Durable intent precedes both lifecycle side effects and subprocess entry.
      await record({ kind: 'command_intent', ...row });
      report.steps.push(row); planned.status = row.status;
      const started = clock.now();
      try {
        if (profile === 'full') await beforeStep(step, { remaining });
        remaining();
        const result = await run(step, { timeoutMs: Math.min(600000, remaining()) });
        row.exitCode = Number.isInteger(result?.status) ? result.status : null;
        if (Number.isInteger(result?.rawCloseCode)) row.rawCloseCode = result.rawCloseCode;
        row.signal = typeof result?.signal === 'string' && /^SIG[A-Z0-9]{1,12}$/.test(result.signal) ? result.signal : null;
        row.errorCode = result?.error ? safeProcessCode(result.error) : null;
        row.error = result?.error ? 'Process start or outcome is unknown; inspect private redacted diagnostics' : null;
        row.status = result?.error || row.exitCode === null ? 'unknown' : row.exitCode === 0 ? 'passed' : 'failed';
        if (result?.evidenceError) {
          row.status = 'evidence_unknown';
          row.error = 'Private operational log could not be preserved; the observed process result remains unchanged';
        }
        if (row.status === 'passed' && profile === 'full') {
          try { await afterStep(step, result, { remaining }); }
          catch { row.status = 'evidence_invalid'; }
        }
      } catch (error) {
        row.status = 'unknown'; row.errorCode = safeProcessCode(error);
        row.error = 'Command boundary failed; do not retry an uncertain operation';
      }
      const ended = clock.now(); row.durationMs = ended - started;
      row.timingValid = Number.isFinite(started) && Number.isFinite(ended) && ended >= started;
      if (!row.timingValid && row.status === 'passed') row.status = 'invalid_timing';
      planned.status = row.status;
      try { await record({ kind: 'command_result', ...row }); }
      catch { row.status = 'evidence_unknown'; planned.status = row.status; throw Error('Outcome persistence failed'); }
      if (row.status !== 'passed') break;
    }
  } catch {
    report.failurePhase = failurePhase;
  } finally {
    if (preparationAttempted) {
      report.lifecycle.cleanup = 'started_or_unknown';
      try {
        await record({ kind: 'cleanup_intent' });
        const result = await cleanup();
        if (result?.stoppedAndVerified !== true) throw Error('Cleanup unconfirmed');
        report.lifecycle.cleanup = 'stopped_and_verified';
        await record({ kind: 'cleanup_result', status: 'stopped_and_verified' });
      } catch { report.lifecycle.cleanup = 'unknown'; }
    }
    try { report.sourceUnchangedDuringRun = (await verifySource()) === true; } catch { report.sourceUnchangedDuringRun = null; }
  }
  const all = report.plannedSteps.every(s => s.status === 'passed');
  report.cancelled = cancelled();
  report.allPlannedLocalStepsPassed = profile === 'full' && all && report.sourceUnchangedDuringRun === true &&
    report.lifecycle.cleanup === 'stopped_and_verified' && !report.failurePhase && !report.cancelled;
  if (report.allPlannedLocalStepsPassed) report.status = 'completed';
  else if (profile === 'unit_only' && report.steps[0]?.status === 'passed' && report.sourceUnchangedDuringRun === true && !report.failurePhase && !report.cancelled) report.status = 'unit_only_completed';
  report.elapsedMs = clock.now() - began;
  return report;
}
