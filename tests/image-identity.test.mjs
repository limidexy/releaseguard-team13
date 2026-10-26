import test from 'node:test';
import assert from 'node:assert/strict';
import { configDigest } from '../scripts/image-identity.mjs';
test('image identity is config digest, not index or manifest digest', () => {
  const config = 'sha256:' + 'a'.repeat(64);
  assert.equal(configDigest({config:{digest:config},digest:'sha256:'+'b'.repeat(64)}),config);
  assert.throws(()=>configDigest({manifests:[{digest:config}]}));
  assert.throws(()=>configDigest({config:{digest:'latest'}}));
});

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptURL = new URL('../scripts/image-identity.mjs', import.meta.url), script = fileURLToPath(scriptURL);
const raw = JSON.stringify({ architecture: 'amd64', os: 'linux', rootfs: { type: 'layers', diff_ids: [] }, config: { Labels: { fixture: 'synthetic' } } });
const hex = createHash('sha256').update(raw).digest('hex'), digest = 'sha256:' + hex;
const environment = { PATH: process.env.PATH, ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) };
function fixture(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'rg-image-identity-'));
  t.after(() => { assert.match(dir.split(/[\\/]/).at(-1), /^rg-image-identity-/); rmSync(dir, { recursive: true, force: true }); });
  const member = options.legacy ? hex + '.json' : 'blobs/sha256/' + (options.nameHex ?? hex);
  mkdirSync(dirname(join(dir, member)), { recursive: true });
  writeFileSync(join(dir, member), options.raw ?? raw);
  const entry = { Config: member, RepoTags: ['synthetic:local'], Layers: [] };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(options.manifest ?? [entry]));
  const archive = join(dir, 'synthetic image.tar');
  execFileSync('tar', ['-cf', archive, '-C', dir, 'manifest.json', member], { env: environment });
  return { dir, archive, member, output: join(dir, 'identity.txt') };
}
function run(args, options = {}) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 5000, env: environment, ...options });
  assert.equal(result.error, undefined); return result;
}
function rejected(result, output) {
  assert.notEqual(result.status, 0); assert.equal(result.stdout, ''); if (output) assert.equal(existsSync(output), false);
}
for (const legacy of [false, true]) test('actual archive CLI hashes the exact ' + (legacy ? 'legacy' : 'OCI-path') + ' configuration bytes', t => {
  const f = fixture(t, { legacy }), before = readFileSync(f.archive);
  const result = run(['archive', f.archive, f.output]); assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(f.output, 'utf8'), digest + '\n'); assert.deepEqual(readFileSync(f.archive), before);
});
test('compressed archive CLI uses the same configuration identity', t => {
  const f = fixture(t), compressed = join(f.dir, 'synthetic image.tar.gz');
  execFileSync('tar', ['-czf', compressed, '-C', f.dir, 'manifest.json', f.member], { env: environment });
  const result = run(['archive', compressed, f.output]); assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(f.output, 'utf8'), digest + '\n');
});
test('tampered configuration bytes produce no identity output', t => {
  const f = fixture(t, { raw: raw + ' ' }); rejected(run(['archive', f.archive, f.output]), f.output);
});
test('archive manifest must be an actual one-image array, not an array-like object', t => {
  const f = fixture(t, { manifest: { 0: { Config: 'blobs/sha256/' + hex }, length: 1 } });
  rejected(run(['archive', f.archive, f.output]), f.output);
});
test('multiple archive images remain unsupported, not silently selected', t => {
  const f = fixture(t, { manifest: [{ Config: 'blobs/sha256/' + hex }, { Config: 'blobs/sha256/' + hex }] });
  rejected(run(['archive', f.archive, f.output]), f.output);
});
for (const name of ['manifest.json', 'configuration']) test('duplicate ' + name + ' archive entries cannot create an ambiguous identity', t => {
  const f = fixture(t), member = name === 'manifest.json' ? name : f.member;
  // A zero-byte duplicate would leave tar's concatenated stdout unchanged.
  writeFileSync(join(f.dir, member), '');
  execFileSync('tar', ['-rf', f.archive, '-C', f.dir, member], { env: environment });
  rejected(run(['archive', f.archive, f.output]), f.output);
});
test('existing identity evidence is not overwritten', t => {
  const f = fixture(t); writeFileSync(f.output, 'retained previous evidence\n');
  const result = run(['archive', f.archive, f.output]); assert.notEqual(result.status, 0);
  assert.equal(readFileSync(f.output, 'utf8'), 'retained previous evidence\n');
});
test('the archive can never be replaced by its identity output', t => {
  const f = fixture(t), before = readFileSync(f.archive);
  assert.notEqual(run(['archive', f.archive, f.archive]).status, 0); assert.deepEqual(readFileSync(f.archive), before);
});
test('importing the module does not run an unrelated caller archive command', t => {
  const f = fixture(t);
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', 'await import(' + JSON.stringify(scriptURL.href) + '); console.log("imported");', 'unrelated-caller', 'archive', f.archive, f.output], { env: environment, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'imported\n'); assert.equal(existsSync(f.output), false);
});
test('a direct symlink invocation still verifies the archive instead of silently succeeding', { skip: process.platform === 'win32' ? 'Windows symlink privilege is not assumed' : false }, t => {
  const f = fixture(t), link = join(f.dir, 'image-helper.mjs'); symlinkSync(script, link);
  const result = spawnSync(process.execPath, [link, 'archive', f.archive, f.output], { env: environment, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(f.output), true, 'A direct symlink CLI must not silently no-op'); assert.equal(readFileSync(f.output, 'utf8'), digest + '\n');
});
for (const args of [[], ['unknown'], ['archive'], ['compare']]) test('incomplete or unknown CLI mode fails rather than reporting success: ' + JSON.stringify(args), () => {
  rejected(run(args));
});
test('extra CLI arguments fail without writing identity evidence', t => {
  const f = fixture(t); rejected(run(['archive', f.archive, f.output, 'unexpected']), f.output);
});
test('config digest rejects an index even when it carries a misleading config descriptor', () => {
  assert.throws(() => configDigest({ config: { digest }, manifests: [{ digest: 'sha256:' + 'b'.repeat(64) }] }));
});
test('compare CLI accepts only the matching single-image config, without changing inputs', t => {
  const f = fixture(t), manifest = join(f.dir, 'published.json'), expected = join(f.dir, 'expected.txt');
  const bytes = JSON.stringify({ schemaVersion: 2, config: { digest }, digest: 'sha256:' + 'b'.repeat(64) });
  writeFileSync(manifest, bytes); writeFileSync(expected, digest + '\n');
  assert.equal(run(['compare', manifest, expected]).status, 0); assert.equal(readFileSync(manifest, 'utf8'), bytes);
  writeFileSync(expected, 'sha256:' + 'b'.repeat(64) + '\n'); rejected(run(['compare', manifest, expected]));
});
test('a truncated or private non-JSON manifest is rejected without exposing its body', t => {
  const f = fixture(t), manifest = join(f.dir, 'private.json'), expected = join(f.dir, 'expected.txt');
  writeFileSync(manifest, 'PRIVATE-RAW-IMAGE-CONTENT-invalid-json'); writeFileSync(expected, digest + '\n');
  const result = run(['compare', manifest, expected]); rejected(result); assert.doesNotMatch(result.stderr, /PRIVATE-RAW-IMAGE-CONTENT/);
});
for (const invalid of ['', '[]', 'null', 'PRIVATE-RAW-CONFIG-invalid-json']) test('matching hash does not make a non-object configuration valid: ' + JSON.stringify(invalid), t => {
  const f = fixture(t, { raw: invalid, nameHex: createHash('sha256').update(invalid).digest('hex') });
  const result = run(['archive', f.archive, f.output]); rejected(result, f.output);
  assert.doesNotMatch(result.stderr, /PRIVATE-RAW-CONFIG/);
});
for (const member of ['../' + hex, '/blobs/sha256/' + hex, 'blobs/sha256/' + hex + '/extra']) test('unsafe or non-canonical config member is refused: ' + member, t => {
  const f = fixture(t, { manifest: [{ Config: member }] }); rejected(run(['archive', f.archive, f.output]), f.output);
});
