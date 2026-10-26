// Controlled Docker process boundary only. All guards, archive parsing, plans,
// restoration logic and report files are the production implementation.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, constants, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';

export const currentId = 'sha256:' + '1'.repeat(64), previousId = 'sha256:' + '2'.repeat(64), foreignId = 'sha256:' + '3'.repeat(64);
export const currentTag = 'releaseguard-course-v2:local', previousSource = 'b'.repeat(40);
export const baseHash = 'b'.repeat(64), oldHash = 'c'.repeat(64), restoredHash = 'd'.repeat(64);
const serviceNames = ['postgres', 'rabbitmq', 'registry', 'evaluation', 'governance', 'support', 'worker', 'gateway'];
export function rollbackFixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'rg-rollback-fixture-'));
  t.after(() => { assert.match(basename(dir), /^rg-rollback-fixture-/); rmSync(dir, { recursive: true, force: true }); });
  const reportDir = join(dir, 'report'), artifactDir = join(dir, 'artifacts'); mkdirSync(reportDir); mkdirSync(artifactDir);
  const env = { RG_ROLLBACK_INTEGRATION: '1', COMPOSE_PROJECT_NAME: 'rg-ci-rollback-synthetic', RELEASEGUARD_URL: 'http://127.0.0.1:5189',
    RG_ROLLBACK_IMAGE: 'retained:local', RG_ROLLBACK_ARTIFACT_DIR: artifactDir, GITHUB_ACTIONS: 'true',
    GITHUB_REPOSITORY: 'synthetic-owner/synthetic-repo', REPOSITORY: 'synthetic-owner/synthetic-repo', RUN_ID: '1001', EXPECTED_SHA: previousSource,
    RG_ROLLBACK_IMAGE_ARTIFACT_ID: '2001', RG_ROLLBACK_EVIDENCE_ARTIFACT_ID: '2002',
    RG_ROLLBACK_IMAGE_ARTIFACT_DIGEST: 'sha256:' + '5'.repeat(64), RG_ROLLBACK_EVIDENCE_ARTIFACT_DIGEST: 'sha256:' + '6'.repeat(64) };
  const images = new Map();
  for (const [id, purpose] of [[currentId, 'current'], [previousId, 'actual-previous-test-config'], [foreignId, 'unrelated']]) {
    const folder = join(dir, purpose); mkdirSync(folder);
    const raw = JSON.stringify({ architecture: 'amd64', os: 'linux', config: { Env: ['NODE_ENV=production'], Labels: { purpose } }, rootfs: { type: 'layers', diff_ids: [] } });
    const hex = createHash('sha256').update(raw).digest('hex'); writeFileSync(join(folder, hex + '.json'), raw);
    writeFileSync(join(folder, 'manifest.json'), JSON.stringify([{ Config: hex + '.json', RepoTags: [currentTag], Layers: [] }]));
    const archive = join(dir, purpose + '.tar'); execFileSync('/usr/bin/tar', ['-cf', archive, '-C', folder, 'manifest.json', hex + '.json']);
    images.set(id, { archive, digest: 'sha256:' + hex, labels: { purpose } });
  }
  const states = new Map(serviceNames.map((service, i) => [service, {
    Id: String(i + 1).padStart(64, '0'), Image: currentId,
    Labels: { 'com.docker.compose.project': env.COMPOSE_PROJECT_NAME, 'com.docker.compose.service': service, 'com.docker.compose.config-hash': baseHash },
    State: { Running: true, Paused: false, Health: { Status: 'healthy', FailingStreak: 0 } },
    Ports: service === 'gateway' ? { '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '5189' }] } : {},
  }]));
  const originalStates = structuredClone([...states]), tags = new Map([[currentTag, currentId], ['retained:local', previousId]]), calls = [], mutations = [], faults = {};
  const run = { id: 1001, head_sha: previousSource, status: 'completed', conclusion: 'success', path: '.github/workflows/ci.yml', repository: { full_name: env.REPOSITORY }, head_repository: { full_name: env.REPOSITORY } };
  const artifacts = { total_count: 2, artifacts: [['tested-image', 2001, env.RG_ROLLBACK_IMAGE_ARTIFACT_DIGEST], ['verification-evidence', 2002, env.RG_ROLLBACK_EVIDENCE_ARTIFACT_DIGEST]].map(([name, id, digest]) => ({ name, id, digest, expired: false, workflow_run: { id: 1001, head_sha: previousSource } })) };
  writeFileSync(join(artifactDir, 'run.json'), JSON.stringify(run)); writeFileSync(join(artifactDir, 'artifacts.json'), JSON.stringify(artifacts));
  mkdirSync(join(artifactDir, 'tested-image')); mkdirSync(join(artifactDir, 'verification-evidence'));
  copyFileSync(images.get(previousId).archive, join(artifactDir, 'tested-image/image.tar'));
  writeFileSync(join(artifactDir, 'verification-evidence/source-commit.txt'), previousSource + '\n');
  const execute = (binary, all, options) => {
    assert.equal(binary, 'docker'); assert.deepEqual(all.slice(0, 2), ['--context', 'default']);
    assert.equal(options.env.COMPOSE_PROJECT_NAME, env.COMPOSE_PROJECT_NAME); calls.push([...all]);
    const [command, ...args] = all.slice(2);
    if (command === 'context') { assert.deepEqual(args, ['inspect', 'default', '--format', '{{json .Endpoints.docker.Host}}']); return JSON.stringify('unix:///var/run/docker.sock'); }
    if (command === 'version') { assert.deepEqual(args, ['--format', '{{.Server.Version}}']); return 'synthetic-engine'; }
    if (command === 'inspect') {
      assert.equal(args[0], '--format'); const state = [...states.values()].find(s => s.Id === args[2]);
      if (!state) throw Error('Original container missing'); return JSON.stringify(state);
    }
    if (command === 'exec') {
      assert.equal(args[0], states.get('support').Id); assert.deepEqual(args.slice(1), ['node', '-e', "if(process.env.ALLOW_REAL_MODEL!=='false')process.exit(1)"]); return '';
    }
    if (command === 'image') {
      if (args[0] === 'inspect') {
        const id = tags.get(args[1]) ?? args[1], image = images.get(id); if (!image) throw Error('Missing local image');
        assert.equal(args[2], '--format'); return args[3] === '{{.Id}}' ? id : JSON.stringify({ Id: id, Labels: image.labels });
      }
      if (args[0] === 'save') {
        assert.equal(args[2], '-o'); const image = images.get(args[1]); assert.ok(image);
        assert.match(args[3], /rg-rollback-(inspect|load)-/); copyFileSync(image.archive, args[3], constants.COPYFILE_EXCL); return '';
      }
      if (args[0] === 'load') {
        assert.deepEqual(args.slice(0, 2), ['load', '--input']); assert.equal(args[2], join(artifactDir, 'tested-image/image.tar'));
        mutations.push({ kind: 'load' }); if (faults.beforeLoad) throw Error('Injected load failure');
        tags.set(currentTag, faults.foreignAfterLoad ? foreignId : previousId);
        if (faults.afterLoad) throw Error('Injected partial load failure'); return '';
      }
      if (args[0] === 'tag') {
        assert.deepEqual(args, ['tag', currentId, currentTag]); mutations.push({ kind: 'tag', id: args[1] });
        if (faults.beforeTag) throw Error('Injected tag failure'); tags.set(currentTag, currentId);
        if (faults.afterTag) throw Error('Injected partial tag failure'); return '';
      }
      throw Error('Unsupported image command');
    }
    assert.equal(command, 'compose', 'No real command fallback');
    assert.deepEqual(args.slice(0, 2), ['--project-name', env.COMPOSE_PROJECT_NAME]); assert.equal(args[2], '--project-directory');
    assert.equal(args[4], '--file'); assert.equal(args[5], args[3] + 'compose.yaml');
    let at = 6, image;
    if (args[at] === '--file') {
      const file = args[at + 1]; assert.ok(file.startsWith(reportDir + '/'));
      const plan = JSON.parse(readFileSync(file, 'utf8')); image = plan.services.governance.image;
      assert.deepEqual(plan, { services: { governance: { image } } }); assert.ok([currentId, previousId].includes(image)); at += 2;
    }
    const rest = args.slice(at);
    if (rest[0] === 'config') {
      assert.deepEqual(rest, ['config', '--hash', 'governance']);
      return 'governance ' + (image === previousId ? oldHash : image === currentId ? restoredHash : faults.baseChanged ? 'e'.repeat(64) : baseHash);
    }
    if (rest[0] === 'ps') {
      assert.deepEqual(rest.slice(0, 3), ['ps', '--all', '--quiet']); return states.get(rest[3])?.Id ?? '';
    }
    assert.deepEqual(rest, ['up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--wait', 'governance']);
    const previous = image === previousId; mutations.push({ kind: 'compose-up', image });
    if (faults[previous ? 'beforeSwitch' : 'beforeRestore']) throw Error('Injected Compose failure');
    if (!states.has('governance')) states.set('governance', structuredClone(originalStates.find(([s]) => s === 'governance')[1]));
    const state = states.get('governance'); state.Id = (previous ? 'a' : 'c').repeat(64); state.Image = image;
    state.Labels['com.docker.compose.config-hash'] = previous ? oldHash : restoredHash;
    state.State = { Running: true, Paused: false, Health: { Status: 'healthy', FailingStreak: 0 } };
    if (faults[previous ? 'afterSwitch' : 'afterRestore']) throw Error('Injected partial Compose failure'); return '';
  };
  return { dir, env, reportDir, artifactDir, images, states, tags, calls, mutations, faults, execute, run, artifacts, originalStates };
}
