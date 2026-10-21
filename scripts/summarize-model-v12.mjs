import assert from 'node:assert/strict';
import {readFile,writeFile,copyFile,constants} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {evaluate} from '../dist/src/domain.js';
const dir='docs/evidence/model-v12-2026-10-16',file=process.argv[2];
if(!file)throw Error('Provide completed v12 report');
const raw=await readFile(file),r=JSON.parse(raw),plan=JSON.parse(await readFile(dir+'/plan.json')),cases=plan.suites.flatMap(s=>s.cases);
const oldFile='docs/evidence/model-v11-2026-10-16/real-v11-2026-10-16T05-48-11.359Z.json';
const oldRaw=await readFile(oldFile),old=JSON.parse(oldRaw);
assert.equal(createHash('sha256').update(oldRaw).digest('hex'),'6f457aa8e6508bbbc02bf97bc7d07a2f3c88b4dfc5a652ed75dca62d7ad7dbb3');
assert.deepEqual(evaluate(cases,plan.policy,old.calls),old.overall);
const comparison=cases.map(c=>{
 const before=old.overall.results.find(x=>x.caseId===c.id),after=r.overall.results.find(x=>x.caseId===c.id);
 return {caseId:c.id,before:before.status,after:after.status,previousReason:before.reason,currentReason:after.reason};
});
const outcome={createdAt:new Date().toISOString(),evaluatorVersion:'returns-policy-v2.8',sameQuestionsAndThresholds:true,previousScore:old.overall.score,score:r.overall.score,gate:r.overall.gate,calls:r.totalCalls,tokens:r.totalTokens,
 fixed:comparison.filter(c=>c.before!=='passed'&&c.after==='passed').map(c=>c.caseId),
 regressions:comparison.filter(c=>c.before==='passed'&&c.after!=='passed').map(c=>c.caseId),
 failures:comparison.filter(c=>c.after!=='passed'),comparison,
 scope:'Frozen heuristic scoring of raw real-model responses; not independent human acceptance. Same development questions, not a held-out benchmark.'};
await writeFile(dir+'/same-rule-comparison.json',JSON.stringify(outcome,null,2)+'\n',{flag:'wx'});
const transcript=['v12 真实回答（原文保留）',`v2.8：${r.overall.score}/100；门禁 ${r.overall.gate}；实际 ${r.totalCalls} 次调用。`,'自动评分不是独立人工验收。',''];
const contrast=['v11 → v12：同问题、同评分规则对照',''];
for(const c of cases){
 const call=r.calls.find(x=>x.caseId===c.id),prev=old.calls.find(x=>x.caseId===c.id),result=r.overall.results.find(x=>x.caseId===c.id);
 transcript.push(c.id+' | '+result.status,'问题：'+c.prompt,'原始回答：'+(call?.output??'[没有完整回答]'),'评分：'+result.reason,'');
 contrast.push(c.id,'问题：'+c.prompt,'v11：'+prev.output,'v12：'+(call?.output??'[没有完整回答]'),'v12评分：'+result.reason,'');
}
await writeFile(dir+'/v12逐题原始回答.txt',transcript.join('\n'),{flag:'wx'});
await writeFile(dir+'/全部问题修改前后对照.txt',contrast.join('\n'),{flag:'wx'});
await copyFile('/tmp/rg-v12-tests.log',dir+'/full-local-tests.log',constants.COPYFILE_EXCL);
await copyFile('/tmp/rg-v12-red-confirmed.log',dir+'/red-version-selection-test.log',constants.COPYFILE_EXCL);
await copyFile('/tmp/rg-v12-compose.log',dir+'/docker-build-and-start.log',constants.COPYFILE_EXCL);
console.log(JSON.stringify({...outcome,comparison:undefined}));
