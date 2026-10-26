import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { configuredClockSkewBound } from '../src/submission-deadline.ts';
const repo = fileURLToPath(new URL('../', import.meta.url));
const image = 'registry.example.test/team/releaseguard@sha256:' + 'a'.repeat(64);
const valid = { RG_IMAGE: image, PUBLIC_ORIGIN: 'https://demo.example.test', AUTH_ISSUER: 'https://identity.example.test/auth/realms/releaseguard', OIDC_JWKS_URL: 'https://identity.example.test/keys', SUBMISSION_CLOCK_SKEW_BOUND_MS: '250' };
const roles = ['registry', 'evaluation', 'governance', 'support', 'worker', 'gateway'];
const posix = { skip: process.platform === 'win32' ? 'Manual CD runs on Ubuntu; no Windows shell/symlink assumption' : false };
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'rg-render-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts')); copyFileSync(join(repo, 'scripts/render-cloud.mjs'), join(root, 'scripts/render-cloud.mjs'));
  const preload = join(root, 'boundary.mjs'); copyFileSync(join(repo, 'tests/fixtures/render-cloud-boundary.mjs'), preload);
  writeFileSync(join(root, '.env'), 'PRIVATE_CREDENTIAL_MUST_NOT_BE_READ');
  return { root, script: join(root, 'scripts/render-cloud.mjs'), out: join(root, 'deploy/k8s/rendered/services.yaml'),
    env: { RG_RENDER_FIXTURE_ROOT: root, NODE_OPTIONS: '--import=' + JSON.stringify(pathToFileURL(preload).href),
      MODEL_API_KEY: 'PRIVATE_PROVIDER_VALUE_NOT_A_REAL_KEY', KUBE_CONFIG: 'PRIVATE_KUBE_VALUE_NOT_A_REAL_CONFIG' } };
}
function run(f, changes = {}, cwd = f.root) {
  const r = spawnSync(process.execPath, [f.script], { cwd, env: { ...f.env, ...valid, ...changes }, encoding: 'utf8', timeout: 10000 });
  assert.equal(r.error, undefined); assert.equal(existsSync(join(f.root, 'forbidden-boundary')), false);
  assert.doesNotMatch(r.stdout + r.stderr, /BOUNDARY_ATTEMPT:|PRIVATE_CREDENTIAL|PRIVATE_INPUT/);
  return r;
}
function docs(f) {
  const raw = readFileSync(f.out, 'utf8'); assert.doesNotMatch(raw, /PRIVATE_CREDENTIAL|PRIVATE_PROVIDER|PRIVATE_KUBE/);
  return raw.trim().split(/\r?\n---\r?\n/).map(JSON.parse);
}
function config(d) { return d.find(x => x.kind === 'ConfigMap').data; }
function workloads(d) { return d.filter(x => x.kind === 'Deployment'); }
for (const [name, frozen, options] of [
  ['previous main defaults', 'render-cloud-legacy.mjs', {}],
  ['original PR1 options', 'render-cloud-source-pr1.mjs', { RG_INTERNAL_CA: 'true', RG_TRIAL_SMALL: 'true', RG_SKIP_NAMESPACE: 'true', RG_DEPLOYMENT_ENV: 'gcp-trial' }],
]) test('complete manifest structure preserves ' + name + ' except the new required skew field', t => {
  const before = fixture(t), after = fixture(t);
  copyFileSync(join(repo, 'tests/fixtures', frozen), before.script);
  assert.equal(run(before, options).status, 0); assert.equal(run(after, options).status, 0);
  const expected = docs(before), actual = docs(after);
  assert.equal(config(actual).SUBMISSION_CLOCK_SKEW_BOUND_MS, '250');
  // Compare an in-memory projection only; neither original file is edited.
  delete config(actual).SUBMISSION_CLOCK_SKEW_BOUND_MS;
  assert.deepEqual(actual, expected);
});
test('default render has six bounded services and the exact explicit consumer-compatible skew configuration', t => {
  const f = fixture(t), r = run(f); assert.equal(r.status, 0, r.stderr);
  const d = docs(f); assert.equal(d.length, 14); assert.equal(config(d).SUBMISSION_CLOCK_SKEW_BOUND_MS, '250');
  assert.equal(configuredClockSkewBound(config(d).SUBMISSION_CLOCK_SKEW_BOUND_MS), 250);
  assert.equal(d.find(x => x.kind === 'ConfigMap').metadata.name, 'rg-config');
  assert.equal(config(d).AUTH_ISSUER, valid.AUTH_ISSUER); assert.equal(config(d).OIDC_JWKS_URL, valid.OIDC_JWKS_URL);
  assert.notEqual(config(d).RG_DEPLOYMENT_ENV, 'gcp-trial');
  for (const w of workloads(d)) {
    const c = w.spec.template.spec.containers[0]; assert.equal(c.image, image);
    assert.equal(w.metadata.namespace, 'releaseguard');
    assert.deepEqual(c.envFrom, [{ configMapRef: { name: 'rg-config' } }]);
    assert.equal(c.env.some(e => e.name === 'SUBMISSION_CLOCK_SKEW_BOUND_MS'), false, 'no stale per-role override may shadow the validated shared bound');
    assert.equal(w.spec.replicas, w.metadata.name === 'gateway' ? 2 : 1);
    assert.equal(c.resources.requests.cpu, '250m'); assert.equal(c.resources.limits.cpu, '500m'); assert.equal(c.resources.limits.memory, '384Mi');
    assert.equal(w.spec.template.spec.automountServiceAccountToken, false);
    assert.equal(c.securityContext.readOnlyRootFilesystem, true); assert.equal(c.securityContext.allowPrivilegeEscalation, false);
    assert.deepEqual(c.securityContext.capabilities.drop, ['ALL']); assert.ok(c.startupProbe && c.readinessProbe && c.livenessProbe);
    assert.equal(c.env.find(e => e.name === 'INTERNAL_SECRET').value, undefined);
    assert.equal(c.env.find(e => e.name === 'INTERNAL_SECRET').valueFrom.secretKeyRef.name, 'rg-internal');
    assert.equal(c.env.some(e => e.name === 'NODE_EXTRA_CA_CERTS'), false);
  }
  assert.deepEqual(workloads(d).map(w => w.metadata.name), roles);
  assert.ok(d.filter(x => x.kind === 'Service').every(x => x.spec.type === 'ClusterIP'));
  const support = workloads(d).find(w => w.metadata.name === 'support').spec.template.spec.containers[0];
  assert.equal(support.env.find(e => e.name === 'ALLOW_REAL_MODEL').value, undefined);
  assert.equal(support.env.find(e => e.name === 'ALLOW_REAL_MODEL').valueFrom.secretKeyRef.optional, true);
});
test('unrelated credential environment is never copied into generated configuration', t => {
  const f = fixture(t), r = run(f); assert.equal(r.status, 0, r.stderr);
  const data = config(docs(f)); assert.equal(data.MODEL_API_KEY, undefined); assert.equal(data.KUBE_CONFIG, undefined);
  assert.doesNotMatch(r.stdout + r.stderr, /PRIVATE_PROVIDER|PRIVATE_KUBE/);
});
test('explicit source options add trusted CA, small requests, omit Namespace and declare configuration only', t => {
  const f = fixture(t), r = run(f, { RG_INTERNAL_CA: 'true', RG_TRIAL_SMALL: 'true', RG_SKIP_NAMESPACE: 'true', RG_DEPLOYMENT_ENV: 'gcp-trial' });
  assert.equal(r.status, 0, r.stderr); const d = docs(f); assert.equal(d.length, 13); assert.equal(d.some(x => x.kind === 'Namespace'), false);
  assert.equal(config(d).RG_DEPLOYMENT_ENV, 'gcp-trial');
  for (const w of workloads(d)) {
    const pod = w.spec.template.spec, c = pod.containers[0];
    assert.equal(c.resources.requests.cpu, w.metadata.name === 'worker' ? '150m' : '100m');
    assert.equal(c.resources.limits.cpu, '500m'); assert.equal(c.resources.limits.memory, '384Mi');
    assert.deepEqual(c.env.find(e => e.name === 'NODE_EXTRA_CA_CERTS'), { name: 'NODE_EXTRA_CA_CERTS', value: '/trust/ca.crt' });
    assert.deepEqual(pod.volumes, [{ name: 'trust', secret: { secretName: 'rg-internal-ca' } }]);
    assert.deepEqual(c.volumeMounts, [{ name: 'trust', mountPath: '/trust', readOnly: true }]);
  }
});
test('false source flags keep the existing resource/probe defaults', t => {
  const f = fixture(t), r = run(f, { RG_INTERNAL_CA: 'false', RG_TRIAL_SMALL: 'false', RG_SKIP_NAMESPACE: 'false' });
  assert.equal(r.status, 0, r.stderr); const d = docs(f); assert.equal(d.filter(x => x.kind === 'Namespace').length, 1);
  assert.ok(workloads(d).every(w => w.spec.template.spec.containers[0].resources.requests.cpu === '250m' && !w.spec.template.spec.volumes));
});
for (const value of ['0', '9999']) test('explicit boundary skew ' + value + ' is preserved, never invented as a default', t => {
  const f = fixture(t), r = run(f, { SUBMISSION_CLOCK_SKEW_BOUND_MS: value }); assert.equal(r.status, 0, r.stderr);
  assert.equal(config(docs(f)).SUBMISSION_CLOCK_SKEW_BOUND_MS, value);
  assert.equal(configuredClockSkewBound(config(docs(f)).SUBMISSION_CLOCK_SKEW_BOUND_MS), Number(value));
});
for (const field of Object.keys(valid)) test('missing ' + field + ' is rejected before output', t => {
  const f = fixture(t), r = run(f, { [field]: '' }); assert.notEqual(r.status, 0); assert.equal(existsSync(f.out), false);
});
for (const value of ['-1', '1.5', '10000', 'NaN', '1e2', ' 2']) test('invalid skew ' + JSON.stringify(value) + ' is rejected before output', t => {
  const f = fixture(t), r = run(f, { SUBMISSION_CLOCK_SKEW_BOUND_MS: value }); assert.notEqual(r.status, 0); assert.equal(existsSync(f.out), false);
});
for (const field of ['PUBLIC_ORIGIN', 'AUTH_ISSUER', 'OIDC_JWKS_URL']) {
  for (const [name, value] of [['credentials', 'https://user:PRIVATE_INPUT@example.test/'], ['control character', 'https://exam\nple.test/'], ['plaintext', 'http://example.test/'], ['query secret', 'https://example.test/?key=PRIVATE_INPUT']]) {
    test('rejects ' + field + ' ' + name + ' without echoing values or writing output', t => {
      const f = fixture(t), r = run(f, { [field]: value }); assert.notEqual(r.status, 0); assert.equal(existsSync(f.out), false);
    });
  }
}
test('PUBLIC_ORIGIN cannot contain an application path or fragment', t => {
  for (const value of ['https://example.test/path', 'https://example.test/#fragment']) {
    const f = fixture(t), r = run(f, { PUBLIC_ORIGIN: value }); assert.notEqual(r.status, 0); assert.equal(existsSync(f.out), false);
  }
});
for (const value of ['registry.example.test/team:latest', 'https://registry.example.test/team@sha256:' + 'a'.repeat(64)]) test('rejects non-image reference ' + value.split('@')[0], t => {
  const f = fixture(t), r = run(f, { RG_IMAGE: value }); assert.notEqual(r.status, 0); assert.equal(existsSync(f.out), false);
});
for (const [field, value] of [['RG_INTERNAL_CA', 'TRUE'], ['RG_TRIAL_SMALL', 'yes'], ['RG_SKIP_NAMESPACE', '1'], ['RG_DEPLOYMENT_ENV', 'production']]) test('malformed source option ' + field + ' cannot silently select a different plan', t => {
  const f = fixture(t), r = run(f, { [field]: value }); assert.notEqual(r.status, 0); assert.equal(existsSync(f.out), false);
});
test('an existing manifest is never overwritten, even with valid new inputs', t => {
  const f = fixture(t); mkdirSync(join(f.root, 'deploy/k8s/rendered'), { recursive: true }); writeFileSync(f.out, 'retained-original-manifest\n');
  const r = run(f); assert.notEqual(r.status, 0); assert.equal(readFileSync(f.out, 'utf8'), 'retained-original-manifest\n');
});
test('output stays anchored to the script checkout instead of an unrelated working directory', t => {
  const f = fixture(t), other = join(f.root, 'other'); mkdirSync(other);
  const r = run(f, {}, other); assert.equal(r.status, 0, r.stderr); assert.equal(existsSync(f.out), true); assert.equal(existsSync(join(other, 'deploy')), false);
});
test('symlinked output parent cannot write into another directory', posix, t => {
  const f = fixture(t), target = join(f.root, 'unrelated'); mkdirSync(target); symlinkSync(target, join(f.root, 'deploy'));
  const r = run(f); assert.notEqual(r.status, 0); assert.equal(existsSync(join(target, 'k8s')), false);
});
test('symlinked output file cannot replace retained bytes', posix, t => {
  const f = fixture(t), target = join(f.root, 'retained.yaml'); writeFileSync(target, 'retained\n');
  mkdirSync(join(f.root, 'deploy/k8s/rendered'), { recursive: true }); symlinkSync(target, f.out);
  const r = run(f); assert.notEqual(r.status, 0); assert.equal(readFileSync(target, 'utf8'), 'retained\n');
});
test('concurrent renderers have exactly one exclusive writer and no implicit retry', async t => {
  const f = fixture(t);
  const results = await Promise.all([1, 2].map(() => new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [f.script], { cwd: f.root, env: { ...f.env, ...valid }, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => proc.kill('SIGKILL'), 10000); let output = '';
    proc.stdout.on('data', b => { output += b; }); proc.stderr.on('data', b => { output += b; });
    proc.once('error', reject); proc.once('close', status => { clearTimeout(timer); resolve({ status, output }); });
  })));
  assert.deepEqual(results.map(x => x.status).sort(), [0, 1]); assert.equal(docs(f).length, 14);
  assert.equal(existsSync(join(f.root, 'forbidden-boundary')), false); assert.ok(results.every(r => !r.output.includes('BOUNDARY_ATTEMPT:')));
});

