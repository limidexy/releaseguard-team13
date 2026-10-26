// Deliberately fake only external boundaries inside an owned test child.
// Never forward a process, socket or HTTP call to the real host.
import fs from 'node:fs';
import child from 'node:child_process';
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';
import { basename, join, resolve } from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

const root = process.env.RG_ACCEPTANCE_FIXTURE_ROOT;
if (!root || !basename(root).startsWith('rg-acceptance-')) throw Error('Not an owned fixture');
const append = fs.appendFileSync.bind(fs);
const trace = data => append(join(root, 'evidence', 'boundary.jsonl'), JSON.stringify(data) + '\n');
const deny = kind => { trace({ denied: kind }); throw Error('Owned boundary denied'); };
net.Socket.prototype.connect = () => deny('TCP');
globalThis.fetch = () => deny('fetch');
const result = (bin, args, options) => {
  trace({ command: String(bin), args, cwd: options?.cwd ?? process.cwd() });
  // No shell or command is actually launched. An existing unit failure must
  // still be preserved by the real consumer, not hidden behind a start error.
  if (/npm(?:\.cmd)?(?: |$)/.test(basename(String(bin)))) {
    return { status: Number(process.env.RG_ACCEPTANCE_FIXTURE_NPM_EXIT ?? 23), signal: null,
      stdout: process.env.RG_ACCEPTANCE_FIXTURE_STDOUT ?? 'Owned synthetic unit output\n', stderr: '' };
  }
  if (bin === 'git') {
    if (args[0] === 'rev-parse') return { status: 0, stdout: 'a'.repeat(40) + '\n', stderr: '' };
    if (args[0] === 'status') return { status: 0, stdout: '', stderr: '' };
  }
  return { status: 0, signal: null, stdout: 'Owned synthetic boundary\n', stderr: '' };
};
child.spawnSync = result;
child.execFileSync = (bin, args, options) => result(bin, args, options).stdout;
child.spawn = (bin, args, options) => {
  const r = result(bin, args, options), proc = new EventEmitter();
  proc.stdout = new PassThrough(); proc.stderr = new PassThrough();
  proc.pid = undefined; proc.kill = () => true;
  queueMicrotask(() => { proc.stdout.end(r.stdout); proc.stderr.end(r.stderr); proc.emit('exit', r.status, r.signal); proc.emit('close', r.status, r.signal); });
  return proc;
};
for (const key of ['exec', 'execSync', 'execFile', 'fork']) child[key] = () => deny('process:' + key);
const originalCwd = process.cwd();
if (fs.realpathSync(originalCwd) !== fs.realpathSync(root)) throw Error('Fixture cwd escaped');
syncBuiltinESMExports();
trace({ ready: true });
