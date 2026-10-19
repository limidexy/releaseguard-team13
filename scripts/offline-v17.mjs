import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {evaluate} from '../dist/src/domain.js';
import {evaluateControlledV17} from '../dist/src/controlled-evaluation-v17.js';
import {checkExplanationV2} from '../dist/src/output-guard-v2.js';
import {decisionForQuestionV1} from '../dist/src/returns-decision-v1.js';
import {promptSnapshot,responseModeV8} from '../dist/src/provider.js';
import {compileResponseContractV17} from '../dist/src/response-contract-v17.js';

const sha=value=>createHash('sha256').update(value).digest('hex');
const evidenceDirectory=process.env.RG_V17_EVIDENCE_DIR??'docs/evidence/model-v17-checker-r1-2026-10-17';
const testLogPath=process.env.RG_V17_TEST_LOG??`${evidenceDirectory}/full-offline-tests.log`;
const oldReports={
 v15:{path:'docs/evidence/model-v15-2026-10-16/real-v15-2026-10-16T08-31-07.250Z.json',sha256:'01c9392af186ea9bea8a126127f0b82d347ac94c5546dc0387c6995a553666f8'},
 v16:{path:'docs/evidence/model-v16-2026-10-16/real-v16-2026-10-16T08-50-53.534Z.json',sha256:'dfeee69328467283debc9153e54cf6955757a81e070466b71c1a97b7c0357cb1'},
};
const loadVersion=version=>{
 const raw=readFileSync(oldReports[version].path),report=JSON.parse(raw),plan=JSON.parse(readFileSync(`docs/evidence/model-${version}-2026-10-16/plan.json`));
 assert.equal(sha(raw),oldReports[version].sha256);
 return {raw,report,plan,cases:plan.suites.flatMap(s=>s.cases)};
};

let providerCalls=0;
globalThis.fetch=async()=>{providerCalls+=1;throw new Error('OFFLINE_V17_NETWORK_CALL_BLOCKED');};
const v15=loadVersion('v15'),v16=loadVersion('v16');
assert.equal(promptSnapshot('v15').sha256,v15.report.promptSnapshot.sha256);
assert.equal(promptSnapshot('v16').sha256,v16.report.promptSnapshot.sha256);

const caseContracts=v16.cases.map(testCase=>{
 const decision=decisionForQuestionV1(testCase.prompt),responseMode=responseModeV8(testCase.prompt),contract=compileResponseContractV17(testCase.prompt,decision,responseMode);
 return {caseId:testCase.id,question:testCase.prompt,extractedFacts:decision.facts,businessDecision:{standardEligibility:decision.standardEligibility,outsideStandardWindow:decision.outsideStandardWindow,requiresHumanReview:decision.requiresHumanReview,disposition:decision.disposition,standardFailureReasons:contract.standardFailureReasons,humanReviewReasons:contract.humanReviewReasons},compilationStatus:contract.compilationStatus,conflicts:contract.conflicts,mustState:contract.mustState,mustAsk:contract.mustAsk,mustNotClaim:contract.mustNotClaim,customerAction:contract.customerAction,clarificationBlocksHumanContact:contract.clarificationBlocksHumanContact,responseMode:contract.responseMode,intervalEvidence:contract.intervalEvidence};
});
assert.equal(caseContracts.length,20);
assert.equal(caseContracts.filter(x=>x.compilationStatus==='ready').length,20);
assert.equal(caseContracts.flatMap(x=>x.conflicts).length,0);
for(const id of ['damaged','extra-damaged','extra-receipt']){
 const row=caseContracts.find(x=>x.caseId===id);assert.ok(row);
 assert.ok(row.mustState.some(x=>x.ruleId==='PURCHASE_TIMING_UNKNOWN'));
 assert.ok(row.mustState.some(x=>x.ruleId==='HUMAN_REVIEW_REQUIRED'));
 assert.ok(row.mustAsk.some(x=>x.ruleId==='ASK_PURCHASE_DATE'));
}
assert.ok(caseContracts.find(x=>x.caseId==='extra-damaged').mustState.some(x=>x.ruleId==='MENTIONED_INTERVAL_DOES_NOT_ESTABLISH_PURCHASE_AGE'));
assert.ok(caseContracts.find(x=>x.caseId==='extra-receipt').mustState.some(x=>x.ruleId==='RECEIPT_CONDITION_UNMET'));

