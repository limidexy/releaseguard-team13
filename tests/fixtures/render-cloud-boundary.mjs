// The render CLI may use only local files, never credentials or an external tool.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import child from 'node:child_process';
import net from 'node:net';
import { basename, join } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
const root = fs.realpathSync(process.env.RG_RENDER_FIXTURE_ROOT ?? '');
if (!/[/\\]rg-render-[^/\\]+$/.test(root)) throw Error('Owned render fixture required');
function deny(kind) { fs.writeFileSync(join(root, 'forbidden-boundary'), kind); console.error('BOUNDARY_ATTEMPT:' + kind); throw Error('Forbidden render boundary'); }
function check(path) {
  const name = basename(path instanceof URL ? path.pathname : String(path));
  if (/^\.env(?:\.|$)|^id_(?:rsa|ed25519)$|^secrets(?:\.|$)/.test(name)) deny('credential');
}
for (const name of ['readFileSync', 'openSync']) {
  const original = fs[name]; fs[name] = (path, ...args) => { check(path); return original(path, ...args); };
}
for (const name of ['readFile', 'open']) {
  const original = fsp[name]; fsp[name] = (path, ...args) => { check(path); return original(path, ...args); };
}
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) child[name] = () => deny('process');
net.Socket.prototype.connect = () => deny('TCP');
globalThis.fetch = () => deny('fetch');
syncBuiltinESMExports();
