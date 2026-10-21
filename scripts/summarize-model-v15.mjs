import assert from 'node:assert/strict';
import {readFile,writeFile,copyFile,constants} from 'node:fs/promises';
import {evaluate} from '../dist/src/domain.js';
const dir='docs/evidence/model-v15-2026-10-16',file=process.argv[2];
if(!file)throw Error('Provide completed v15 report');
const r=JSON.parse(await readFile(file)),plan=JSON.parse(await readFile(dir+'/plan.json')),cases=plan.suites.flatMap(s=>s.cases);
const old=JSON.parse(await readFile('docs/evidence/model-v14-2026-10-16/real-v14-2026-10-16T07-28-43.967Z.json'));
const oldNew=evaluate(cases,plan.policy,old.calls);
const comparison=cases.map(c=>{
 const before=oldNew.results.find(x=>x.caseId===c.id),after=r.overall.results.find(x=>x.caseId===c.id),record=r.controlled.records.find(x=>x.caseId===c.id);
 return {caseId:c.id,before:before.status,after:after.status,previousReason:before.reason,currentReason:after.reason,guard:record.validation,delivery:record.delivery.status,decision:record.decision};
});
const outcome={createdAt:new Date().toISOString(),sameQuestionsAndThresholds:true,
scoreMatrix:{v14:{originalV28:old.overall.score,rescoredV29:oldNew.score},v15:{legacyV28:r.legacyV28Comparison.score,currentV29:r.overall.score}},
rawModelScore:r.overall.score,rawModelGate:r.overall.gate,combinedGate:r.controlled.result.gate,delivery:r.controlled.result.deliveryValidation,calls:r.totalCalls,tokens:r.totalTokens,
fixedSameV29:comparison.filter(c=>c.before!=='passed'&&c.after==='passed').map(c=>c.caseId),
regressionsSameV29:comparison.filter(c=>c.before==='passed'&&c.after!=='passed').map(c=>c.caseId),
rawFailures:comparison.filter(c=>c.after!=='passed').map(c=>({caseId:c.caseId,reason:c.currentReason})),comparison,
scope:'Raw outputs scored separately by version. v14 original 90 remains untouched. Guard blocks, never repairs. Same development cases, not unseen benchmark. Automated validation is not independent human approval.'};
await writeFile(dir+'/version-separated-comparison.json',JSON.stringify(outcome,null,2)+'\n',{flag:'wx'});
const transcript=['v15：20题原始回答与独立校验','原始模型得分 '+r.overall.score+'/100（评分器 v2.9），门禁 '+r.overall.gate+'。',
'同一批 v15 原文按旧 v2.8 评分：'+r.legacyV28Comparison.score+'；不要混淆评分器修正和模型进步。',
'交付允许 '+r.controlled.result.deliveryValidation.allowed+'，阻断 '+r.controlled.result.deliveryValidation.blocked+'；综合门禁 '+r.controlled.result.gate+'。',
'没有程序修正或替换模型回答，阻断时客户输出为 null。尚无独立人工审批。',''];
const contrast=['v14 → v15：相同问题、相同 v2.9 评分器比较','旧 v14 的原始 v2.8 90分记录保留；本文件的新规则重评分不是覆盖旧记录。',''];
for(const c of cases){
 const call=r.calls.find(x=>x.caseId===c.id),prev=old.calls.find(x=>x.caseId===c.id),row=comparison.find(x=>x.caseId===c.id);
 transcript.push(c.id+' | 原始评分 '+row.after+' | 交付 '+row.delivery,'问题：'+c.prompt,'业务结论：'+JSON.stringify(row.decision),'原始回答：'+(call?.output??'[没有完整回答]'),'评分原因：'+row.currentReason,'独立校验：'+(row.guard.failures.join(', ')||'通过'),'');
 contrast.push(c.id,'问题：'+c.prompt,'v14原话：'+prev.output,'v15原话：'+(call?.output??'[没有完整回答]'),'同 v2.9 评分：'+row.before+' → '+row.after,'交付校验：'+row.delivery+'；'+row.guard.failures.join(', '),'');
}
await writeFile(dir+'/v15逐题原始回答与校验.txt',transcript.join('\n'),{flag:'wx'});
await writeFile(dir+'/全部问题修改前后对照.txt',contrast.join('\n'),{flag:'wx'});
for(const [from,name] of [['/tmp/rg-v15-tests.log','full-local-tests.log'],['/tmp/rg-v15-clean-tests.log','clean-patch-tests.log'],['/tmp/rg-v15-red.log','red-policy-collection.log'],['/tmp/rg-v15-red-json.log','red-json-availability.log'],['/tmp/rg-v15-docker.log','docker-build-and-start.log'],['/tmp/rg-v15-http.log','new-http-regression.log'],['/tmp/rg-v15-compat.log','legacy-http-regression.log']])await copyFile(from,dir+'/'+name,constants.COPYFILE_EXCL);
console.log(JSON.stringify({...outcome,comparison:undefined}));