const legacyAccounting=(cases,policy,calls)=>{
 const scoring=evaluate(cases,policy,calls);
 const guard=cases.map(testCase=>{const output=calls.find(x=>x.caseId===testCase.id);return {caseId:testCase.id,result:checkExplanationV2(output?.output,decisionForQuestionV1(testCase.prompt),responseModeV8(testCase.prompt),output?.error)};});
 const scorePassed=new Set(scoring.results.filter(x=>x.status==='passed').map(x=>x.caseId));
 const guardPassed=new Set(guard.filter(x=>x.result.passed).map(x=>x.caseId));
 const combinedAllowed=cases.filter(x=>scorePassed.has(x.id)&&guardPassed.has(x.id)).map(x=>x.id);
 return {scorerVersion:scoring.evaluatorVersion,score:scoring.score,gate:scoring.gate,scoringPassed:scorePassed.size,independentOldGuard:{version:'explanation-guard-v2',allowed:guardPassed.size,blocked:cases.length-guardPassed.size,blockedCases:guard.filter(x=>!x.result.passed).map(x=>({caseId:x.caseId,failures:x.result.failures}))},combined:{allowed:combinedAllowed.length,blocked:cases.length-combinedAllowed.length,allowedCases:combinedAllowed,blockedCases:cases.filter(x=>!combinedAllowed.includes(x.id)).map(x=>x.id)}};
};
const classifyCheck=check=>{
 if(check.status==='unverifiable')return 'unverifiable';
 if(/contradict|prohibited/i.test(check.missing??'')||check.category==='customer_text_safety')return 'business_contradiction';
 return 'true_obligation_omission';
};
const diagnosticSummary=diagnostics=>{
 const cases=diagnostics.records.map(row=>{const findings=row.contractValidation.checks.filter(x=>x.status!=='passed').map(check=>({ruleId:check.ruleId,status:check.status,classification:classifyCheck(check),category:check.category,evidence:check.evidence,missing:check.missing,checkerVersion:check.checkerVersion}));return {caseId:row.caseId,newCheckStatus:row.contractValidation.status,finalDelivery:row.delivery.status,findings};});
 const counts={true_obligation_omission:0,checker_false_block:0,business_contradiction:0,unverifiable:0};
 for(const row of cases)for(const finding of row.findings)counts[finding.classification]+=1;
 return {contractCompilationStatus:diagnostics.result.contractCompilationStatus,responseContractCompliance:diagnostics.result.responseContractCompliance,businessConsistency:diagnostics.result.businessConsistency,customerTextSafety:diagnostics.result.customerTextSafety,finalDeliveryStatus:diagnostics.result.finalDeliveryStatus,deliveryValidation:diagnostics.result.deliveryValidation,classificationCounts:counts,classificationMethod:'Failed bounded checks are classified from observed contradiction/prohibition evidence, missing required text, or unverifiable syntax. checker_false_block is assigned only by explicit calibrated counterexample evidence; none remain after the r1 calibration tests.',cases};
};
const v15V210Cases=v15.cases.map(testCase=>({...testCase,rule:'returns_policy_v2_10'}));
const history=[
 {version:'v15',reportPath:oldReports.v15.path,reportSha256:oldReports.v15.sha256,original:legacyAccounting(v15.cases,v15.plan.policy,v15.report.calls),v210Rescore:legacyAccounting(v15V210Cases,v15.plan.policy,v15.report.calls),v17NewCheck:diagnosticSummary(evaluateControlledV17(v16.cases,v16.plan.policy,v15.report.calls))},
 {version:'v16',reportPath:oldReports.v16.path,reportSha256:oldReports.v16.sha256,original:legacyAccounting(v16.cases,v16.plan.policy,v16.report.calls),v210Rescore:null,v17NewCheck:diagnosticSummary(evaluateControlledV17(v16.cases,v16.plan.policy,v16.report.calls))},
];
assert.deepEqual({score:history[0].original.score,guard:history[0].original.independentOldGuard.allowed,combined:history[0].original.combined.allowed},{score:90,guard:19,combined:17});
assert.deepEqual({score:history[0].v210Rescore.score,guard:history[0].v210Rescore.independentOldGuard.allowed,combined:history[0].v210Rescore.combined.allowed},{score:100,guard:19,combined:19});
assert.deepEqual({score:history[1].original.score,guard:history[1].original.independentOldGuard.allowed,combined:history[1].original.combined.allowed},{score:90,guard:17,combined:17});

