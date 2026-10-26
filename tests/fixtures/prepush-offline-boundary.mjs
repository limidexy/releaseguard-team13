// This preload is used only by owned hook fixtures, never by a user checkout.
import fs from 'node:fs';
import net from 'node:net';
import child from 'node:child_process';
import { basename, resolve } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
const root = fs.realpathSync(process.env.RG_HOOK_FIXTURE_ROOT ?? '');
if (!/[/\\]rg-hook-[^/\\]+[/\\]repo$/.test(root) || fs.realpathSync(process.cwd()) !== root) throw Error('Owned offline hook fixture required');
const marker = resolve(root, 'forbidden-boundary');
function deny(kind) {
  fs.writeFileSync(marker, kind);
  console.error('BOUNDARY_ATTEMPT:' + kind);
  throw Error('Offline hook boundary denied');
}
net.Socket.prototype.connect = () => deny('TCP');
globalThis.fetch = () => deny('fetch');
const execFileSync = child.execFileSync, spawnSync = child.spawnSync, spawn = child.spawn;
const gitRead = args => JSON.stringify(args) === JSON.stringify(['ls-files', '-z']) || JSON.stringify(args) === JSON.stringify(['rev-parse', 'HEAD']);
const npmTest = (command, args) => command === 'npm' && JSON.stringify(args) === '["test"]' || command === 'npm.cmd test' && args.length === 0;
const unitShell = (command, args) => ['sh', 'cmd.exe'].includes(basename(command).toLowerCase()) &&
  args.length >= 2 && args.slice(0, -1).every(a => ['-c', '/d', '/s', '/c'].includes(a.toLowerCase())) &&
  ['node unit.mjs', '"node unit.mjs"'].includes(args.at(-1));
child.execFileSync = (command, args, options) => {
  if (command !== 'git' || !gitRead(args)) deny('execFileSync');
  return execFileSync(command, args, options);
};
child.spawnSync = (command, args = [], options) => {
  if (!npmTest(command, args)) deny('spawnSync');
  return spawnSync(command, args, options);
};
child.spawn = (command, args = [], options) => {
  if (!unitShell(command, args)) deny('spawn');
  return spawn(command, args, options);
};
for (const name of ['exec', 'execSync', 'execFile', 'fork']) child[name] = () => deny(name);
syncBuiltinESMExports();
