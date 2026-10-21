import assert from 'node:assert/strict';
import { readFile, writeFile, copyFile, constants } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { evaluate } from '../dist/src/domain.js';
const dir='docs/evidence/model-v11-2026-10-16';
const file=process.argv[2]; if(!file)throw Error('Supply completed v11 report');
const bytes=await readFile(file),r=JSON.parse(bytes),plan=JSON.parse(await readFile(dir+'/plan.json'));
const cases=plan.suites.flatMap(s=>s.cases);
const before=JSON.parse(await readFile('docs/evidence/model-v10-2026-10-16/real-v10-2026-10-16T04-41-29.509Z.json'));
const historical=JSON.parse(await readFile(dir+'/historical-offline-comparison.json'));
const v27=evaluate(cases.map(c=>({...c,rule:'returns_policy_v2_7'})),plan.policy,r.calls);
for(let i=0;i<v27.results.length;i++)assert.deepEqual(r.overall.results[i].checks?.slice(0,v27.results[i].checks?.length),v27.results[i].checks);
const transcript=['v11 真实回答逐题查看',`固定 v2.8：${r.overall.score}/100；门禁 ${r.overall.gate}。`,'原文未经改写。模型错误、空回答、截断均不能通过；未执行项不冒充完成。',''];
for(const c of cases){
  const call=r.calls.find(x=>x.caseId===c.id),result=r.overall.results.find(x=>x.caseId===c.id);
  transcript.push(c.id+' | '+result.status,'问题：'+c.prompt,'原始回答：'+(call?.output??'[无完整回答]'),'评分：'+result.reason,'');
}
await writeFile(dir+'/v11逐题原始回答.txt',transcript.join('\n'),{flag:'wx'});
const comparison=['本轮两项修复：相同问题、原始回答对照',''];
for(const id of ['privacy','extra-privacy','damaged','extra-damaged']){
 const old=before.calls.find(x=>x.caseId===id),now=r.calls.find(x=>x.caseId===id),result=r.overall.results.find(x=>x.caseId===id);
 comparison.push(id,'v10原文：'+old.output,'v11原文：'+(now?.output??'[无完整回答]'),'v11/v2.8：'+result.status+'；'+result.reason,'');
}
comparison.push('v2.8 保留全部 v2.7 检查，追加用户隐私提醒、未知购买日期澄清、禁止无依据超期判断。','旧 v10 原始 100 分记录不改。其旧回答按新 v2.8 离线复评为 90 分，单独保存，不冒充再次模型调用。');
await writeFile(dir+'/两项修改前后对照.txt',comparison.join('\n'),{flag:'wx'});
const matrix={kind:'Separate offline cross-version scoring, not new model calls',newProviderCalls:0,runs:[...historical.runs.map(x=>({prompt:x.version,v27:x.v27.score,v28:x.v28.score,sourceReport:x.sourceReport})),{prompt:'v11',v27:v27.score,v28:r.overall.score,sourceReport:file}],limits:['Same development questions; not a held-out benchmark.','One response per case; no reliability guarantee.','Automatic score is not independent human approval.']};
await writeFile(dir+'/score-comparison-matrix.json',JSON.stringify(matrix,null,2)+'\n',{flag:'wx'});
for(const [from,to] of [['/tmp/rg-v28-red.log','red-tests.log'],['/tmp/rg-v28-boundaries-red.log','boundary-red-tests.log'],['/tmp/rg-v28-green.log','green-targeted-tests.log'],['/tmp/rg-v11-tests.log','full-local-tests.log']])await copyFile(from,dir+'/'+to,constants.COPYFILE_EXCL);
console.log(JSON.stringify({score:r.overall.score,gate:r.overall.gate,tokens:r.totalTokens,reportSha256:createHash('sha256').update(bytes).digest('hex'),failures:r.overall.results.filter(c=>c.status!=='passed').map(c=>({id:c.caseId,reason:c.reason}))}));
