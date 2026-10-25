import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url)), name = process.argv[2];
assert(/^http-(?:baseline|green)(?:-[a-z0-9-]+)?-result\.json$/.test(name));
const original = JSON.parse(await fs.readFile(root + 'evidence/' + name)), exec = promisify(execFile);
const readback = { at: new Date().toISOString(), originalEvidence: name, originalUnmodified: true, mutations: 0, containers: [], remainingByLabels: [] };
const absent = async identity => {
  try { const { stdout } = await exec('docker', ['inspect', '--format', '{{.Id}}', identity]); return stdout.trim() === ''; }
  catch (error) { if (/no such (object|container)/i.test(error.stderr ?? error.message)) return true; throw error; }
};
for (const row of original.cleanup) {
  assert(/^rg-r10-http-(?:pg|mq)-[a-f0-9]{10}$/.test(row.name)); assert(/^[a-f0-9]{64}$/.test(row.id));
  const tag = row.name.slice(-10);
  const { stdout } = await exec('docker', ['ps', '-aq', '--filter', 'label=releaseguard.r10.http=' + tag]);
  const labelled = stdout.trim().split('\n').filter(Boolean);
  readback.containers.push({ name: row.name, id: row.id, nameAbsent: await absent(row.name), idAbsent: await absent(row.id) });
  readback.remainingByLabels.push({ tag, containers: labelled });
}
readback.verifiedAllRemoved = readback.containers.every(row => row.nameAbsent && row.idAbsent) && readback.remainingByLabels.every(row => row.containers.length === 0);
await fs.writeFile(root + 'evidence/' + name.replace('-result.json', '-postcleanup-readback.json'), JSON.stringify(readback, null, 2), { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify(readback)); if (!readback.verifiedAllRemoved) process.exitCode = 1;
