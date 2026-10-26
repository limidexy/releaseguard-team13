import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const posix = { skip: process.platform === 'win32' ? 'CD runs on Ubuntu; no Windows symlink/shell assumption' : false };
const revision = 'a'.repeat(40), repository = 'synthetic-owner/synthetic-repo';
const rawConfig = JSON.stringify({ architecture: 'amd64', os: 'linux', rootfs: { type: 'layers', diff_ids: [] }, config: { Labels: { purpose: 'offline-CD-test-only' } } });
const configHex = createHash('sha256').update(rawConfig).digest('hex'), configDigest = 'sha256:' + configHex;
const image = 'registry.invalid/synthetic/image@sha256:' + '1'.repeat(64), legacyId = 'sha256:' + 'd'.repeat(64);
// Execute the ACTUAL run blocks. GitHub and Docker are replaced only at the
// process boundary; helpers, tar parsing, receipts, shell exit behavior are real.
function block(name) {
  const lines = readFileSync('.github/workflows/cd.yml', 'utf8').replaceAll('\r\n', '\n').split('\n');
  const at = lines.findIndex(line => line.trim() === '- name: ' + name); assert.ok(at >= 0, 'Missing consuming CD step');
  let start = at + 1;
  while (start < lines.length && !/^\s+run: \|$/.test(lines[start])) { assert.ok(!/^\s+- (name|uses):/.test(lines[start]), 'Step has no run block'); start++; }
  const indent = lines[start].match(/^\s*/)[0].length; let end = start + 1;
  while (end < lines.length && (!lines[end].trim() || lines[end].match(/^\s*/)[0].length > indent)) end++;
  return lines.slice(start + 1, end).map(line => line.slice(indent + 2)).join('\n');
}
function fixture(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'rg-cd-identity-'));
  t.after(() => { assert.match(dir.split(/[\\/]/).at(-1), /^rg-cd-identity-/); rmSync(dir, { recursive: true, force: true }); });
  const bin = join(dir, 'bin'), scripts = join(dir, 'scripts'), receipts = join(dir, 'ci-evidence'), archiveFiles = join(dir, 'archive-files');
  for (const folder of [bin, scripts, receipts, join(archiveFiles, 'blobs/sha256')]) mkdirSync(folder, { recursive: true });
  for (const tool of ['node', 'tar', 'diff']) symlinkSync(tool === 'node' ? process.execPath : '/usr/bin/' + tool, join(bin, tool));
  for (const name of ['image-identity.mjs', 'cd-identity.mjs']) if (existsSync('scripts/' + name)) writeFileSync(join(scripts, name), readFileSync('scripts/' + name));
  const log = join(dir, 'transport.jsonl'), output = join(dir, 'github-output'), archive = join(dir, 'fixture.tar');
  const response = { id: 1001, status: 'completed', conclusion: 'success', head_sha: revision, path: '.github/workflows/ci.yml', repository: { full_name: repository }, head_repository: { full_name: repository }, ...options.run };
  writeFileSync(join(dir, 'run-response.json'), options.runBody ?? JSON.stringify(response));
  writeFileSync(output, 'retained=previous-output\n');
  if (options.source !== null) writeFileSync(join(receipts, 'source-commit.txt'), (options.source ?? revision) + '\n');
  if (options.config !== null) writeFileSync(join(receipts, 'image-config-id.txt'), (options.config ?? configDigest) + '\n');
  writeFileSync(join(receipts, 'image-id.txt'), legacyId + '\n');
  writeFileSync(join(archiveFiles, 'manifest.json'), JSON.stringify([{ Config: 'blobs/sha256/' + configHex, RepoTags: ['synthetic:only'], Layers: [] }]));
  writeFileSync(join(archiveFiles, 'blobs/sha256/' + configHex), options.tamper ? rawConfig + ' ' : rawConfig);
  execFileSync('/usr/bin/tar', ['-cf', archive, '-C', archiveFiles, 'manifest.json', 'blobs/sha256/' + configHex]);
  const executable = (name, source) => writeFileSync(join(bin, name), '#!/usr/bin/env node\n' + source, { mode: 0o755 });
  executable('gh', `const f=require('node:fs');const a=process.argv.slice(2);f.appendFileSync(process.env.TRANSPORT_LOG,JSON.stringify({kind:'gh',args:a})+'\\n');if(process.env.FAIL_GH==='1')process.exit(33);if(JSON.stringify(a)!==JSON.stringify(['api','repos/'+process.env.REPOSITORY+'/actions/runs/'+process.env.RUN_ID]))throw Error('Unexpected offline GitHub command');process.stdout.write(f.readFileSync('run-response.json'));`);
  executable('docker', `const f=require('node:fs');const a=process.argv.slice(2);f.appendFileSync(process.env.TRANSPORT_LOG,JSON.stringify({kind:'docker',args:a})+'\\n');if(a[0]==='pull'&&a[1]===process.env.RG_IMAGE&&a.length===2){if(process.env.FAIL_PULL==='1')process.exit(42);}else if(JSON.stringify(a)===JSON.stringify(['image','inspect',process.env.RG_IMAGE,'--format','{{.Id}}']))console.log(process.env.SYNTHETIC_INSPECT_ID);else if(JSON.stringify(a)===JSON.stringify(['image','save',process.env.RG_IMAGE,'-o','pulled-image.tar']))f.copyFileSync(process.env.SYNTHETIC_ARCHIVE,'pulled-image.tar',f.constants.COPYFILE_EXCL);else throw Error('Unexpected offline Docker command');`);
  // PATH contains ONLY the owned stubs and explicit node/tar/diff links. No real
  // gh/docker/kubectl/gcloud and no inherited credentials or environment URLs.
  const env = { PATH: bin, RUN_ID: '1001', REPOSITORY: repository, EXPECTED_SHA: revision, RG_IMAGE: image,
    GITHUB_OUTPUT: output, TRANSPORT_LOG: log, SYNTHETIC_ARCHIVE: archive, SYNTHETIC_INSPECT_ID: options.inspect ?? legacyId, ...options.env };
  const execute = name => { const r = spawnSync('/bin/bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', block(name)], { cwd: dir, env, encoding: 'utf8', timeout: 10000 }); assert.equal(r.error, undefined); return r; };
  return { dir, env, receipts, execute, calls: () => existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [], output: () => readFileSync(output, 'utf8') };
}
const check = 'Validate successful CI workflow and source', compare = 'Compare pushed image identity to tested image';
test('actual CI gate emits only the verified revision after one GitHub read', posix, t => {
  const f = fixture(t), r = f.execute(check); assert.equal(r.status, 0, r.stderr);
  assert.equal(f.output(), 'retained=previous-output\nsource=' + revision + '\n'); assert.deepEqual(f.calls().map(c => c.kind), ['gh']);
});
for (const [name, run] of [
  ['failed CI', { conclusion: 'failure' }], ['wrong source', { head_sha: 'b'.repeat(40) }],
  ['wrong workflow', { path: '.github/workflows/other.yml' }], ['foreign head repository', { head_repository: { full_name: 'foreign/repo' } }],
  ['foreign run repository', { repository: { full_name: 'foreign/repo' } }], ['incomplete CI', { status: 'in_progress' }], ['different run ID', { id: 1002 }],
]) test('actual CI gate rejects ' + name + ' without writing source output', posix, t => {
  const f = fixture(t, { run }), r = f.execute(check); assert.notEqual(r.status, 0);
  assert.equal(f.output(), 'retained=previous-output\n'); assert.equal(f.calls().filter(c => c.kind === 'gh').length, 1);
});
test('invalid run ID is rejected before any GitHub command', posix, t => {
  const f = fixture(t, { env: { RUN_ID: '../1001' } }), r = f.execute(check); assert.notEqual(r.status, 0); assert.deepEqual(f.calls(), []);
});
test('failed GitHub read is not retried and cannot emit source output', posix, t => {
  const f = fixture(t, { env: { FAIL_GH: '1' } }), r = f.execute(check); assert.notEqual(r.status, 0);
  assert.equal(f.calls().length, 1); assert.equal(f.output(), 'retained=previous-output\n');
});
test('private malformed CI metadata fails without dumping the body', posix, t => {
  const f = fixture(t, { runBody: 'PRIVATERAW-invalid-json' }), r = f.execute(check); assert.notEqual(r.status, 0);
  assert.doesNotMatch(r.stderr, /PRIVATERAW/); assert.equal(f.output(), 'retained=previous-output\n');
});
test('actual image gate accepts matching source/config receipts without editing them', posix, t => {
  const f = fixture(t), before = readFileSync(join(f.receipts, 'source-commit.txt'));
  const r = f.execute(compare); assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readFileSync(join(f.receipts, 'source-commit.txt')), before);
  assert.equal(readFileSync(join(f.receipts, 'image-config-id.txt'), 'utf8'), configDigest + '\n');
});
for (const [name, options] of [
  ['wrong source', { source: 'b'.repeat(40) }], ['missing source', { source: null }], ['malformed source', { source: 'not-a-commit' }],
  ['missing config receipt', { config: null }], ['malformed config receipt', { config: 'not-a-digest' }],
]) test('actual image gate rejects ' + name + ' before Docker, without an old-ID fallback', posix, t => {
  const f = fixture(t, options), r = f.execute(compare); assert.notEqual(r.status, 0); assert.deepEqual(f.calls(), []);
});
test('actual image gate rejects mismatching config even when the old image ID matches', posix, t => {
  const f = fixture(t, { config: 'sha256:' + '0'.repeat(64) }), r = f.execute(compare); assert.notEqual(r.status, 0);
});
test('matching config is accepted even when the store exposes a different .Id', posix, t => {
  const f = fixture(t, { inspect: 'sha256:' + 'e'.repeat(64) }), r = f.execute(compare); assert.equal(r.status, 0, r.stderr);
});
test('tampered pulled config is rejected without manufacturing an identity', posix, t => {
  const f = fixture(t, { tamper: true }), r = f.execute(compare); assert.notEqual(r.status, 0); assert.equal(existsSync(join(f.dir, 'pulled-config-id.txt')), false);
});
test('an unpinned image is rejected before Docker', posix, t => {
  const f = fixture(t, { env: { RG_IMAGE: 'registry.invalid/synthetic:latest' } }), r = f.execute(compare); assert.notEqual(r.status, 0); assert.deepEqual(f.calls(), []);
});
test('a failed pull is not retried and cannot produce config identity evidence', posix, t => {
  const f = fixture(t, { env: { FAIL_PULL: '1' } }), r = f.execute(compare); assert.notEqual(r.status, 0);
  assert.equal(f.calls().length, 1); assert.equal(existsSync(join(f.dir, 'pulled-config-id.txt')), false);
});
