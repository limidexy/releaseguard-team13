// A fault verifier may touch only already-running containers proven to belong
// to the explicit disposable project and the published loopback endpoint.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const services = ['postgres', 'rabbitmq', 'registry', 'evaluation', 'governance', 'support', 'worker', 'gateway'];
const root = fileURLToPath(new URL('../', import.meta.url));
const inspectFormat = '{"Id":{{json .Id}},"Image":{{json .Image}},"Labels":{{json .Config.Labels}},"State":{{json .State}},"Ports":{{json .NetworkSettings.Ports}}}';

export function validateContractEnvironment(env) {
  assert.equal(env.RG_CONTRACTS_INTEGRATION, '1', 'Explicit disposable integration opt-in required');
  assert.match(env.COMPOSE_PROJECT_NAME ?? '', /^rg-(ci|contracts)-[a-zA-Z0-9_-]+$/, 'A disposable rg-ci/rg-contracts project is required');
  assert.ok(env.RELEASEGUARD_URL, 'Explicit HTTP loopback endpoint required');
  const endpoint = new URL(env.RELEASEGUARD_URL);
  assert.equal(endpoint.protocol, 'http:', 'Only plain HTTP to disposable local services is allowed');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname), 'Only a loopback endpoint is allowed');
  assert.ok(endpoint.port, 'An explicit non-default port is required');
  assert.notEqual(endpoint.port, '5193', 'The classroom endpoint is forbidden');
  assert.ok(!endpoint.username && !endpoint.password && endpoint.pathname === '/' && !endpoint.search && !endpoint.hash,
    'Endpoint credentials, path, query and fragment are forbidden');
  assert.ok(!env.DOCKER_HOST && !env.DOCKER_CONTEXT, 'Docker host/context overrides are forbidden');
  return { project: env.COMPOSE_PROJECT_NAME, endpoint };
}

// Docker marks health unhealthy when pause closes the health monitor. Unpause
// resumes the monitor, but does not itself prove the next probe has succeeded.
// Poll only observations: never restart a service or accept unhealthy as ready.
export async function waitForContractHealth(service, read, { timeoutMs = 120000, pollMs = 250, observe = () => {} } = {}) {
  const deadline = Date.now() + timeoutMs;
  let previous;
  for (;;) {
    const state = read();
    assert.equal(state.State?.Running, true, 'Container must already be running: ' + service);
    assert.notEqual(state.State.Paused, true, 'Container must not already be paused: ' + service);
    const status = state.State.Health?.Status;
    assert.ok(['healthy', 'starting', 'unhealthy'].includes(status), 'Container must have a health check: ' + service);
    if (status !== previous) {
      observe({ service, at: new Date().toISOString(), status, failingStreak: state.State.Health.FailingStreak ?? null });
      previous = status;
    }
    if (status === 'healthy') return state;
    assert.ok(Date.now() < deadline, 'Health readiness deadline exceeded: ' + service);
    await delay(pollMs);
  }
}

