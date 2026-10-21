import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const base = '20d258d891935b2d5bee3375ebf81b2872adf76f';
function old(path) { try { return execFileSync('git', ['show', `${base}:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch { return ''; } }
const current = path => readFileSync(path, 'utf8');
function patch(path, before, after) {
  if (before === after) return '';
  const a = before ? before.replace(/\n$/, '').split('\n') : [], b = after.replace(/\n$/, '').split('\n');
  return `diff --git a/${path} b/${path}\n${before ? '' : 'new file mode 100644\n'}--- ${before ? 'a/' + path : '/dev/null'}\n+++ b/${path}\n@@ -${a.length ? '1,' + a.length : '0,0'} +1,${b.length} @@\n` + a.map(l => '-' + l + '\n').join('') + b.map(l => '+' + l + '\n').join('');
}
const bFiles = ['src/returns-policy-v28.ts', 'tests/policy-v28.test.ts', 'tests/v28-integration.test.ts', 'src/returns-policy-v27.ts', 'tests/policy-v27.test.ts', 'tests/v27-integration.test.ts', 'src/refinements-v26.ts', 'tests/refinements-v26.test.ts', 'tests/v26-integration.test.ts', 'src/privacy-v25.ts', 'src/answer-v25.ts', 'tests/policy-v25.test.ts', 'tests/privacy-v25-regression.test.ts', 'src/privacy-v23.ts', 'src/privacy-v24.ts', 'src/returns-policy.ts', 'src/gateway.ts', 'public/app.js', 'tests/privacy-v23.test.ts', 'tests/environment.test.ts'];
const cFiles = ['tests/frozen-v27-v10.json', 'tests/prompt-v11.test.ts', 'tests/support-v11.test.ts', 'scripts/model-v11-evaluation.mjs', 'scripts/verify-model-v11.mjs', 'scripts/verify-v28-v11-local.mjs', 'scripts/audit-v28-baseline.mjs', 'tests/frozen-v9-snapshot.json', 'tests/prompt-v10.test.ts', 'tests/support-v10.test.ts', 'scripts/model-v10-evaluation.mjs', 'scripts/verify-model-v10.mjs', 'scripts/verify-v27-v10-local.mjs', 'scripts/audit-v27-baseline.mjs', 'tests/prompt-v9.test.ts', 'tests/support-v9.test.ts', 'tests/frozen-v26-v8.json', 'scripts/model-v9-evaluation.mjs', 'scripts/verify-model-v9.mjs', 'scripts/verify-v26-v9-local.mjs', 'scripts/verify-v26-v8-local.mjs', 'tests/prompt-v8.test.ts', 'tests/support-v8.test.ts', 'tests/historical-v6-v7-snapshots.json', 'scripts/model-v8-evaluation.mjs', 'scripts/verify-model-v8.mjs', 'scripts/verify-v25-v8-local.mjs', 'tests/support-v7.test.ts', 'tests/v25-v7-integration.test.ts', 'scripts/model-v7-evaluation.mjs', 'scripts/verify-model-v7.mjs', 'scripts/verify-v25-v7-local.mjs', 'src/provider.ts', 'src/support.ts', 'public/index.html', 'tests/historical-prompt-hashes.json', 'tests/model-v3-cases.json', 'tests/prompt-v3.test.ts', 'tests/prompt-v4.test.ts', 'tests/prompt-v5.test.ts', 'tests/support-v3.test.ts', 'tests/support-v6.test.ts', 'tests/v23-v6-integration.test.ts', 'scripts/rescore-v23-local.mjs', 'scripts/verify-v23-v6-local.mjs', 'scripts/model-v6-evaluation.mjs', 'scripts/verify-model-v6.mjs', 'compose.v23-local.yaml'];
const fullDomain = current('src/domain.ts');
const bDomain = fullDomain.replace("['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'v10', 'v11']", "['v1', 'v2']");
const bPatch = bFiles.map(p => patch(p, old(p), current(p))).join('') + patch('src/domain.ts', old('src/domain.ts'), bDomain);
const cPatch = cFiles.map(p => patch(p, old(p), current(p))).join('') + patch('src/domain.ts', bDomain, fullDomain);
const outputDirectory = process.argv[2] || 'handoff-v28-v11-real';
mkdirSync(outputDirectory, { recursive: true });
for (const [name, data] of [['B_scoring-v28.patch', bPatch], ['C_prompt-v11-after-B.patch', cPatch]]) {
  writeFileSync(outputDirectory + '/' + name, data, { flag: 'wx' });
  console.log(name);
}
