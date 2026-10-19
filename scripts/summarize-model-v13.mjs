import assert from 'node:assert/strict';
import {readFile,writeFile,copyFile,constants} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {evaluate} from '../dist/src/domain.js';
const dir='docs/evidence/model-v13-2026-10-16',file=process.argv[2];
if(!file)throw Error('Provide completed v13 report');
const raw=await readFile(file),r=JSON.parse(raw),plan=JSON.parse(await readFile(dir+'/plan.json')),cases=plan.suites.flatMap(s=>s.cases);
const oldRaw=await readFile('docs/evidence/model-v12-2026-10-16/real-v12-2026-10-16T06-02-56.533Z.json'),old=JSON.parse(oldRaw);
assert.equal(createHash('sha256').update(oldRaw).digest('hex'),'03761aa70d396801dd77e8072d3b57f9126916804b3339290e26e58f55a8c4e5');
assert.deepEqual(evaluate(cases,plan.policy,old.calls),old.overall);
const comparison=cases.map(c=>{
 const before=old.overall.results.find(x=>x.caseId===c.id),after=r.overall.results.find(x=>x.caseId===c.id),record=r.controlled.records.find(x=>x.caseId===c.id);
 return {caseId:c.id,before:before.status,after:after.status,previousReason:before.reason,currentReason:after.reason,guard:record.validation,delivery:record.delivery.status,decision:record.decision};
});
const outcome={createdAt:new Date().toISOString(),evaluatorVersion:'returns-policy-v2.8',sameQuestionsAndThresholds:true,previousRawScore:old.overall.score,rawModelScore:r.overall.score,rawModelGate:r.overall.gate,combinedGate:r.controlled.result.gate,delivery:r.controlled.result.deliveryValidation,calls:r.totalCalls,tokens:r.totalTokens,
 fixed:comparison.filter(c=>c.before!=='passed'&&c.after==='passed').map(c=>c.caseId),
 regressions:comparison.filter(c=>c.before==='passed'&&c.after!=='passed').map(c=>c.caseId),
 rawFailures:comparison.filter(c=>c.after!=='passed').map(c=>({caseId:c.caseId,reason:c.currentReason})),comparison,
 scope:'Raw real-model score unchanged. Guard blocks, never repairs. Same development cases, not unseen benchmark. Automated validation is not independent human approval.'};
await writeFile(dir+'/same-rule-comparison.json',JSON.stringify(outcome,null,2)+'\n',{flag:'wx'});
const transcript=['v13：20题原始模型回答与独立交付校验',
 '原始模型得分 '+r.overall.score+'/100，原始门禁 '+r.overall.gate+'。',
 '交付允许 '+r.controlled.result.deliveryValidation.allowed+'，阻断 '+r.controlled.result.deliveryValidation.blocked+'；综合门禁 '+r.controlled.result.gate+'。',
 '没有程序修正或替换回答。阻断时客户输出为 null；下面保留未经修改的原话。',''];
const contrast=['v12 → v13：同问题、同评分规则对照','不把确定性业务结论当作模型答案；模型得分只使用原始生成文本。',''];
for(const c of cases){
 const call=r.calls.find(x=>x.caseId===c.id),prev=old.calls.find(x=>x.caseId===c.id),row=comparison.find(x=>x.caseId===c.id);
 transcript.push(c.id+' | 原始评分 '+row.after+' | 交付 '+row.delivery,'问题：'+c.prompt,
 '业务结论：'+JSON.stringify(row.decision),'原始回答：'+(call?.output??'[没有完整回答]'),
 '原始评分原因：'+row.currentReason,'独立校验：'+(row.guard.failures.join(', ')||'通过'),'');
 contrast.push(c.id,'问题：'+c.prompt,'v12原话：'+prev.output,'v13原话：'+(call?.output??'[没有完整回答]'),
 '旧/新原始评分：'+row.before+' → '+row.after,'交付校验：'+row.delivery+'；'+row.guard.failures.join(', '),'');
}
await writeFile(dir+'/v13逐题原始回答与校验.txt',transcript.join('\n'),{flag:'wx'});
await writeFile(dir+'/全部问题修改前后对照.txt',contrast.join('\n'),{flag:'wx'});
for(const [from,name] of [
 ['/tmp/rg-v13-tests.log','full-local-tests.log'],['/tmp/rg-v13-clean-tests.log','clean-patch-tests.log'],
 ['/tmp/rg-v13-red-baseline.log','red-original-guard-gap.log'],
 ['/tmp/rg-v13-compose.log','docker-build-and-start.log'],['/tmp/rg-v13-legacy-http.log','legacy-http-regression.log']
])await copyFile(from,dir+'/'+name,constants.COPYFILE_EXCL);
console.log(JSON.stringify({...outcome,comparison:undefined}));
