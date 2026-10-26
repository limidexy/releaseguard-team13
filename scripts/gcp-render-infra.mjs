// Explicit offline plan writer. No subprocess, network, key generation or apply step.
import { constants, realpathSync } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, dirname, join, parse, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderGcpInfrastructure } from './gcp-infra-core.mjs';
const script = fileURLToPath(import.meta.url), root = resolve(dirname(script), '..');
const hash = data => createHash('sha256').update(data).digest('hex');
const refuse = () => { throw Error('Offline render refused'); };
async function noLinks(path) {
  let current = parse(path).root;
  for (const part of relative(current, path).split(/[\\/]/).filter(Boolean)) {
    current = join(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink()) refuse();
  }
}
async function readRegular(path, max = 65536) {
  await noLinks(path);
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size > max) refuse();
    const bytes = await file.readFile();
    const after = await file.stat();
    if (bytes.length > max || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) refuse();
    return bytes;
  } finally { await file.close(); }
}
async function ensureDirectory(path, privateMode) {
  let created = false;
  try { await mkdir(path, { mode: 0o700 }); created = true; } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() ||
      privateMode && ((info.mode & 0o077) !== 0 || info.uid !== process.getuid())) refuse();
  if (created) await syncDirectory(dirname(path));
}
async function syncDirectory(path) {
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try { if (!(await file.stat()).isDirectory()) refuse(); await file.sync(); } finally { await file.close(); }
}
async function writeExclusive(directory, name, value) {
  await noLinks(directory);
  const file = await open(join(directory, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
  try { await file.writeFile(value); await file.sync(); } finally { await file.close(); }
  await syncDirectory(directory);
}
export async function runOfflineInfrastructureRenderer(args) {
  let phase = 'arguments', output;
  try {
    if (process.platform === 'win32' || Number(process.versions.node.split('.')[0]) < 24) refuse();
    if (args.length !== 5 || args[0] !== '--offline' || args[1] !== '--config' || args[3] !== '--run-id' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(args[4] ?? '')) refuse();
    if ((await lstat(process.argv[1] ?? script)).isSymbolicLink()) refuse();
    const configPath = resolve(args[2]);
    if (/^(?:\.env(?:\.|$)|secrets?(?:\.|$)|id_(?:rsa|ed25519))|\.(?:key|pem|crt)$/.test(basename(configPath))) refuse();
    phase = 'inputs';
    const configBytes = await readRegular(configPath);
    const config = JSON.parse(configBytes.toString('utf8'));
    const sqlBytes = await readRegular(join(root, 'deploy', 'postgres', 'init.sql'));
    const result = renderGcpInfrastructure(config, sqlBytes.toString('utf8'));
    const sources = {};
    for (const path of ['scripts/gcp-render-infra.mjs', 'scripts/gcp-infra-core.mjs', 'deploy/postgres/init.sql']) {
      sources[path] = hash(await readRegular(join(root, path)));
    }
    phase = 'reservation';
    await noLinks(root);
    let parent = root;
    for (const [part, privateMode] of [['evidence', false], ['private', true], ['gcp-renders', true]]) {
      parent = join(parent, part); await ensureDirectory(parent, privateMode);
    }
    const proposed = join(parent, args[4]);
    await mkdir(proposed, { mode: 0o700 }); // Existing IDs, including partial failures, never resume.
    output = proposed;
    await syncDirectory(parent);
    await writeExclusive(output, 'started.json', JSON.stringify({
      formatVersion: 1, runId: args[4], state: 'started', planOnly: true,
      inputConfigSHA256: hash(configBytes), sourceSHA256: sources,
      sourceHashesAreNotGitOrBuildAttestations: true,
    }, null, 2) + '\n');
    phase = 'output';
    const outputs = {};
    for (const [name, data] of [['infra.json', result.infrastructure], ['requirements.json', result.requirements]]) {
      const bytes = JSON.stringify(data, null, 2) + '\n';
      await writeExclusive(output, name, bytes); outputs[name] = hash(bytes);
    }
    await writeExclusive(output, 'completed.json', JSON.stringify({
      formatVersion: 1, runId: args[4], state: 'rendered_not_applied', planOnly: true,
      outputSHA256: outputs, inputConfigSHA256: hash(configBytes), sourceSHA256: sources,
      privateInputsSupplied: false, deploymentVerified: false, runtimeModelStateVerified: false,
    }, null, 2) + '\n');
    console.log('Offline infrastructure plan rendered. Private inputs remain required; no key, identity, model or deployment operation performed.');
    return 0;
  } catch {
    if (output) {
      try { await writeExclusive(output, 'failed.json', JSON.stringify({ state: 'failed', phase, planOnly: true, resumeAllowed: false }) + '\n'); } catch { /* Existing/unknown evidence is never overwritten. */ }
    }
    console.error('Offline infrastructure render refused (' + phase + '). No input value or credential is printed; no deployment performed.');
    return 1;
  }
}
function isMain() {
  try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(script); } catch { return false; }
}
if (isMain()) process.exitCode = await runOfflineInfrastructureRenderer(process.argv.slice(2));

