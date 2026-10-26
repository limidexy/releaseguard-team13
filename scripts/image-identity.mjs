import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';

// Docker's legacy store reports the config digest as Id; containerd can report
// the manifest digest. Compare the actual OCI config, not that ambiguous field.
export function configDigest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || Object.hasOwn(manifest, 'manifests') ||
      !/^sha256:[a-f0-9]{64}$/.test(manifest.config?.digest ?? '')) throw new Error('Expected a single-platform image manifest');
  return manifest.config.digest;
}

function parseJSON(bytes, label) {
  try { return JSON.parse(bytes.toString()); }
  catch { throw new Error('Invalid ' + label + ' JSON'); }
}
function tar(args) {
  try {
    // Never extract files, inherit TAR_OPTIONS, invoke a shell or dump archive
    // contents in a subprocess error. The selected entries are bounded.
    return execFileSync('tar', args, { maxBuffer: 2e6, timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH, LANG: 'C', LC_ALL: 'C', ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) } });
  } catch { throw new Error('Cannot read the requested image archive metadata'); }
}
async function archiveConfig(archive, output) {
  const file = resolve(archive), names = tar(['-tf', file]).toString().split(/\r?\n/);
  if (names.filter(name => name === 'manifest.json').length !== 1) throw new Error('Expected exactly one archive manifest');
  const entries = parseJSON(tar(['-xOf', file, '--', 'manifest.json']), 'archive manifest');
  if (!Array.isArray(entries) || entries.length !== 1 || !entries[0] || typeof entries[0].Config !== 'string') throw new Error('Unexpected archive identity');
  const member = entries[0].Config;
  const match = member.match(/^(?:blobs\/sha256\/([a-f0-9]{64})|([a-f0-9]{64})\.json)$/);
  if (!match || names.filter(name => name === member).length !== 1) throw new Error('Expected one canonical archive config entry');
  const raw = tar(['-xOf', file, '--', member]);
  const config = parseJSON(raw, 'image config');
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Expected an image config object');
  const digest = 'sha256:' + createHash('sha256').update(raw).digest('hex');
  if (digest.slice(7) !== (match[1] ?? match[2])) throw new Error('Archive config integrity mismatch');
  // Additive evidence only: an old report or the input archive is never replaced.
  await writeFile(output, digest + '\n', { flag: 'wx' });
  console.log('Verified archive config identity:', digest);
}
async function main(args) {
  if (args.length !== 3 || !['archive', 'compare'].includes(args[0])) throw new Error('Usage: image-identity.mjs archive <archive> <new-output> | compare <manifest> <expected-config-digest>');
  if (args[0] === 'archive') return archiveConfig(args[1], args[2]);
  const actual = configDigest(parseJSON(await readFile(args[1]), 'published manifest'));
  const expected = (await readFile(args[2], 'utf8')).trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(expected) || actual !== expected) throw new Error('Published image does not have the tested config digest');
  console.log('Published image matches CI-tested config:', actual);
}
// Imported modules have no CLI side effects, even if their caller has mode args.
let entry;
try { if (process.argv[1]) entry = pathToFileURL(realpathSync(resolve(process.argv[1]))).href; } catch { /* Imported by an eval/test caller, not a file entry point. */ }
if (entry === import.meta.url || (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)) {
  try { await main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
