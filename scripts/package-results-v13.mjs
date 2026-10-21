import { readFile, writeFile, cp, mkdir, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseEnv } from 'node:util';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
const target = 'handoff-v28-v13-real';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const copy = (from, to) => cp(from, to, { recursive: true, force: false, errorOnExist: true });
for (const name of ['model-v6-2026-10-15', 'model-v7-2026-10-16', 'model-v8-2026-10-16', 'scoring-v26-2026-10-16', 'model-v9-2026-10-16', 'model-v10-2026-10-16', 'model-v11-2026-10-16', 'model-v12-2026-10-16', 'model-v13-2026-10-16']) {
  await copy('docs/evidence/' + name, target + '/evidence/' + name);
}
const original = '/Users/ASUS/Desktop/nus- learning/ReleaseGuard_Team13/docs/evidence/';
for (const name of ['plan.json', 'real-v3-2026-10-14T14-06-07.034Z.json', 'real-v4-2026-10-14T14-15-23.420Z.json', 'real-v5-2026-10-14T14-25-15.496Z.json']) {
  const dir = target + '/evidence/model-v3-2026-10-14';
  await mkdir(dir, { recursive: true });
  await copy(original + 'model-v3-2026-10-14/' + name, dir + '/' + name);
}
await mkdir(target + '/evidence/cloud-2026-10-11-retest', { recursive: true });
await copy(original + 'cloud-2026-10-11-retest/prompt-comparison-real-1791729589074.json', target + '/evidence/cloud-2026-10-11-retest/prompt-comparison-real-1791729589074.json');
await mkdir(target + '/reproduction-scripts', { recursive: true });
for (const name of ['audit-v26.mjs', 'audit-v27-baseline.mjs', 'verify-model-v10.mjs', 'summarize-model-v10.mjs', 'audit-v28-baseline.mjs', 'verify-model-v11.mjs', 'summarize-model-v11.mjs', 'verify-model-v12.mjs', 'summarize-model-v12.mjs', 'verify-model-v13.mjs', 'summarize-model-v13.mjs', 'verify-controlled-v13-local.mjs']) await copy('scripts/' + name, target + '/reproduction-scripts/' + name);
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
  if (secrets.some(s => text.includes(s)) || /\bgsk_[A-Za-z0-9]{25,}|\bgh[pousr]_[A-Za-z0-9]{25,}/.test(text)) throw Error('Secret scan failed; value withheld');
  manifest.push({ path: path.slice(target.length + 1), bytes: bytes.length, sha256: sha(bytes) });
}
await writeFile(target + '/manifest.json', JSON.stringify({ packagedAt: new Date().toISOString(), secretMatches: 0, remotePush: false, files: manifest }, null, 2) + '\n', { flag: 'wx' });
const zip = resolve('../ReleaseGuard_v28_v13_Results_20261016.zip');
try { await stat(zip); throw Error('Refusing to overwrite archive'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
execFileSync('/usr/bin/zip', ['-qr', zip, target], { stdio: 'pipe' });
execFileSync('/usr/bin/unzip', ['-tq', zip], { stdio: 'pipe' });
console.log(JSON.stringify({ archive: zip, files: manifest.length + 1, secretMatches: 0, sha256: sha(await readFile(zip)) }));
