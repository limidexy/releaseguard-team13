// Only owned synthetic files are accessible. Never permits real network/process fallback.
import fs from 'node:fs/promises';
import fss from 'node:fs';
import net from 'node:net';
import child from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { resolve, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const supplied = process.env.RG_RESCORE_FIXTURE_ROOT;
if (!supplied || !basename(supplied).startsWith('rg-offline-rescore-')) throw Error('Invalid owned fixture');
const root = await fs.realpath(supplied), mode = process.env.RG_RESCORE_FIXTURE_MODE;
const realOpen = fs.open.bind(fs), realRead = fs.readFile.bind(fs), realWrite = fs.writeFile.bind(fs);
const realpath = fss.realpathSync.bind(fss);
const dependencies = await fs.realpath(join(root, 'node_modules')).catch(() => null);
let evaluatorOpens = 0;
function blocked(kind) { console.error('BOUNDARY_ATTEMPT:' + kind); throw Error('Owned offline boundary denied'); }
function check(path, writing = false) {
  let p = resolve(path instanceof URL ? fileURLToPath(path) : String(path));
  if (/(^|[/\\\\])(?:\.env[^/\\\\]*|credentials[^/\\\\]*|secret[^/\\\\]*|tokens?[^/\\\\]*)$/i.test(p)) blocked('credential');
  try { p = realpath(p); } catch { p = resolve(realpath(resolve(p, '..')), basename(p)); }
  if (!(p === root || p.startsWith(root + '/') || (!writing && dependencies && p.startsWith(dependencies + '/')))) blocked('outside-root');
  return p;
}
fs.readFile = async (path, ...args) => { check(path); return realRead(path, ...args); };
fs.open = async (path, ...args) => {
  const flags = args[0];
  const p = check(path, typeof flags === 'number' ? (flags & 3) !== 0 : flags !== 'r');
  if (mode === 'evaluator-changed' && p.endsWith('/dist/src/returns-policy.js') && ++evaluatorOpens === 2) {
    await realWrite(p, (await realRead(p, 'utf8')) + '\n// Synthetic owned concurrent byte change\n');
  }
  const handle = await realOpen(path, ...args);
  if (mode === 'source-sync-failure' && p.endsWith('/source.json')) handle.sync = async () => { throw Error('SYNTHETIC_PRIVATE_DIAGNOSTIC'); };
  if (mode === 'terminal-collision' && p.endsWith('/derivation.json')) {
    await realWrite(join(root, 'evidence/private/rescore-retained', process.env.RG_OFFLINE_RESCORE_RUN_ID, 'terminal.json'), 'original-terminal\n', { flag: 'wx' });
  }
  return handle;
};
for (const name of ['readFileSync', 'openSync']) {
  const real = fss[name].bind(fss);
  fss[name] = (path, ...args) => { check(path); return real(path, ...args); };
}
net.Socket.prototype.connect = function () { blocked('TCP'); };
globalThis.fetch = async () => { blocked('fetch'); };
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'fork']) child[name] = () => { blocked('process'); };
child.execFileSync = (file, args) => {
  if (mode === 'legacy' && file === 'git' && JSON.stringify(args) === '["rev-parse","HEAD"]') return 'synthetic-fixture-not-real-git-provenance\n';
  blocked('process');
};
syncBuiltinESMExports();