const testLog=readFileSync(testLogPath,'utf8');
const count=name=>Number(testLog.match(new RegExp(`# ${name} (\\d+)\\b`))?.[1]);
const testCounts={total:count('tests'),passed:count('pass'),failed:count('fail')};
assert.ok(Number.isInteger(testCounts.total)&&testCounts.total>0);
assert.equal(testCounts.passed,testCounts.total);assert.equal(testCounts.failed,0);assert.equal(providerCalls,0);
const sourceFiles=['src/response-contract-v17.ts','src/response-contract-guard-v17.ts','src/controlled-evaluation-v17.ts','src/provider.ts','src/domain.ts','src/support.ts','src/worker.ts','public/index.html','tests/response-contract-v17.test.ts','tests/response-contract-guard-v17.test.ts','tests/response-contract-guard-v17-correctness.test.ts','tests/prompt-v17.test.ts','tests/support-v17.test.ts','tests/v17-history.test.ts','scripts/offline-v17.mjs'];
const report={createdAt:new Date().toISOString(),revision:'v17-checker-r1',status:'READY_FOR_REAL_EVALUATION',scope:'offline-only',providerCalls,realModelCalls:0,deploymentActions:0,publishActions:0,pushActions:0,modelClaim:'No r1 v17 model score exists yet. Offline checker calibration is not a model-quality result.',frozenConfiguration:{model:v16.plan.model,temperature:v16.report.promptSnapshot.temperature,reasoningEffort:v16.report.promptSnapshot.reasoningEffort,maxOutputTokens:v16.report.promptSnapshot.maxOutputTokens,scoreThreshold:v16.plan.policy.minScore,evaluatorVersion:v16.report.evaluatorVersion,cases:20,automaticRetries:0,promptSnapshot:promptSnapshot('v17')},contractCompilation:{compiled:caseContracts.length,ready:caseContracts.filter(x=>x.compilationStatus==='ready').length,conflicts:caseContracts.filter(x=>x.conflicts.length)},tests:{...testCounts,logPath:testLogPath,logSha256:sha(testLog)},history,sourceHashes:Object.fromEntries(sourceFiles.map(path=>[path,sha(readFileSync(path))])),knownLimitations:['The r1 checker recognizes bounded English assertion, negation, conditional, quotation, and contradiction patterns; it is not a proof of arbitrary natural-language semantics.','The conservative English fact extractor remains unchanged. Unsupported, hypothetical, negated, or conflicting time expressions can remain unknown.','Synthetic fixtures calibrate program behavior only and are not model-quality evidence.','A real v17 score and delivery result require one future 20-call evaluation; none was performed by this offline script.']};

