// Full CLI wiring fixture: real parent/target/receipt code, owned private files,
// and only the external process/socket boundaries replaced. No real Docker.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import child from 'node:child_process';
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { basename, join, resolve } from 'node:path';
import { targetFixture, fixtureRunId as id } from './acceptance-target-fixture.mjs';
import { promptReceipt, repeatedReceipt, mixedReceipt } from './acceptance-evidence-fixture.mjs';
const supplied = process.env.RG_ACCEPTANCE_FULL_FIXTURE_ROOT;
if (!supplied || !basename(supplied).startsWith('rg-acceptance-full-')) throw Error('Not an owned full fixture');
const root = fs.realpathSync(supplied);
if (fs.realpathSync(process.cwd()) !== root) throw Error('Wrong full fixture cwd');
const mode = process.env.RG_ACCEPTANCE_FULL_FIXTURE_MODE ?? 'pass', f = targetFixture({ existingRoot: root });
const append = fs.appendFileSync.bind(fs), write = fs.writeFileSync.bind(fs), read = fs.readFileSync.bind(fs), open = fsp.open.bind(fsp);
const trace = v => append(join(root, 'evidence/full-boundary.jsonl'), JSON.stringify(v) + '\n');
const deny = kind => { trace({ denied: kind }); throw Error('Owned boundary denied'); };
let emptyProven = false;
const intents = new Map(), stopIntents = new Set(), unpauseIntents = new Set();
if (mode === 'foreign-engine') f.engine.images = ['unrelated-image'];
if (mode === 'model-config') f.config.services.support.environment.ALLOW_REAL_MODEL = 'true';
if (mode === 'model-runtime') f.engine.modelDisabled = false;
fsp.open = async (path, flags, ...args) => {
  const p = String(path);
  if (p.endsWith('/.env') && !(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR))) {
    if (!emptyProven) deny('credential_before_empty_engine_proof'); trace({ credentialReadAfterProof: true });
  }
  const h = await open(path, flags, ...args), writeFile = h.writeFile.bind(h), sync = h.sync.bind(h); let value;
  h.writeFile = async b => { try { value = JSON.parse(String(b)); } catch {} return writeFile(b); };
  h.sync = async () => {
    if (mode === 'log-sync' && p.endsWith('/logs/container-start.log')) throw Error('PRIVATE_DUMMY_DIAGNOSTIC');
    await sync();
    if (value?.kind === 'command_intent') intents.set(value.name, value);
    if (value?.kind === 'cleanup_stop_intent') stopIntents.add(value.id);
    if (value?.kind === 'cleanup_unpause_intent') unpauseIntents.add(value.id);
  };
  return h;
};
function docker(args, options) {
  trace({ docker: args.slice(2), context: args.slice(0, 2), cwd: options.cwd });
  const a = args.slice(2);
  if (a[0] === 'stop' && !stopIntents.has(a.at(-1))) deny('stop_without_durable_intent');
  if (a[0] === 'unpause' && !unpauseIntents.has(a.at(-1))) deny('unpause_without_durable_intent');
  const r = f.execute('docker', args, options);
  if (a[0] === 'network' && a[1] === 'ls' && !f.engine.images.length && !f.engine.volumes.length && !f.states.size) emptyProven = true;
  return r;
}
function save(relative, value) { const p = join(f.cwd, relative); fs.mkdirSync(join(p, '..'), { recursive: true, mode: 0o700 }); write(p, JSON.stringify(value, null, 2) + '\n'); }
const checkReport = count => ({ status: 'passed', passed: count, failed: 0, checks: Array.from({ length: count }, (_, i) => ({ name: 'Synthetic contract ' + i, passed: true })) });
function run(bin, args, options) {
  let name;
  if (/npm(?:\.cmd)?(?: |$)/.test(basename(bin))) name = args[0] === 'audit' ? 'dependency-audit' : 'unit-tests';
  else if (bin === 'docker') name = args[1] === 'build' ? 'container-build' : args[1] === 'up' ? 'container-start' : undefined;
  else name = ({ 'verify.mjs': 'integration', 'verify-improvements.mjs': 'improvements', 'verify-contracts.mjs': 'ddd-contracts',
    'fault-test.mjs': 'fault-recovery', 'compare-prompts.mjs': 'prompt-replay', 'benchmark-repeated.mjs': 'repeated-scaling', 'mixed-load.mjs': 'mixed-read-write' })[basename(args[0] ?? '')];
  if (!name || !intents.has(name)) deny('command_without_durable_intent');
  const intent = intents.get(name); if (intent.command !== bin || JSON.stringify(intent.args) !== JSON.stringify(args)) deny('wrong_command_or_arguments');
  trace({ step: name, args, cwd: options.cwd, project: options.env.COMPOSE_PROJECT_NAME ?? null, mixedId: options.env.RG_MIXED_LOAD_RUN_ID ?? null });
  if (name !== 'unit-tests' && (options.cwd !== f.cwd || options.env.COMPOSE_PROJECT_NAME !== 'rg-contracts-' + id || options.env.ALLOW_REAL_MODEL !== 'false')) deny('consumer_escaped_scope');
  if (name === 'container-build') f.build();
  if (name === 'container-start') {
    f.start();
    if (mode === 'partial-up') { for (const s of [...f.states.values()].slice(3)) f.states.delete(s.Id); return { status: 17, stdout: '', stderr: 'partial fake startup' }; }
  }
  if (name === 'integration' && mode !== 'missing-report') save('evidence/integration-local.json', checkReport(18));
  if (name === 'improvements') save('evidence/current/improvements-integration.json', checkReport(4));
  if (name === 'ddd-contracts') save('evidence/contracts-' + id + '/ddd-contracts.json', checkReport(18));
  if (name === 'fault-recovery') save('evidence/fault-local.json', { passed: true, attempts: 2 });
  if (name === 'prompt-replay') save('evidence/current/prompt-comparison-replay-1.json', promptReceipt());
  if (name === 'repeated-scaling') save('evidence/current/scaling-repeated.json', repeatedReceipt());
  if (name === 'mixed-read-write') {
    if (options.env.RG_MIXED_LOAD_RUN_ID !== id || options.env.RG_MIXED_LOAD_INTEGRATION !== '1') deny('mixed_child_without_reserved_id');
    const r = mixedReceipt(); if (mode === 'bad-mixed') r.stages[0].raw[3].status = 503;
    save('evidence/private/mixed-load/' + id + '/report.json', r);
    save('evidence/private/mixed-load/' + id + '/terminal.json', { runId: id, status: 'completed', realProviderCalls: 0, report: 'report.json' });
  }
  return { status: 0, stdout: name === 'dependency-audit' ? '{"metadata":{"vulnerabilities":{"high":0,"critical":0}}}' : 'Synthetic offline child completed\n', stderr: '' };
}
child.execFileSync = (bin, args, options) => {
  if (bin === 'git') return args[0] === 'rev-parse' ? 'a'.repeat(40) + '\n' : args[0] === 'status' ? '' : deny('git');
  if (bin !== 'docker') deny('readonly_process'); return docker(args, options);
};
child.spawn = (bin, args, options) => {
  const r = run(bin, args, options), p = new EventEmitter(); p.stdout = new PassThrough(); p.stderr = new PassThrough(); p.pid = undefined;
  queueMicrotask(() => { p.stdout.end(r.stdout); p.stderr.end(r.stderr); p.emit('close', r.status, null); }); return p;
};
for (const name of ['spawnSync', 'exec', 'execSync', 'execFile', 'fork']) child[name] = () => deny('unexpected_process:' + name);
net.Socket.prototype.connect = () => deny('TCP'); globalThis.fetch = () => deny('fetch');
syncBuiltinESMExports(); trace({ ready: true, syntheticOnly: true });
