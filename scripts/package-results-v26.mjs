import { readFile, writeFile, cp, mkdir, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseEnv } from 'node:util';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
const target = 'handoff-v26-v8-real';
for (const name of ['model-v6-2026-10-15', 'model-v7-2026-10-16', 'model-v8-2026-10-16', 'scoring-v26-2026-10-16']) {
  await cp('docs/evidence/' + name, target + '/evidence/' + name, { recursive: true, force: false, errorOnExist: true });
}
await mkdir(target + '/reproduction-scripts', { recursive: true });
await cp('scripts/audit-v26.mjs', target + '/reproduction-scripts/audit-v26.mjs', { force: false, errorOnExist: true });
const secrets = [];
for (const file of ['.env', '/Users/ASUS/Desktop/nus- learning/ReleaseGuard_Team13/.env.groq']) {
  const values = parseEnv(await readFile(file, 'utf8'));
  for (const [key, value] of Object.entries(values)) if (/KEY|SECRET|PASSWORD/.test(key) && value.length >= 12) secrets.push(value);
}
async function files(dir) {
  const list = [];
  for (const name of await readdir(dir)) {
    const path = dir + '/' + name;
    if ((await stat(path)).isDirectory()) list.push(...await files(path)); else list.push(path);
  }
  return list.sort();
}
const manifest = [];
for (const path of await files(target)) {
  if (/\/(?:\.env[^/]*|\.git)(?:\/|$)/.test(path)) throw Error('Forbidden packaged path');
  const bytes = await readFile(path), text = bytes.toString('utf8');
  if (secrets.some(s => text.includes(s)) || /\bgsk_[A-Za-z0-9]{25,}|\bgh[pousr]_[A-Za-z0-9]{25,}/.test(text)) throw Error('Secret scan failed for a packaged file; value withheld');
  manifest.push({ path: path.slice(target.length + 1), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await writeFile(target + '/manifest.json', JSON.stringify({ packagedAt: new Date().toISOString(), secretMatches: 0, remotePush: false, files: manifest }, null, 2) + '\n', { flag: 'wx' });
const zip = resolve('../ReleaseGuard_v26_v8_Results_20261016.zip');
try { await stat(zip); throw Error('Refusing to overwrite archive'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
execFileSync('/usr/bin/zip', ['-qr', zip, target], { stdio: 'pipe' });
execFileSync('/usr/bin/unzip', ['-tq', zip], { stdio: 'pipe' });
console.log(JSON.stringify({ archive: zip, files: manifest.length + 1, secretMatches: 0, sha256: createHash('sha256').update(await readFile(zip)).digest('hex') }));
