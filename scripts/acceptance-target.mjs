// Full acceptance lifecycle. Never run by import or by the default unit profile.
// A source checkout, private worktree and an otherwise-empty local engine are
// separate identities. Existing stacks and their mutable image tags are not adopted.
import { execFileSync } from 'node:child_process';
import { constants } from 'node:fs';
import { open, mkdir, lstat, realpath, readdir, symlink } from 'node:fs/promises';
import { join, dirname, resolve, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { waitForContractHealth } from './contract-target.mjs';
import { verifyAcceptanceEvidence } from './acceptance-evidence.mjs';

const services = ['postgres', 'rabbitmq', 'registry', 'evaluation', 'governance', 'support', 'worker', 'gateway'];
const apps = services.filter(s => !['postgres', 'rabbitmq'].includes(s));
const keyNames = ['AUTH_SECRET', 'INTERNAL_SECRET', 'POSTGRES_PASSWORD', 'REGISTRY_DB_PASSWORD',
  'EVALUATION_DB_PASSWORD', 'GOVERNANCE_DB_PASSWORD', 'RABBIT_PASSWORD'];
const idPattern = /^[a-f0-9]{64}$/;
const imagePattern = /^sha256:[a-f0-9]{64}$/;
const format = '{"Id":{{json .Id}},"Image":{{json .Image}},"Labels":{{json .Config.Labels}},"State":{{json .State}},"Ports":{{json .NetworkSettings.Ports}}}';
const deny = () => { throw Error('Acceptance target denied'); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function syncDir(path) {
  const h = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await h.sync(); } finally { await h.close(); }
}
async function freshDir(path) { await mkdir(path, { mode: 0o700 }); await syncDir(dirname(path)); }
async function put(path, bytes) {
  const h = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await h.writeFile(bytes); await h.sync(); } finally { await h.close(); }
  await syncDir(dirname(path));
}
async function bytes(path, limit = 32 * 1024 * 1024) {
  const h = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const s = await h.stat(); if (!s.isFile() || s.size > limit) deny(); return await h.readFile(); }
  finally { await h.close(); }
}
async function copyTree(source, dest, rows, prefix = '') {
  await freshDir(dest);
  for (const e of await readdir(source, { withFileTypes: true })) {
    const name = prefix + e.name;
    if (e.isDirectory()) await copyTree(join(source, e.name), join(dest, e.name), rows, name + '/');
    else if (e.isFile()) { const b = await bytes(join(source, e.name)); await put(join(dest, e.name), b); rows.push({ path: name, sha256: hash(b) }); }
    else deny();
  }
}

