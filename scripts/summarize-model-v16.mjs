import assert from 'node:assert/strict';
import {readFile,writeFile,copyFile,constants} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {evaluate} from '../dist/src/domain.js';
const dir='docs/evidence/model-v16-2026-10-16',file=process.argv[2];
if(!file)throw Error('Provide completed v16 report');
const raw=await readFile(file),r=JSON.parse(raw),plan=JSON.parse(await readFile(dir+'/plan.json')),cases=plan.suites.flatMap(s=>s.cases);
const oldRaw=await readFile('docs/evidence/model-v15-2026-10-16/real-v15-2026-10-16T08-31-07.250Z.json'),old=JSON.parse(oldRaw);
assert.equal(createHash('sha256').update(oldRaw).digest('hex'),'01c9392af186ea9bea8a126127f0b82d347ac94c5546dc0387c6995a553666f8');
const oldCurrent=evaluate(cases,plan.policy,old.calls);assert.equal(oldCurrent.score,100);
const comparison=cases.map(c=>{
 const before=oldCurrent.results.find(x=>x.caseId===c.id),after=r.overall.results.find(x=>x.caseId===c.id),record=r.controlled.records.find(x=>x.caseId===c.id);
 return {caseId:c.id,before:before.status,after:after.status,previousReason:before.reason,currentReason:after.reason,guard:record.validation,delivery:record.delivery.status,decision:record.decision};
});
const outcome={createdAt:new Date().toISOString(),evaluatorVersion:'returns-policy-v2.10',sameQuestionsAndThresholds:true,
previousFrozenV29Score:old.overall.score,previousV30Rescore:oldCurrent.score,rawModelScore:r.overall.score,rawModelGate:r.overall.gate,
legacyV29Score:r.legacyV29Comparison.score,legacyV28Score:r.legacyV28Comparison.score,combinedGate:r.controlled.result.gate,delivery:r.controlled.result.deliveryValidation,calls:r.totalCalls,tokens:r.totalTokens,
fixedSameV30:comparison.filter(c=>c.before!=='passed'&&c.after==='passed').map(c=>c.caseId),
regressionsSameV30:comparison.filter(c=>c.before==='passed'&&c.after!=='passed').map(c=>c.caseId),
rawFailures:comparison.filter(c=>c.after!=='passed').map(c=>({caseId:c.caseId,reason:c.currentReason})),comparison,
scope:'Raw real-model outputs only. Same 20 development cases and v2.10 scorer. Guard blocks, never repairs. Not an unseen benchmark or independent human approval.'};
await writeFile(dir+'/same-v30-comparison.json',JSON.stringify(outcome,null,2)+'\n',{flag:'wx'});
const transcript=['v16：20题原始模型回答与独立交付校验','原始模型得分 '+r.overall.score+'/100（v2.10），原始门禁 '+r.overall.gate+'。',
'交付允许 '+r.controlled.result.deliveryValidation.allowed+'，阻断 '+r.controlled.result.deliveryValidation.blocked+'；综合门禁 '+r.controlled.result.gate+'。',
'没有程序修正、替换或挑选回答。阻断时客户输出为 null；下面保留原话。',''];
const contrast=['v15 → v16：同20题、同v2.10评分器对照','v15冻结v2.9成绩90及其全部原始记录保持不变。',''];
for(const c of cases){
 const call=r.calls.find(x=>x.caseId===c.id),prev=old.calls.find(x=>x.caseId===c.id),row=comparison.find(x=>x.caseId===c.id);
 transcript.push(c.id+' | 原始评分 '+row.after+' | 交付 '+row.delivery,'问题：'+c.prompt,'业务结论：'+JSON.stringify(row.decision),'原始回答：'+(call?.output??'[没有完整回答]'),'评分原因：'+row.currentReason,'独立校验：'+(row.guard.failures.join(', ')||'通过'),'');
 contrast.push(c.id,'问题：'+c.prompt,'v15原话：'+prev.output,'v16原话：'+(call?.output??'[没有完整回答]'),'同v2.10评分：'+row.before+' → '+row.after,'交付校验：'+row.delivery+'；'+row.guard.failures.join(', '),'');
}
await writeFile(dir+'/v16逐题原始回答与校验.txt',transcript.join('\n'),{flag:'wx'});
await writeFile(dir+'/全部问题修改前后对照.txt',contrast.join('\n'),{flag:'wx'});
for(const [from,name] of [['/tmp/rg-v16-tests.log','full-local-tests.log'],['/tmp/rg-v16-clean-tests.log','clean-patch-tests.log'],['/tmp/rg-v16-red.log','red-missing-v16.log'],['/tmp/rg-v16-docker.log','docker-build-and-start.log'],['/tmp/rg-v16-http.log','new-http-regression.log'],['/tmp/rg-v16-compat.log','legacy-http-regression.log']])await copyFile(from,dir+'/'+name,constants.COPYFILE_EXCL);
console.log(JSON.stringify({...outcome,comparison:undefined}));
