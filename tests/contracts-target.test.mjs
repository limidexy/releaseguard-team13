import assert from 'node:assert/strict';
import test from 'node:test';
import { contractTarget, waitForContractHealth } from '../scripts/contract-target.mjs';

const env = { RG_CONTRACTS_INTEGRATION: '1', COMPOSE_PROJECT_NAME: 'rg-ci-test-owned', RELEASEGUARD_URL: 'http://127.0.0.1:5189' };
const services = ['postgres', 'rabbitmq', 'registry', 'evaluation', 'governance', 'support', 'worker', 'gateway'];
// Docker is the external, destructive boundary. All ownership, orchestration,
// state transitions and recovery decisions remain the actual implementation.
function fixture() {
  const states = new Map(services.map((service, i) => [service, {
    Id: String(i + 1).padStart(64, '0'), Image: 'sha256:' + 'a'.repeat(64),
    Labels: { 'com.docker.compose.project': env.COMPOSE_PROJECT_NAME, 'com.docker.compose.service': service },
    State: { Running: true, Paused: false, Health: { Status: 'healthy' } },
    Ports: service === 'gateway' ? { '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '5189' }] } : {},
  }]));
  const faults = {}, mutations = [];
  let modelEnabled = false, context = 'unix:///var/run/docker.sock';
  const execute = (bin, all, options) => {
    assert.equal(bin, 'docker'); assert.deepEqual(all.slice(0, 2), ['--context', 'default']);
    assert.equal(options.env, env);
    const [command, ...args] = all.slice(2);
    if (command === 'context') {
      assert.deepEqual(args, ['inspect', 'default', '--format', '{{json .Endpoints.docker.Host}}']);
      return JSON.stringify(context);
    }
    if (command === 'version') {
      assert.deepEqual(args, ['--format', '{{.Server.Version}}']); return 'synthetic-offline-engine';
    }
    if (command === 'compose') {
      assert.deepEqual(args.slice(0, 2), ['--project-name', env.COMPOSE_PROJECT_NAME]);
      assert.equal(args[2], '--project-directory'); assert.equal(args[4], '--file');
      assert.equal(args[5], args[3] + 'compose.yaml');
      assert.deepEqual(args.slice(6, 9), ['ps', '--all', '--quiet']);
      return states.get(args[9])?.Id ?? '';
    }
    if (command === 'inspect') {
      assert.equal(args[0], '--format');
      const state = [...states.values()].find(s => s.Id === args[2]);
      if (!state) throw Error('Original container missing');
      return JSON.stringify(state);
    }
    const service = services.find(s => states.get(s)?.Id === args[0]);
    assert.ok(service, 'A command may reference only a captured container ID');
    const state = states.get(service);
    if (command === 'exec') {
      assert.equal(service, 'support');
      assert.deepEqual(args.slice(1), ['node', '-e', "if(process.env.ALLOW_REAL_MODEL!=='false')process.exit(1)"]);
      if (modelEnabled) throw Error('Real model access was not disabled');
      return '';
    }
    assert.ok(['stop', 'start', 'pause', 'unpause'].includes(command), 'No up, pull, build, delete or arbitrary command');
    assert.equal(args.length, 1); mutations.push([command, service]);
    if (faults['before-' + command + '-' + service]) throw Error('Injected command failure');
    if (command === 'stop') state.State.Running = false;
    if (command === 'start') state.State.Running = true;
    if (command === 'pause') state.State.Paused = true;
    if (command === 'unpause') state.State.Paused = false;
    if (faults['after-' + command + '-' + service]) throw Error('Injected partial command failure');
    return state.Id;
  };
  return { states, faults, mutations, target: contractTarget(env, execute),
    enableModel() { modelEnabled = true; }, remoteContext() { context = 'ssh://remote'; } };
}

test('a proven target recovers exactly the original stopped container without recreating dependencies', async () => {
  const f = fixture(), before = structuredClone([...f.states]);
  const proof = await f.target.prove(); assert.equal(Object.keys(proof).length, 8);
  f.target.stop('registry'); assert.equal(f.states.get('registry').State.Running, false);
  await f.target.restore('registry'); await f.target.cleanup();
  assert.deepEqual([...f.states], before);
  assert.deepEqual(f.mutations, [['stop', 'registry'], ['start', 'registry']]);
});

for (const [name, mutate, expected] of [
  ['project-label mismatch', f => f.states.get('registry').Labels['com.docker.compose.project'] = 'releaseguard-team13', /project mismatch/],
  ['service-label mismatch', f => f.states.get('worker').Labels['com.docker.compose.service'] = 'other', /service mismatch/],
  ['endpoint from another project', f => f.states.get('gateway').Ports['8080/tcp'][0].HostPort = '5777', /does not belong/],
  ['wildcard port binding', f => f.states.get('gateway').Ports['8080/tcp'][0].HostIp = '0.0.0.0', /loopback endpoint/],
  ['additional public binding', f => f.states.get('gateway').Ports['8080/tcp'].push({ HostIp: '0.0.0.0', HostPort: '5189' }), /one gateway/],
  ['pre-stopped service', f => f.states.get('evaluation').State.Running = false, /already be running/],
  ['pre-paused worker', f => f.states.get('worker').State.Paused = true, /already be paused/],
  ['missing health check', f => delete f.states.get('governance').State.Health, /must have a health check/],
  ['missing service', f => f.states.delete('registry'), /one existing container/],
  ['remote default context', f => f.remoteContext(), /local Unix socket/],
  ['real model access enabled', f => f.enableModel(), /Real model access/],
]) {
  test('target proof refuses ' + name + ' without a fault or recovery mutation', async () => {
    const f = fixture(); mutate(f);
    await assert.rejects(f.target.prove(), expected);
    assert.throws(() => f.target.stop('evaluation'), /proven first/);
    await f.target.cleanup(); assert.deepEqual(f.mutations, []);
  });
}

test('stop/pause/exec are unavailable before target ownership is established', () => {
  const f = fixture();
  assert.throws(() => f.target.stop('registry'), /proven first/);
  assert.throws(() => f.target.pauseWorker(), /proven first/);
  assert.throws(() => f.target.inside('evaluation', 'ignored'), /proven first/);
  assert.deepEqual(f.mutations, []);
});

test('a partially successful stop is recovered even though the stop command threw', async () => {
  const f = fixture(); await f.target.prove(); f.faults['after-stop-registry'] = true;
  assert.throws(() => f.target.stop('registry'), /partial command failure/);
  assert.equal(f.states.get('registry').State.Running, false);
  await f.target.cleanup();
  assert.equal(f.states.get('registry').State.Running, true);
  assert.deepEqual(f.mutations, [['stop', 'registry'], ['start', 'registry']]);
});

test('a failed stop that did not stop anything does not restart a healthy service', async () => {
  const f = fixture(); await f.target.prove(); f.faults['before-stop-evaluation'] = true;
  assert.throws(() => f.target.stop('evaluation'), /command failure/);
  await f.target.cleanup();
  assert.deepEqual(f.mutations, [['stop', 'evaluation']]);
  assert.equal(f.states.get('evaluation').State.Running, true);
});

test('partial worker pause is undone without stopping any service', async () => {
  const f = fixture(); await f.target.prove(); f.faults['after-pause-worker'] = true;
  assert.throws(() => f.target.pauseWorker(), /partial command failure/);
  assert.equal(f.states.get('worker').State.Paused, true);
  await f.target.cleanup(); assert.equal(f.states.get('worker').State.Paused, false);
  assert.deepEqual(f.mutations, [['pause', 'worker'], ['unpause', 'worker']]);
});

test('one uncertain recovery is reported without retry, while other touched services still recover', async () => {
  const f = fixture(); await f.target.prove(); f.target.stop('registry'); f.target.stop('evaluation'); f.target.pauseWorker();
  f.faults['after-start-registry'] = true;
  await assert.rejects(f.target.cleanup(), /Unconfirmed restoration: registry/);
  assert.equal(f.states.get('evaluation').State.Running, true);
  assert.equal(f.states.get('worker').State.Paused, false);
  await assert.rejects(f.target.cleanup(), /Unconfirmed restoration: registry/);
  assert.equal(f.mutations.filter(([cmd, service]) => cmd === 'start' && service === 'registry').length, 1);
});

for (const [name, mutate, expected] of [
  ['changed image', state => state.Image = 'sha256:' + 'b'.repeat(64), /image changed/],
  ['changed project', state => state.Labels['com.docker.compose.project'] = 'other', /project mismatch/],
]) {
  test('recovery refuses ' + name + ' instead of starting a different artifact', async () => {
    const f = fixture(); await f.target.prove(); f.target.stop('registry'); mutate(f.states.get('registry'));
    await assert.rejects(f.target.cleanup(), expected);
    assert.deepEqual(f.mutations, [['stop', 'registry']]);
  });
}

test('recovery does not adopt a replacement container with the same service label', async () => {
  const f = fixture(); await f.target.prove(); f.target.stop('evaluation'); f.states.get('evaluation').Id = 'f'.repeat(64);
  await assert.rejects(f.target.cleanup(), /Original container missing/);
  assert.deepEqual(f.mutations, [['stop', 'evaluation']]);
});

test('an unhealthy process that never passes a probe remains a deadline failure', async () => {
  const state = { State: { Running: true, Paused: false, Health: { Status: 'unhealthy', FailingStreak: 1 } } }, observed = [];
  await assert.rejects(waitForContractHealth('worker', () => state, { timeoutMs: 1, pollMs: 1, observe: e => observed.push(e) }), /Health readiness deadline exceeded/);
  assert.deepEqual(observed.map(e => e.status), ['unhealthy']);
  assert.equal(state.State.Health.Status, 'unhealthy'); // No rewrite or restart.
});

test('post-unpause health is observed until a new successful probe, retaining both statuses', async () => {
  let calls = 0; const observed = [];
  const read = () => ({ State: { Running: true, Paused: false, Health: { Status: ++calls === 1 ? 'unhealthy' : 'healthy', FailingStreak: 0 } } });
  const state = await waitForContractHealth('worker', read, { timeoutMs: 1000, pollMs: 1, observe: e => observed.push(e) });
  assert.equal(state.State.Health.Status, 'healthy');
  assert.equal(calls, 2); assert.deepEqual(observed.map(e => e.status), ['unhealthy', 'healthy']);
});

test('readiness does not hide container identity changes observed while waiting', async () => {
  let calls = 0;
  await assert.rejects(waitForContractHealth('worker', () => {
    if (++calls > 1) throw Error('Container image changed');
    return { State: { Running: true, Paused: false, Health: { Status: 'unhealthy' } } };
  }, { timeoutMs: 1000, pollMs: 1 }), /Container image changed/);
});

test('no fault is allowed against storage, broker, gateway or other non-fault services', async () => {
  const f = fixture(); await f.target.prove();
  for (const service of ['postgres', 'rabbitmq', 'gateway', 'support', 'governance', 'worker']) {
    assert.throws(() => f.target.stop(service), /only Registry\/Evaluation/);
  }
  await f.target.cleanup(); assert.deepEqual(f.mutations, []);
});