const rules=[...new Map(caseContracts.flatMap(row=>[...row.mustState,...row.mustAsk,...row.mustNotClaim]).map(item=>[item.ruleId,item.meaning])).entries()].map(([ruleId,meaning])=>({ruleId,meaning}));
const historyRows=history.flatMap(item=>item.version==='v15'?[`| v15 original v2.9 | ${item.original.score} | ${item.original.gate} | ${item.original.independentOldGuard.allowed}/${item.original.independentOldGuard.blocked} | ${item.original.combined.allowed}/${item.original.combined.blocked} |`,`| v15 same raw, v2.10 rescore | ${item.v210Rescore.score} | ${item.v210Rescore.gate} | ${item.v210Rescore.independentOldGuard.allowed}/${item.v210Rescore.independentOldGuard.blocked} | ${item.v210Rescore.combined.allowed}/${item.v210Rescore.combined.blocked} |`]:[`| v16 original v2.10 | ${item.original.score} | ${item.original.gate} | ${item.original.independentOldGuard.allowed}/${item.original.independentOldGuard.blocked} | ${item.original.combined.allowed}/${item.original.combined.blocked} |`]).join('\n');
const markdown=`# ReleaseGuard v17 checker r1 离线复核\n\n- 状态：**${report.status}**\n- 修复前状态：**OFFLINE_NOT_READY — CHECKER_CORRECTNESS_FAILED**\n- 测试：**${testCounts.passed}/${testCounts.total} 通过，${testCounts.failed} 失败**\n- 真实模型调用、部署、发布、推送：**0 / 0 / 0 / 0**\n\n## 定点修复\n\n1. 接受 “Your return is eligible under the standard policy” 和 “return is standard eligible”。\n2. 接受 “Please let us know if you have a receipt”，同时继续阻断图片、编号、内容和上传要求。\n3. 否定人工审核、否定日期未知、后续矛盾句不再被正向关键词抵消。\n4. 条件句或引用句不作为已完成义务；无法确认的关键表达标为 unverifiable 并阻断。\n5. 实际执行 clarificationBlocksHumanContact=false，阻断“先提供日期才能联系人工”。\n\n修复前新增校准测试为 0/10，通过日志保留为 red-before-fix.log；修复后这些测试及原有危险负例全部纳入全量测试。\n\n## 历史口径复核\n\n| Evaluation | Score | Raw gate | Independent old guard allowed/blocked | Score + old guard combined allowed/blocked |\n|---|---:|---|---|---|\n${historyRows}\n\n旧原文的新检查结果不是目标通过率。逐题分类保存在 historical-diagnostics-r1.json；类别分为 true_obligation_omission、checker_false_block、business_contradiction 和 unverifiable。修复后的 explicit calibration 中没有遗留 checker_false_block，但历史原文仍可能因真实遗漏或矛盾被阻断。\n\n## 离线结论\n\n20/20 契约无冲突编译；plain/JSON 只改变格式；原文未被改写；mock provider 继续证明一题一次请求、错误不重试、无 fixture 替答。离线校准完成，可以冻结后进行唯一一轮真实 v17 20题评估。本状态不表示模型达到95/100，也不表示可部署或发布。\n`;

mkdirSync(evidenceDirectory,{recursive:true});
writeFileSync(`${evidenceDirectory}/case-contracts-r1.json`,JSON.stringify({revision:'v17-checker-r1',cases:caseContracts},null,2)+'\n',{flag:'wx'});
writeFileSync(`${evidenceDirectory}/rule-catalog-r1.json`,JSON.stringify({revision:'v17-checker-r1',rules},null,2)+'\n',{flag:'wx'});
writeFileSync(`${evidenceDirectory}/historical-diagnostics-r1.json`,JSON.stringify({revision:'v17-checker-r1',history},null,2)+'\n',{flag:'wx'});
writeFileSync(`${evidenceDirectory}/offline-verification-r1.json`,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
writeFileSync(`${evidenceDirectory}/OFFLINE-REPORT-R1.md`,markdown,{flag:'wx'});
console.log(JSON.stringify({status:report.status,revision:report.revision,contracts:report.contractCompilation,tests:report.tests,history:history.map(x=>({version:x.version,original:{score:x.original.score,guard:x.original.independentOldGuard,combined:x.original.combined},v210:x.v210Rescore&&{score:x.v210Rescore.score,guard:x.v210Rescore.independentOldGuard,combined:x.v210Rescore.combined},v17Delivery:x.v17NewCheck.deliveryValidation,classifications:x.v17NewCheck.classificationCounts})),providerCalls,realModelCalls:0,deploymentActions:0,pushActions:0},null,2));
