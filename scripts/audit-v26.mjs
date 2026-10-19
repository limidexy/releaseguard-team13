import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { evaluate } from '../dist/src/domain.js';
const dir = 'docs/evidence/scoring-v26-2026-10-16';
await mkdir(dir, { recursive: true });
const sha = b => createHash('sha256').update(b).digest('hex');
const files = {
  v6: ['docs/evidence/model-v6-2026-10-15/real-v6-2026-10-15T13-06-29.373Z.json', 'dad85eaac68d727f280b9eefd869af71f5fa250ed5d066191b02fd0e602e927c'],
  v7: ['docs/evidence/model-v7-2026-10-16/real-v7-2026-10-16T03-05-31.073Z.json', '3e7560742e4f93eeed00df04da9cabb1629bd7a62ba4396abfcec90cd0a781f6'],
  v8: ['docs/evidence/model-v8-2026-10-16/real-v8-2026-10-16T03-12-52.872Z.json', '8fa7c14eff269497bf426df60d0913976ff22352ec66b4e07740ca36bccd1af6'],
};
const plan = JSON.parse(await readFile('docs/evidence/model-v8-2026-10-16/plan.json'));
const cases = plan.suites.flatMap(s => s.cases).map(c => ({ ...c, rule: 'returns_policy_v2_6' }));
const sources = {};
for (const p of ['src/returns-policy.ts', 'src/refinements-v26.ts', 'src/privacy-v25.ts', 'src/answer-v25.ts', 'src/domain.ts', 'dist/src/returns-policy.js', 'dist/src/refinements-v26.js', 'dist/src/privacy-v25.js', 'dist/src/answer-v25.js', 'dist/src/domain.js']) {
  const bytes = await readFile(p); sources[p] = sha(bytes);
  await mkdir(dir + '/source/' + p.split('/').slice(0, -1).join('/'), { recursive: true });
  await writeFile(dir + '/source/' + p + '.txt', bytes, { flag: 'wx' });
}
const report = { createdAt: new Date().toISOString(), kind: 'post-hoc offline rescore of immutable real responses', newProviderCalls: 0, evaluatorVersion: 'returns-policy-v2.6', policy: plan.policy, sources, cases, runs: [] };
for (const [version, [path, expectedHash]] of Object.entries(files)) {
  const bytes = await readFile(path); if (sha(bytes) !== expectedHash) throw Error('Historical report changed: ' + version);
  const original = JSON.parse(bytes), result = evaluate(cases, plan.policy, original.calls);
  const fixedV25 = evaluate(cases.map(c => ({ ...c, rule: 'returns_policy_v2_5' })), plan.policy, original.calls);
  if (version !== 'v6' && JSON.stringify(fixedV25) !== JSON.stringify(original.overall)) throw Error('Frozen v2.5 behavior changed');
  report.runs.push({ version, sourceReport: path, sourceSha256: expectedHash, originalScore: original.overall.score,
    originalEvaluator: original.evaluatorVersion, actualCalls: original.calls.length, v25Rescore: fixedV25, result });
}
await writeFile(dir + '/posthoc-results.json', JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
const raw = JSON.parse(await readFile(files.v8[0]));
const current = report.runs.find(r => r.version === 'v8').result;
const lines = ['v8 真实回答逐题检查', '原始 v2.5：90/100；事后 v2.6 离线复评：' + current.score + '/100。没有新增模型调用。', '检查由工具辅助完成，不是独立人工审批。', ''];
for (const c of cases) {
  const call = raw.calls.find(x => x.caseId === c.id), result = current.results.find(x => x.caseId === c.id);
  lines.push(c.id + ' | ' + result.status, '问题：' + c.prompt, '原始回答：' + call.output, '检查：' + result.reason, '');
}
await writeFile(dir + '/v8逐题原始回答.txt', lines.join('\n'), { flag: 'wx' });
console.log(JSON.stringify(report.runs.map(r => ({ version: r.version, score: r.result.score, gate: r.result.gate, failed: r.result.results.filter(x => x.status !== 'passed').map(x => x.caseId) }))));
