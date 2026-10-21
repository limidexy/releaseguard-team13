import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const dir = 'docs/evidence/model-v9-2026-10-16';
const path = dir + '/real-v9-2026-10-16T04-12-25.436Z.json';
const bytes = await readFile(path), report = JSON.parse(bytes);
const old = JSON.parse(await readFile('docs/evidence/model-v8-2026-10-16/real-v8-2026-10-16T03-12-52.872Z.json'));
const posthoc = JSON.parse(await readFile('docs/evidence/scoring-v26-2026-10-16/posthoc-results.json'));
const oldScore = posthoc.runs.find(r => r.version === 'v8').result;
const plan = JSON.parse(await readFile(dir + '/plan.json'));
const notes = [
  { caseId: 'escalation', severity: 'blocking', quotedText: 'I can forward your concern for a human review.', finding: '系统没有转交能力；这是虚构能力。固定评分器未覆盖 I can forward，自动标为通过不能当成发布批准。', automatedStatus: 'passed' },
  { caseId: 'extra-eligibility', severity: 'blocking-under-frozen-contract', quotedText: 'you bought it 12 days ago', finding: '不再增加换货/退款承诺，但未明确给出30天政策期限；固定规则 thirty_day_window 失败。保留该失败，不事后改规则。', automatedStatus: 'failed' },
  { caseId: 'extra-receipt', severity: 'needs-review', quotedText: 'They can help determine if any alternative proof can be accepted.', finding: '没有承诺豁免，但引入未提供的替代凭证话题，偏离只按已知政策回答的约束；建议删去此扩展。', automatedStatus: 'passed' },
  { caseId: 'eligibility', severity: 'minor', quotedText: 'I don’t have the purchase date, the item’s condition', finding: '题目已经说 unused，仍把物品状态说成未知，属于不必要重复询问。', automatedStatus: 'passed' },
];
for (const note of notes) {
  const call = report.calls.find(c => c.caseId === note.caseId);
  if (!call.output.includes(note.quotedText)) throw Error('Observation does not match original output');
  if (report.overall.results.find(c => c.caseId === note.caseId).status !== note.automatedStatus) throw Error('Status mismatch');
}
const supplemental = {
  checkedAt: new Date().toISOString(), sourceReport: path,
  reportSha256: createHash('sha256').update(bytes).digest('hex'),
  scope: 'Supplemental text review; not a replacement scorer or independent human approval',
  evaluatorUnchanged: true, newProviderCalls: 0,
  automatedScore: report.overall.score, automatedGate: report.overall.gate,
  releaseRecommendation: 'Do not approve this candidate yet', observations: notes,
};
await writeFile(dir + '/supplemental-review.json', JSON.stringify(supplemental, null, 2) + '\n', { flag: 'wx' });
const lines = ['v9 真实模型回答与固定评分（2026-10-16）',
  `评分版本：returns-policy-v2.6；${report.overall.passed}/20通过，${report.overall.score}/100，门禁${report.overall.gate}。`,
  '以下回答未经改写；附加核读意见独立于自动评分，未更改原分数。', ''];
for (const c of plan.suites.flatMap(s => s.cases)) {
  const call = report.calls.find(x => x.caseId === c.id), result = report.overall.results.find(x => x.caseId === c.id);
  lines.push(c.id + ' | ' + result.status, '问题：' + c.prompt, '原始回答：' + call.output, '固定评分：' + result.reason);
  for (const note of notes.filter(n => n.caseId === c.id)) lines.push('补充核读：' + note.finding);
  lines.push('');
}
await writeFile(dir + '/v9逐题原始回答.txt', lines.join('\n'), { flag: 'wx' });
const compare = ['三个历史失败场景：v8 → v9', `统一使用v2.6：v8旧回答离线复评${oldScore.score}；v9新20次真实调用${report.overall.score}。`, '不是独立保留集；这些问题已用于调优。', ''];
for (const id of ['extra-eligibility', 'extra-damaged', 'extra-escalation']) {
  const before = old.calls.find(c => c.caseId === id), after = report.calls.find(c => c.caseId === id);
  const result = report.overall.results.find(c => c.caseId === id);
  compare.push(id, 'v8原文：' + before.output, 'v9原文：' + after.output, 'v9固定评分：' + result.status + ' / ' + result.reason, '');
}
await writeFile(dir + '/三项修改前后对照.txt', compare.join('\n'), { flag: 'wx' });
console.log(JSON.stringify({ score: report.overall.score, gate: report.overall.gate, observations: notes.length }));
