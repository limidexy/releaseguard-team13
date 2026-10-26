// Owned files plus a strict, non-forwarding Docker protocol fixture.
import fs from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
export const fixtureRunId = 'f7df9b5c-08e9-4d1d-9c73-7cbd99bcb50a';
export function targetFixture({ existingRoot } = {}) {
  const tmp = existingRoot ? dirname(existingRoot) : fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'rg-acceptance-target-')));
  const root = existingRoot ?? join(tmp, 'repo'), runDir = join(root, 'evidence/private/acceptance', fixtureRunId), cwd = join(runDir, 'worktree');
  if (!existingRoot) {
  fs.mkdirSync(root, { mode: 0o700 }); fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(join(root, 'dist')); fs.mkdirSync(join(root, 'dependencies'));
  fs.symlinkSync(join(root, 'dependencies'), join(root, 'node_modules'), 'dir');
  fs.writeFileSync(join(root, 'dist/fixture.js'), 'export const fixture = true;\n');
  fs.writeFileSync(join(root, 'package.json'), '{"type":"module","private":true}\n');
  fs.writeFileSync(join(root, 'compose.yaml'), fs.readFileSync(resolve('compose.yaml')));
  const env = ['AUTH_SECRET', 'INTERNAL_SECRET', 'POSTGRES_PASSWORD', 'REGISTRY_DB_PASSWORD', 'EVALUATION_DB_PASSWORD', 'GOVERNANCE_DB_PASSWORD', 'RABBIT_PASSWORD']
    .map((key, i) => key + '=' + String(i + 1).repeat(64)).join('\n') + '\n';
  fs.writeFileSync(join(root, '.env'), env, { mode: 0o600 });
  }
  const sourceFiles = existingRoot ? [] : ['package.json', 'compose.yaml'].map(path => ({ path, sha256: createHash('sha256').update(fs.readFileSync(join(root, path))).digest('hex') }));
  const names = ['postgres', 'rabbitmq', 'registry', 'evaluation', 'governance', 'support', 'worker', 'gateway'];
  const project = 'rg-contracts-' + fixtureRunId;
  const ids = { app: 'sha256:' + 'a'.repeat(64), pg: 'sha256:' + 'b'.repeat(64), rabbit: 'sha256:' + 'c'.repeat(64) };
  const states = new Map(), aliases = new Map(), calls = [], events = [];
  const engine = { id: 'owned-offline-engine', host: 'unix:///owned/offline.sock', images: [], volumes: [], networks: ['bridge', 'host', 'none'], modelDisabled: true, expired: false };
  const config = { name: project, services: Object.fromEntries(names.map(service => [service, {
    image: service === 'postgres' ? 'releaseguard-postgres-v2:local' : service === 'rabbitmq' ? 'rabbitmq:4-management-alpine' : 'releaseguard-course-v2:local',
    ...(['postgres', 'rabbitmq'].includes(service) ? {} : { build: { context: cwd }, environment: { AUTH_MODE: 'dev', ALLOW_DEV_AUTH: 'true', SERVICE_ROLE: service } }),
  }])), volumes: { pgdata: { name: project + '_pgdata' }, rabbitdata: { name: project + '_rabbitdata' } }, networks: { default: { name: project + '_default' } } };
  config.services.postgres.build = { context: cwd, dockerfile: 'deploy/postgres/Dockerfile' };
  config.services.postgres.volumes = [{ type: 'volume', source: 'pgdata', target: '/var/lib/postgresql/data' }];
  config.services.rabbitmq.volumes = [{ type: 'volume', source: 'rabbitdata', target: '/var/lib/rabbitmq' }];
  Object.assign(config.services.support.environment, { ALLOW_REAL_MODEL: 'false', MODEL_API_URL: '', MODEL_API_KEY: '', MODEL_ID: '' });
  config.services.gateway.ports = [{ host_ip: '127.0.0.1', published: '5189', target: 8080, protocol: 'tcp' }];
  function execute(bin, args, options) {
    if (bin !== 'docker' || args[0] !== '--context' || args[1] !== 'default' || options.env.DOCKER_CONFIG !== join(runDir, 'docker-config')) throw Error('Unexpected process boundary');
    const a = args.slice(2); calls.push([...a]);
    if (a[0] === 'context' && a[1] === 'inspect') return JSON.stringify(engine.host);
    if (a[0] === 'info') return JSON.stringify(engine.id);
    if (a.join(' ') === 'ps -aq') return [...states.keys()].join('\n');
    if (a.join(' ') === 'image ls -aq') return engine.images.join('\n');
    if (a.join(' ') === 'volume ls -q') return engine.volumes.join('\n');
    if (a[0] === 'network' && a[1] === 'ls') return engine.networks.join('\n');
    if (a.join(' ') === 'compose config --format json') return JSON.stringify(config);
    if (a[0] === 'image' && a[1] === 'inspect') { const id = aliases.get(a[2]); if (!id) throw Error('Image absent'); return JSON.stringify(id); }
    if (a[0] === 'inspect') { const s = states.get(a.at(-1)); if (!s) throw Error('Container absent'); return JSON.stringify(s); }
    if (a[0] === 'exec') {
      const s = states.get(a[1]);
      if (s?.Labels['com.docker.compose.service'] !== 'support' || a.at(-1) !== "if(process.env.ALLOW_REAL_MODEL!=='false')process.exit(1)") throw Error('Unexpected exec');
      if (!engine.modelDisabled) throw Error('PRIVATE_SYNTHETIC_ERROR'); return '';
    }
    if (a[0] === 'stop' || a[0] === 'unpause') {
      const s = states.get(a.at(-1)); if (!s) throw Error('No owned container');
      if (a[0] === 'stop') s.State.Running = false; else s.State.Paused = false;
      return s.Id;
    }
    throw Error('No external fallback for ' + a[0]);
  }
  function build() { aliases.set('releaseguard-course-v2:local', ids.app); aliases.set('releaseguard-postgres-v2:local', ids.pg); engine.images = [ids.app, ids.pg]; }
  function start() {
    aliases.set('rabbitmq:4-management-alpine', ids.rabbit);
    for (const [i, service] of names.entries()) {
      const Id = String(i + 1).padStart(64, '0');
      states.set(Id, { Id, Image: service === 'postgres' ? ids.pg : service === 'rabbitmq' ? ids.rabbit : ids.app,
        Labels: { 'com.docker.compose.project': project, 'com.docker.compose.service': service, 'com.docker.compose.project.working_dir': cwd },
        State: { Running: true, Paused: false, Health: { Status: 'healthy', FailingStreak: 0 } },
        Ports: service === 'gateway' ? { '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '5189' }] } : {} });
    }
  }
  return { root, runDir, cwd, sourceFiles, execute, engine, config, states, aliases, ids, calls, events, build, start,
    options: { root, runDir, runId: fixtureRunId, env: { PATH: process.env.PATH, npm_config_offline: 'true' }, sourceFiles,
      remaining: () => { if (engine.expired) throw Error('Original work deadline expired'); return 100000; }, record: async e => events.push(JSON.parse(JSON.stringify(e))) },
    cleanup: () => { if (existingRoot) throw Error('Fixture does not own supplied root cleanup'); fs.rmSync(tmp, { recursive: true, force: true }); } };
}
