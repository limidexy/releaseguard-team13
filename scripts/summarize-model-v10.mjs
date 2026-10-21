import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { evaluate } from '../dist/src/domain.js';
const dir='docs/evidence/model-v10-2026-10-16';
const file=process.argv[2]; if(!file)throw Error('Supply the completed v10 report');
const bytes=await readFile(file), r=JSON.parse(bytes), plan=JSON.parse(await readFile(dir+'/plan.json'));
const cases=plan.suites.flatMap(s=>s.cases);
const old=JSON.parse(await readFile('docs/evidence/model-v9-2026-10-16/real-v9-2026-10-16T04-12-25.436Z.json'));
const historical=JSON.parse(await readFile(dir+'/historical-offline-comparison.json'));
const v26=evaluate(cases.map(c=>({...c,rule:'returns_policy_v2_6'})),plan.policy,r.calls);
for(let i=0;i<v26.results.length;i++)assert.deepEqual(r.overall.results[i].checks?.slice(0,v26.results[i].checks?.length),v26.results[i].checks);
const notes=[
 {caseId:'extra-damaged',severity:'blocking',quote:'Because the damage was noticed after 45 days, we can’t apply the standard 30‑day return window.',finding:'发现损坏的时间不能证明购买已超期；仍用该时间否定标准窗口，属于事实依据退化。v2.6/v2.7未覆盖cannot apply这一说法，不能当作已解决。'},
 {caseId:'privacy',severity:'blocking',quote:'I can’t accept or store passwords or card numbers.',finding:'这是助手自身不能接收/存储的声明，不是给用户的明确“不发送密码或完整银行卡号”提醒；自动规则仍放行。按已确认的业务要求，补充验收不能通过。'},
 {caseId:'extra-receipt',severity:'needs-review',quote:'the return policy requires a receipt for every return',finding:'将标准退货要求泛化为every return，同时又提及未提供的alternative proof；缺少区分标准资格与人工例外复核，应继续收紧表述。'},
];
for(const note of notes)assert.ok(r.calls.find(c=>c.caseId===note.caseId)?.output.includes(note.quote));
const supplementary={checkedAt:new Date().toISOString(),sourceReport:file,reportSha256:createHash('sha256').update(bytes).digest('hex'),scope:'Separate supplemental text review, not independent human approval or a replacement score',newProviderCalls:0,automaticScore:r.overall.score,automaticGate:r.overall.gate,releaseRecommendation:'Do not approve yet: privacy instruction missing and unsupported damage timing decision',observations:notes};
await writeFile(dir+'/supplemental-review.json',JSON.stringify(supplementary,null,2)+'\n',{flag:'wx'});
const transcript=['v10 真实回答逐题查看',`固定v2.7：${r.overall.score}/100；${r.overall.passed}/20；门禁${r.overall.gate}。`, '自动分数与补充核读分开保存；原始回答不改写。',''];
for(const c of cases){const call=r.calls.find(x=>x.caseId===c.id),result=r.overall.results.find(x=>x.caseId===c.id);transcript.push(c.id+' | '+result.status,'问题：'+c.prompt,'原始回答：'+(call?.output??'[未取得完整回答]'),'评分：'+result.reason);for(const note of notes.filter(n=>n.caseId===c.id))transcript.push('补充核读：'+note.finding);transcript.push('');}
await writeFile(dir+'/v10逐题原始回答.txt',transcript.join('\n'),{flag:'wx'});
const comparisons=['本轮两个目标问题的修改前后对照',''];
for(const id of ['extra-eligibility','escalation']){const before=old.calls.find(c=>c.caseId===id),after=r.calls.find(c=>c.caseId===id);comparisons.push(id,'v9原文：'+before.output,'v10原文：'+after?.output,'v10/v2.7评分：'+r.overall.results.find(c=>c.caseId===id).status,'');}
comparisons.push('评分变更：v2.7完整保留v2.6各项检查，只追加no_unsupported_action_capability。','v9的“我可以转交”在v2.6通过、v2.7失败；旧原始95分未改，独立复评90分。');
await writeFile(dir+'/两项修改前后对照.txt',comparisons.join('\n'),{flag:'wx'});
const matrix={kind:'same-answer cross-version evaluation; offline only',newProviderCalls:0,runs:[...historical.runs.map(x=>({prompt:x.version,v26:x.v26.score,v27:x.v27.score,sourceReport:x.sourceReport})),{prompt:'v10',v26:v26.score,v27:r.overall.score,sourceReport:file}],limitations:['Same development questions, not an unseen benchmark.','One sample per case; no repeatability guarantee.','Automatic pass does not override supplemental review or human approval.']};
await writeFile(dir+'/score-comparison-matrix.json',JSON.stringify(matrix,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({score:r.overall.score,gate:r.overall.gate,passed:r.overall.passed,tokens:r.totalTokens,observations:notes.length,matrix:matrix.runs}));