// Execute the existing manual-CD consuming run block with ONLY owned node/kubectl stubs.
function cdBlock(vars, inputs) {
  const lines = readFileSync(join(repo, '.github/workflows/cd.yml'), 'utf8').replaceAll('\r\n', '\n').split('\n');
  const at = lines.findIndex(l => l.trim() === '- name: Render, deploy and verify rollouts'); assert.ok(at >= 0);
  const start = lines.findIndex((l, i) => i > at && l === '        run: |'); assert.ok(start > at);
  const env = {};
  for (const line of lines.slice(at + 1, start)) {
    const m = line.match(/^          ([A-Z_]+): \$\{\{ (vars|inputs)\.([A-Za-z_]+) \}\}$/);
    if (m) env[m[1]] = (m[2] === 'vars' ? vars : inputs)[m[3]] ?? '';
    else assert.ok(!/^          [A-Z_]+:/.test(line), 'unexpected credential/literal binding in render step');
  }
  let end = start + 1; while (end < lines.length && (!lines[end].trim() || lines[end].startsWith('          '))) end++;
  return { env, script: lines.slice(start + 1, end).map(l => l.slice(10)).join('\n') };
}
function runCD(t, changes = {}, retained = false) {
  const f = fixture(t), bin = join(f.root, 'bin'); mkdirSync(bin); symlinkSync(process.execPath, join(bin, 'node'));
  writeFileSync(join(bin, 'kubectl'), `#!${process.execPath}\nconst fs=require('node:fs');const args=process.argv.slice(2);const roles=['registry','evaluation','governance','support','worker','gateway'];
if(JSON.stringify(args)!==JSON.stringify(['apply','-f','deploy/k8s/rendered/services.yaml'])&&!(args.length===6&&args[0]==='-n'&&args[1]==='releaseguard'&&args[2]==='rollout'&&args[3]==='status'&&roles.some(r=>args[4]==='deployment/'+r)&&args[5]==='--timeout=180s'))throw Error('Unexpected owned kubectl request');
fs.appendFileSync('kubectl-calls.jsonl',JSON.stringify(args)+'\\n');\n`, { mode: 0o755 });
  const vars = { PUBLIC_ORIGIN: valid.PUBLIC_ORIGIN, AUTH_ISSUER: valid.AUTH_ISSUER, OIDC_JWKS_URL: valid.OIDC_JWKS_URL, SUBMISSION_CLOCK_SKEW_BOUND_MS: '250', RG_INTERNAL_CA: 'true', RG_TRIAL_SMALL: 'true', RG_SKIP_NAMESPACE: 'true', RG_DEPLOYMENT_ENV: 'gcp-trial', ...changes };
  const step = cdBlock(vars, { image });
  if (retained) { mkdirSync(join(f.root, 'deploy/k8s/rendered'), { recursive: true }); writeFileSync(f.out, 'retained-original\n'); }
  const result = spawnSync('/bin/bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', step.script], { cwd: f.root, env: { ...f.env, ...step.env, PATH: bin }, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.error, undefined); assert.equal(existsSync(join(f.root, 'forbidden-boundary')), false);
  const calls = existsSync(join(f.root, 'kubectl-calls.jsonl')) ? readFileSync(join(f.root, 'kubectl-calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse) : [];
  return { f, result, calls };
}
test('actual manual CD passes explicit flags/bound into the renderer before owned rollout requests', posix, t => {
  const { f, result, calls } = runCD(t); assert.equal(result.status, 0, result.stderr); assert.equal(calls.length, 7);
  const d = docs(f); assert.equal(config(d).SUBMISSION_CLOCK_SKEW_BOUND_MS, '250'); assert.equal(config(d).RG_DEPLOYMENT_ENV, 'gcp-trial');
  assert.equal(d.some(x => x.kind === 'Namespace'), false); assert.ok(workloads(d).every(w => w.spec.template.spec.volumes?.[0].secret.secretName === 'rg-internal-ca'));
});
test('actual manual CD missing bound stops before even the owned kubectl stub', posix, t => {
  const { f, result, calls } = runCD(t, { SUBMISSION_CLOCK_SKEW_BOUND_MS: '' }); assert.notEqual(result.status, 0); assert.deepEqual(calls, []); assert.equal(existsSync(f.out), false);
});
test('actual manual CD retains an old manifest and stops before any rollout', posix, t => {
  const { f, result, calls } = runCD(t, {}, true); assert.notEqual(result.status, 0); assert.deepEqual(calls, []); assert.equal(readFileSync(f.out, 'utf8'), 'retained-original\n');
});