export function contractTarget(env = process.env, execute = execFileSync) {
  const { project, endpoint } = validateContractEnvironment(env);
  const originals = new Map(), changes = new Map();
  let proven = false;
  const observations = [];
  const run = (...args) => execute('docker', ['--context', 'default', ...args], {
    cwd: root, env, encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024, stdio: 'pipe',
  }).trim();
  const compose = (...args) => run('compose', '--project-name', project, '--project-directory', root, '--file', root + 'compose.yaml', ...args);
  const inspect = id => JSON.parse(run('inspect', '--format', inspectFormat, id));
  function owned(service, current) {
    assert.equal(current.Labels?.['com.docker.compose.project'], project, 'Container project mismatch: ' + service);
    assert.equal(current.Labels?.['com.docker.compose.service'], service, 'Container service mismatch: ' + service);
    assert.match(current.Id, /^[a-f0-9]{64}$/, 'Invalid container identity');
    assert.match(current.Image, /^sha256:[a-f0-9]{64}$/, 'Invalid image identity');
    const original = originals.get(service);
    if (original) {
      assert.equal(current.Id, original.Id, 'Container identity changed: ' + service);
      assert.equal(current.Image, original.Image, 'Container image changed: ' + service);
    }
  }
  function healthy(service, current) {
    assert.equal(current.State?.Running, true, 'Container must already be running: ' + service);
    assert.notEqual(current.State.Paused, true, 'Container must not already be paused: ' + service);
    assert.equal(current.State.Health?.Status, 'healthy', 'Container must be healthy: ' + service);
  }
  function current(service) {
    assert.ok(proven, 'Disposable target ownership must be proven first');
    assert.ok(originals.has(service), 'Unproven service');
    const state = inspect(originals.get(service).Id);
    owned(service, state);
    return state;
  }
  return {
    project,
    observations,
    async prove() {
      assert.equal(proven, false, 'Target can only be proven once');
      const host = JSON.parse(run('context', 'inspect', 'default', '--format', '{{json .Endpoints.docker.Host}}'));
      assert.match(host, /^unix:\/\/\//, 'Default Docker context must use a local Unix socket');
      observations.push({ kind: 'dockerServer', version: run('version', '--format', '{{.Server.Version}}'), at: new Date().toISOString() });
      for (const service of services) {
        const ids = compose('ps', '--all', '--quiet', service).split(/\s+/).filter(Boolean);
        assert.equal(ids.length, 1, 'Exactly one existing container is required: ' + service);
        const state = inspect(ids[0]);
        assert.equal(state.Id, ids[0], 'Compose/inspect container mismatch');
        owned(service, state); originals.set(service, state);
        await waitForContractHealth(service, () => {
          const latest = inspect(state.Id); owned(service, latest); return latest;
        }, { observe: entry => observations.push(entry) });
      }
      const bindings = originals.get('gateway').Ports?.['8080/tcp'];
      assert.equal(bindings?.length, 1, 'Exactly one gateway loopback binding is required');
      assert.equal(bindings[0].HostPort, endpoint.port, 'Endpoint does not belong to this gateway');
      assert.equal(bindings[0].HostIp, endpoint.hostname === '[::1]' ? '::1' : '127.0.0.1', 'Gateway binding must match loopback endpoint');
      // All HTTP fixtures use replay/imported synthetic answers. Also reject a
      // misconfigured target before generating identities or sending requests.
      run('exec', originals.get('support').Id, 'node', '-e', "if(process.env.ALLOW_REAL_MODEL!=='false')process.exit(1)");
      proven = true;
      return Object.fromEntries([...originals].map(([service, state]) => [service, { id: state.Id, image: state.Image }]));
    },
    inside(service, code) {
      const state = current(service); healthy(service, state);
      return run('exec', state.Id, 'node', '--input-type=module', '-e', code);
    },
    stop(service) {
      assert.ok(['registry', 'evaluation'].includes(service), 'This verifier may stop only Registry/Evaluation');
      const state = current(service); healthy(service, state);
      assert.equal(changes.has(service), false, 'Fault already attempted for service');
      changes.set(service, { kind: 'stop', restorationAttempted: false });
      run('stop', state.Id); // Intent is recorded BEFORE a possibly partial failure.
    },
    pauseWorker() {
      const state = current('worker'); healthy('worker', state);
      assert.equal(changes.has('worker'), false, 'Worker pause already attempted');
      changes.set('worker', { kind: 'pause', restorationAttempted: false });
      run('pause', state.Id);
    },
    async restore(service) {
      const change = changes.get(service);
      if (!change || change.restorationAttempted) return;
      change.restorationAttempted = true; // Never repeat an uncertain recovery command.
      const state = current(service);
      if (change.kind === 'pause') {
        assert.equal(state.State.Running, true, 'Cannot resume a stopped worker');
        if (state.State.Paused) run('unpause', state.Id);
      } else if (!state.State.Running) {
        run('start', state.Id); // The original container only: no up, pull or rebuild.
      }
      await waitForContractHealth(service, () => current(service), { observe: entry => observations.push(entry) });
      changes.delete(service);
    },
    async cleanup() {
      const errors = [];
      for (const service of changes.keys()) {
        try { await this.restore(service); } catch (error) { errors.push(service + ': ' + String(error)); }
      }
      if (changes.size) errors.push('Unconfirmed restoration: ' + [...changes.keys()].join(', '));
      if (errors.length) throw Error(errors.join('; '));
    },
  };
}
