// Offline identity gates consumed by the MANUAL CD workflow. No network,
// image publishing, cloud authentication or deployment happens in this module.
import { appendFile, readFile, stat } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

function expectedSource() {
  if (!/^[a-f0-9]{40}$/.test(process.env.EXPECTED_SHA ?? '')) throw new Error('Expected source revision is invalid');
  return process.env.EXPECTED_SHA;
}
function requestIdentity() {
  const source = expectedSource(), id = process.env.RUN_ID ?? '', repository = process.env.REPOSITORY ?? '';
  if (!/^[1-9][0-9]*$/.test(id) || !Number.isSafeInteger(Number(id))) throw new Error('CI run ID is invalid');
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(repository) || ['.', '..'].includes(repository.split('/')[1])) throw new Error('CI repository is invalid');
  return { source, id: Number(id), repository };
}
async function text(file, label, limit = 256) {
  try {
    const info = await stat(file);
    if (!info.isFile() || info.size > limit) throw new Error();
    const value = await readFile(file, 'utf8');
    if (Buffer.byteLength(value) > limit) throw new Error();
    return value.trim();
  } catch { throw new Error('Invalid or unavailable ' + label); }
}
async function validateRun(file) {
  const expected = requestIdentity(); let run;
  try { run = JSON.parse(await text(file, 'CI run metadata', 1_000_000)); }
  catch { throw new Error('Invalid or unavailable CI run metadata'); }
  if (run?.id !== expected.id || run?.status !== 'completed' || run?.conclusion !== 'success' ||
      run?.head_sha !== expected.source || run?.path !== '.github/workflows/ci.yml' ||
      run?.repository?.full_name !== expected.repository || run?.head_repository?.full_name !== expected.repository) throw new Error('CI run does not match the completed verification source and repository');
  if (!process.env.GITHUB_OUTPUT) throw new Error('GitHub output file is required');
  await appendFile(process.env.GITHUB_OUTPUT, 'source=' + expected.source + '\n');
  console.log('Verified CI source identity:', expected.source);
}
async function artifacts(folder) {
  const source = expectedSource();
  if (!/^[A-Za-z0-9][A-Za-z0-9./:_-]*@sha256:[a-f0-9]{64}$/.test(process.env.RG_IMAGE ?? '')) throw new Error('An immutable image digest is required');
  const recordedSource = await text(join(folder, 'source-commit.txt'), 'CI source receipt');
  const config = await text(join(folder, 'image-config-id.txt'), 'CI config receipt');
  if (recordedSource !== source || !/^[a-f0-9]{40}$/.test(recordedSource)) throw new Error('CI artifact source does not match the approved revision');
  if (!/^sha256:[a-f0-9]{64}$/.test(config)) throw new Error('CI config receipt is malformed');
  return { source, config };
}
async function main(args) {
  if (args[0] === 'request' && args.length === 1) { requestIdentity(); return; }
  if (args[0] === 'run' && args.length === 2) return validateRun(args[1]);
  if (args[0] === 'artifacts' && args.length === 2) {
    const receipt = await artifacts(args[1]); console.log('Verified CI artifact source/config:', receipt.source, receipt.config); return;
  }
  if (args[0] === 'pulled' && args.length === 3) {
    const receipt = await artifacts(args[1]), actual = await text(args[2], 'pulled config identity');
    if (!/^sha256:[a-f0-9]{64}$/.test(actual) || actual !== receipt.config) throw new Error('Pulled image config does not match the tested CI config');
    console.log('Verified pulled image config for source:', receipt.source, actual); return;
  }
  throw new Error('Usage: cd-identity.mjs request | run <run.json> | artifacts <receipt-directory> | pulled <receipt-directory> <config-digest-file>');
}
let entry;
try { if (process.argv[1]) entry = pathToFileURL(realpathSync(resolve(process.argv[1]))).href; } catch { /* Imported, not a file entry point. */ }
if (entry === import.meta.url || (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)) {
  try { await main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
