import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

// Docker's legacy store reports the config digest as Id; containerd can report
// the manifest digest. Compare the actual OCI config, not that ambiguous field.
export function configDigest(manifest) {
  if (!/^sha256:[a-f0-9]{64}$/.test(manifest?.config?.digest ?? '')) throw new Error('Expected a single-platform image manifest');
  return manifest.config.digest;
}
if (process.argv[2] === 'archive') {
  const archive = process.argv[3];
  const entries = JSON.parse(execFileSync('tar', ['-xOf', archive, 'manifest.json'], {maxBuffer: 2e6}));
  if (entries.length !== 1 || !/^blobs\/sha256\/[a-f0-9]{64}$/.test(entries[0].Config)) throw new Error('Unexpected archive identity');
  const raw = execFileSync('tar', ['-xOf', archive, entries[0].Config], {maxBuffer: 2e6});
  const digest = 'sha256:' + createHash('sha256').update(raw).digest('hex');
  if (digest.slice(7) !== entries[0].Config.split('/').at(-1)) throw new Error('Archive config integrity mismatch');
  await writeFile(process.argv[4], digest + '\n');
  console.log('Verified archive config identity:', digest);
} else if (process.argv[2] === 'compare') {
  const actual = configDigest(JSON.parse(await readFile(process.argv[3], 'utf8')));
  const expected = (await readFile(process.argv[4], 'utf8')).trim();
  if (actual !== expected) throw new Error('Published image does not have the tested config digest');
  console.log('Published image matches CI-tested config:', actual);
}