export function acceptanceTarget({ root, runDir, runId, env, sourceFiles, remaining, record }, execute = execFileSync) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(runId ?? '') ||
    !isAbsolute(root) || !isAbsolute(runDir) || !Array.isArray(sourceFiles) || !sourceFiles.length ||
    env.DOCKER_HOST || env.DOCKER_CONTEXT || env.DOCKER_CONFIG || env.COMPOSE_FILE || env.CI || env.GITHUB_ACTIONS) deny();
  const project = 'rg-contracts-' + runId;
  const cwd = join(runDir, 'worktree'), dockerConfig = join(runDir, 'docker-config');
  const childEnv = { ...env, COMPOSE_PROJECT_NAME: project, DOCKER_CONFIG: dockerConfig,
    RELEASEGUARD_URL: 'http://127.0.0.1:5189', RG_CONTRACTS_INTEGRATION: '1',
    RG_MIXED_LOAD_INTEGRATION: '1', RG_MIXED_LOAD_RUN_ID: runId, RG_LOAD_SECONDS: '20',
    RG_JOBS: '120', RG_PRODUCERS: '8', ALLOW_REAL_MODEL: 'false', MODEL_API_URL: '', MODEL_API_KEY: '', MODEL_ID: '' };
  const secrets = [], summary = { project, endpoint: childEnv.RELEASEGUARD_URL,
    healthObservations: [], runtimeProofs: [], sourceCopyVerified: false, compiledFiles: [],
    cleanup: 'not_required', unknownMutation: false, limits: 'Sampled local engine/identity proof, not hostile-concurrency isolation, image attestation, cloud/model quality, HA or scaling benefit. Original child reports are private and unchanged.' };
  let prepared = false, startIntent = false, engineId, appImage, pgImage, rabbitImage, cleanupAttempted = false, cleanupDeadline = null;
  const tracked = new Map();
  const budget = () => {
    if (cleanupDeadline === null) return remaining();
    const n = cleanupDeadline - performance.now(); if (!Number.isFinite(n) || n <= 0) deny(); return Math.max(1, Math.floor(n));
  };
  const command = (...args) => execute('docker', ['--context', 'default', ...args], {
    cwd: prepared ? cwd : root, env: childEnv, encoding: 'utf8', timeout: Math.min(120000, budget()),
    maxBuffer: 4 * 1024 * 1024, stdio: 'pipe',
  }).trim();
  const lines = (...args) => command(...args).split(/\s+/).filter(Boolean);
  const sameEngine = () => {
    const host = JSON.parse(command('context', 'inspect', 'default', '--format', '{{json .Endpoints.docker.Host}}'));
    if (typeof host !== 'string' || !/^unix:\/\/\//.test(host)) deny();
    const id = JSON.parse(command('info', '--format', '{{json .ID}}'));
    if (typeof id !== 'string' || !id.length || id.length > 256 || (engineId && id !== engineId)) deny();
    return id;
  };
  const emptyEngine = () => {
    sameEngine();
    if (lines('ps', '-aq').length || lines('image', 'ls', '-aq').length || lines('volume', 'ls', '-q').length) deny();
    if (lines('network', 'ls', '--format', '{{.Name}}').some(n => !['bridge', 'host', 'none'].includes(n))) deny();
  };
  function inspect(id) { if (!idPattern.test(id)) deny(); const value = JSON.parse(command('inspect', '--format', format, id)); if (value.Id !== id) deny(); return value; }
  function owned(s) {
    const service = s.Labels?.['com.docker.compose.service'];
    if (!services.includes(service) || s.Labels['com.docker.compose.project'] !== project ||
      resolve(s.Labels['com.docker.compose.project.working_dir'] ?? '/') !== resolve(cwd) ||
      !idPattern.test(s.Id ?? '') || !imagePattern.test(s.Image ?? '')) deny();
    const expected = service === 'postgres' ? pgImage : service === 'rabbitmq' ? rabbitImage : appImage;
    if (expected && s.Image !== expected) deny();
    return service;
  }
  function scan() {
    sameEngine();
    return lines('ps', '-aq').map(id => { const s = inspect(id); owned(s); return s; });
  }
  function image(tag) {
    const value = JSON.parse(command('image', 'inspect', tag, '--format', '{{json .Id}}'));
    if (!imagePattern.test(value ?? '')) deny(); return value;
  }
  function imageAliases() {
    if (!appImage || image('releaseguard-course-v2:local') !== appImage || image('releaseguard-postgres-v2:local') !== pgImage) deny();
    if (rabbitImage && image('rabbitmq:4-management-alpine') !== rabbitImage) deny();
  }
  function composeConfig(config) {
    if (config.name !== project || JSON.stringify(Object.keys(config.services ?? {}).sort()) !== JSON.stringify([...services].sort())) deny();
    for (const service of services) {
      const s = config.services[service];
      if (s.privileged || s.network_mode || s.pid || s.devices?.length || s.volumes_from?.length || s.external_links?.length) deny();
      for (const v of s.volumes ?? []) if (!['postgres', 'rabbitmq'].includes(service) || v.type !== 'volume' || !['pgdata', 'rabbitdata'].includes(v.source)) deny();
      if (service !== 'gateway' && s.ports?.length) deny();
      if (apps.includes(service)) {
        if (s.image !== 'releaseguard-course-v2:local' || resolve(s.build?.context ?? '/') !== resolve(cwd) ||
          s.environment?.AUTH_MODE !== 'dev' || s.environment?.ALLOW_DEV_AUTH !== 'true' || s.environment?.SERVICE_ROLE !== service) deny();
      }
    }
    const support = config.services.support.environment;
    if (support.ALLOW_REAL_MODEL !== 'false' || support.MODEL_API_KEY || support.MODEL_API_URL || support.MODEL_ID) deny();
    const pg = config.services.postgres;
    if (pg.image !== 'releaseguard-postgres-v2:local' || resolve(pg.build?.context ?? '/') !== resolve(cwd) || pg.build?.dockerfile !== 'deploy/postgres/Dockerfile') deny();
    if (config.services.rabbitmq.image !== 'rabbitmq:4-management-alpine') deny();
    const ports = config.services.gateway.ports;
    if (ports?.length !== 1 || ports[0].host_ip !== '127.0.0.1' || String(ports[0].published) !== '5189' || ports[0].target !== 8080 || ports[0].protocol !== 'tcp') deny();
    for (const [name, v] of Object.entries(config.volumes ?? {})) if (!['pgdata', 'rabbitdata'].includes(name) || v.external || v.name !== project + '_' + name) deny();
    for (const [name, n] of Object.entries(config.networks ?? {})) if (name !== 'default' || n.external || n.name !== project + '_default') deny();
  }
  async function proveRuntime() {
    imageAliases(); const states = scan();
    if (states.length !== services.length) deny();
    const proof = {};
    for (const service of services) {
      const selected = states.filter(s => owned(s) === service); if (selected.length !== 1) deny();
      const initial = selected[0]; tracked.set(initial.Id, { service, image: initial.Image });
      await waitForContractHealth(service, () => { const s = inspect(initial.Id); if (owned(s) !== service || s.Image !== initial.Image) deny(); return s; },
        { timeoutMs: Math.min(120000, remaining()), observe: o => summary.healthObservations.push(o) });
      if (service === 'gateway') {
        const binding = initial.Ports?.['8080/tcp'];
        if (binding?.length !== 1 || binding[0].HostIp !== '127.0.0.1' || binding[0].HostPort !== '5189') deny();
      }
      proof[service] = { id: initial.Id, image: initial.Image };
    }
    command('exec', proof.support.id, 'node', '-e', "if(process.env.ALLOW_REAL_MODEL!=='false')process.exit(1)");
    summary.runtimeProofs.push({ at: new Date().toISOString(), containers: proof });
    await record({ kind: 'runtime_proof', containers: proof });
  }
  return {
    cwd, env: childEnv, secrets, summary,
    async prepare() {
      if (prepared || await realpath(runDir) !== join(await realpath(root), 'evidence/private/acceptance', runId)) deny();
      const owner = await lstat(runDir); if (!owner.isDirectory() || owner.isSymbolicLink() || (owner.mode & 0o077)) deny();
      await freshDir(dockerConfig); await put(join(dockerConfig, 'config.json'), '{"currentContext":"default"}\n');
      engineId = sameEngine(); emptyEngine(); summary.engineId = engineId;
      await record({ kind: 'empty_local_engine_proof', engineId, noExistingContainersImagesVolumesOrCustomNetworks: true });
      // Existing private credentials are only opened after the no-adoption proof.
      const stat = await lstat(join(root, '.env'));
      if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) || stat.size > 65536) deny();
      const raw = await bytes(join(root, '.env'), 65536), values = new Map();
      for (const line of raw.toString('utf8').split(/\r?\n/).filter(x => x.trim() && !x.startsWith('#'))) {
        const match = /^([A-Z_]+)=([a-f0-9]{64}|false)$/.exec(line);
        if (!match || values.has(match[1]) || (!keyNames.includes(match[1]) && match[1] !== 'ALLOW_REAL_MODEL')) deny();
        values.set(match[1], match[2]);
      }
      if (keyNames.some(k => !/^[a-f0-9]{64}$/.test(values.get(k) ?? '')) || (values.has('ALLOW_REAL_MODEL') && values.get('ALLOW_REAL_MODEL') !== 'false')) deny();
      secrets.push(...keyNames.map(k => values.get(k)));
      await freshDir(cwd);
      for (const row of sourceFiles) {
        if (!row.path || isAbsolute(row.path) || row.path.split('/').some(p => !p || p === '.' || p === '..') || row.path.startsWith('.env') || ['evidence', 'node_modules', 'dist', '.git'].includes(row.path.split('/')[0])) deny();
        const b = await bytes(join(root, row.path)); if (hash(b) !== row.sha256) deny();
        let part = cwd;
        for (const name of row.path.split('/').slice(0, -1)) {
          part = join(part, name); try { await freshDir(part); } catch (e) { if (e.code !== 'EEXIST') throw e; const s = await lstat(part); if (!s.isDirectory() || s.isSymbolicLink()) deny(); }
        }
        await put(join(cwd, row.path), b);
      }
      await copyTree(join(root, 'dist'), join(cwd, 'dist'), summary.compiledFiles);
      if (!summary.compiledFiles.length) deny();
      await symlink(await realpath(join(root, 'node_modules')), join(cwd, 'node_modules'), 'dir'); await syncDir(cwd);
      await put(join(cwd, '.env'), raw);
      prepared = true;
      const rawConfig = command('compose', 'config', '--format', 'json'); composeConfig(JSON.parse(rawConfig));
      summary.effectiveComposeSHA256 = hash(rawConfig); summary.sourceCopyVerified = true;
      await record({ kind: 'private_worktree_proof', sourceFiles, compiledFiles: summary.compiledFiles, effectiveComposeSHA256: summary.effectiveComposeSHA256 });
    },
    async beforeStep(step) {
      if (!prepared) deny();
      if (step.name === 'container-build') emptyEngine();
      else if (step.name === 'container-start') { imageAliases(); if (scan().length) deny(); startIntent = true; }
      else await proveRuntime();
      // Only audit may contact the public advisory endpoint, using empty npm
      // configs; no install, registry token, provider or cloud credential is added.
      childEnv.npm_config_offline = step.name === 'dependency-audit' ? 'false' : 'true';
    },
    observeOutcome(step, result) {
      if (step.name !== 'dependency-audit' && (result.error || result.status === null || result.status === undefined || result.status !== 0)) summary.unknownMutation = true;
    },
    async afterStep(step, result) {
      if (step.name === 'container-build') {
        appImage = image('releaseguard-course-v2:local'); pgImage = image('releaseguard-postgres-v2:local');
        summary.builtImageConfigs = { application: appImage, postgres: pgImage };
        await record({ kind: 'built_image_configurations', ...summary.builtImageConfigs });
      } else {
        if (step.name === 'container-start') rabbitImage = image('rabbitmq:4-management-alpine');
        await proveRuntime();
        await verifyAcceptanceEvidence(cwd, step.name, runId, result);
      }
    },
    async cleanup() {
      if (cleanupAttempted) deny(); cleanupAttempted = true;
      if (!engineId || !startIntent) return { stoppedAndVerified: !summary.unknownMutation };
      summary.cleanup = 'started_or_unknown';
      cleanupDeadline = performance.now() + 120000; summary.cleanupBudgetMs = 120000;
      // Retain all databases, volumes, queue evidence, images and stopped
      // containers. Never compose down, delete, recreate, rebuild or adopt.
      const states = scan();
      for (const s of states) {
        const service = owned(s); tracked.set(s.Id, { service, image: s.Image });
        if (s.State.Paused) { await record({ kind: 'cleanup_unpause_intent', id: s.Id, service }); command('unpause', s.Id); }
        if (s.State.Running) { await record({ kind: 'cleanup_stop_intent', id: s.Id, service }); command('stop', '--time', '10', s.Id); }
      }
      const a = scan(); await delay(100); const b = scan(); budget();
      const same = a.length === b.length && a.every(x => b.some(y => y.Id === x.Id && y.Image === x.Image));
      const stopped = same && b.every(s => !s.State.Running && !s.State.Paused);
      summary.cleanup = stopped ? 'sampled_all_owned_stopped' : 'unknown';
      summary.stoppedContainers = b.map(s => ({ id: s.Id, service: owned(s), running: s.State.Running, paused: s.State.Paused }));
      await record({ kind: 'cleanup_observation', stopped, containers: summary.stoppedContainers, unknownMutation: summary.unknownMutation });
      return { stoppedAndVerified: stopped && !summary.unknownMutation };
    },
  };
}
