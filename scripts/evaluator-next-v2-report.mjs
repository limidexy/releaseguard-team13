// Presentation of immutable offline records; never alters candidate or reference judgments.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {evaluateResponseNextV1} from '../dist/src/evaluator-next-v1.js';
const dir='docs/evidence/evaluator-next-v2-independent-2026-10-21';
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const summary=await read(path.join(dir,'summary.json')),records=await read(path.join(dir,'records.json'));
const oldHash=createHash('sha256').update(await fs.readFile('src/evaluator-next-v1.ts')).digest('hex');
if(oldHash!=='d724a987593d168651816e3335249b79a1a857b4d8427ae24478e247e37c8a1c')throw Error('Old frozen candidate changed');
const oldRows=records.map(row=>{const r=evaluateResponseNextV1(row.response,row.contract,row.decision);return {fixtureId:row.fixtureId,expectedAllowed:row.expectedAllowed,allowed:r.finalDeliveryStatus==='allowed',failedRuleIds:r.checks.filter(c=>c.status==='failed').map(c=>c.ruleId),expectedReasons:row.expectedRuleFamilies};});
const old={correctAllows:oldRows.filter(x=>x.expectedAllowed&&x.allowed).length,falseBlocks:oldRows.filter(x=>x.expectedAllowed&&!x.allowed).length,correctBlocks:oldRows.filter(x=>!x.expectedAllowed&&!x.allowed).length,falseAllows:oldRows.filter(x=>!x.expectedAllowed&&x.allowed).length,violationsWithExpectedKeyReason:oldRows.filter(x=>!x.expectedAllowed&&!x.allowed&&x.expectedReasons.every(id=>x.failedRuleIds.includes(id))).length};
await fs.writeFile(path.join(dir,'POSTHOC-OLD-BASELINE.json'),JSON.stringify({source:'Separate post-hoc offline comparison of unchanged r3 on the same new reference set; not another candidate run or a model score.',oldSourceSha256:oldHash,sampleSha256:summary.sampleSha256,metrics:old,records:oldRows},null,2)+'\n',{flag:'wx'});
const report=await read(path.join(dir,'POSTHOC-REVIEW.json'));
const conflicts=new Set(report.frozenReferenceDisagreements.flatMap(x=>x.ids));
const lines=['ReleaseGuard 候选检查器 v2：独立 AI 参考集逐题结果','',
 '来源：冻结候选之后，由隔离子代理仅依据批准规范及20个问题编写。不是已核实真人盲审。',
 '说明：下列“参考正确/违规”及结果均保留原始冻结口径。标注争议另列，不回写分数。',
 `状态：${summary.status}`,
 `新80条：正确回答允许 ${summary.metrics.correctAllows}/40；违规回答阻断 ${summary.metrics.correctBlocks}/40；识别全部预期关键问题 ${summary.metrics.violationsWithExpectedKeyReason}/40。`,
 `误拦 ${summary.metrics.falseBlocks}；误放 ${summary.metrics.falseAllows}；unverifiable ${summary.metrics.unverifiableSamples}；引用错误 ${summary.metrics.evidenceErrors}；原文改动 ${summary.metrics.rawAlterations}。`,
 '', '同一新样本上的旧版对照（单独后验离线计算，不是模型成绩）：',
 `旧r3：正确允许 ${old.correctAllows}/40；违规阻断 ${old.correctBlocks}/40；关键原因识别 ${old.violationsWithExpectedKeyReason}/40。`,
 '不能仅凭阻断变多说更可靠：新版本减少误放，但增加误拦；整体判断符合参考的数量两版均为59/80。',''];
for(const row of records){
 const failures=row.result.checks.filter(c=>c.status!=='passed');
 lines.push('='.repeat(60),`${row.fixtureId} | ${row.caseId} | 参考：${row.expectedAllowed?'合规':'违规'} | 实际：${row.result.finalDeliveryStatus==='allowed'?'允许':'阻断'}`,
 `最终判断与参考一致：${row.decisionAgreement?'是':'否'}；预期关键违规原因识别：${row.expectedAllowed?'不适用':row.expectedKeyReasonsRecognized?'是':'否'}`,
 conflicts.has(row.fixtureId)?'注意：此条存在单独记录的输入/参考口径争议，冻结结果未改动。':'',
 '客户问题：'+row.question,
 '确定性业务结论：'+JSON.stringify({standardEligibility:row.decision.standardEligibility,purchaseDaysAgo:row.decision.facts.purchaseDaysAgo,requiresHumanReview:row.decision.requiresHumanReview}),
 '必要陈述：'+row.contract.mustState.map(x=>x.ruleId).join(', '),
 '必要询问：'+row.contract.mustAsk.map(x=>x.ruleId).join(', '),
 '原始参考回答（AI编写，不是客服模型生成成绩）：',row.response,
 '参考理由：'+row.annotationRationale,
 '预期关键失败：'+(row.expectedRuleFamilies.join(', ')||'无'),
 '实际失败/无法验证：'+(failures.map(x=>x.ruleId+' ['+x.status+']').join(', ')||'无'),
 '逐项判定：',...row.result.checks.map(c=>'  '+c.ruleId+' | '+c.status+' | '+c.reason+' | 引用：'+c.evidence.map(e=>e.path+'['+e.start+':'+e.end+'] '+JSON.stringify(e.text)).join(' ; ')),
 '引用位置错误数：'+row.evidenceErrors.length,'原文保持不变：'+(row.rawUnchanged?'是':'否'),'');
}
await fs.writeFile(path.join(dir,'逐题结果.txt'),lines.join('\n')+'\n',{flag:'wx'});
console.log(JSON.stringify({status:summary.status,oldSameSetMetrics:old,newSameSetMetrics:summary.metrics,annotatedDisputeIds:[...conflicts],report:path.join(dir,'逐题结果.txt')}));
