import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {evaluateControlledV17} from '../dist/src/controlled-evaluation-v17.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const sourceDir=resolve(root,'docs/evidence/model-v17-real-r1-2026-10-17');
const outputDir=resolve(root,'docs/evidence/model-v17-postrun-r2-2026-10-17');
const reportFile=resolve(sourceDir,'real-v17-2026-10-16T16-13-54.926Z.json');
const planFile=resolve(sourceDir,'plan.json');
const verificationFile=resolve(sourceDir,'real-v17-2026-10-16T16-13-54.926Z-verification-r2.json');
const offlineFile=resolve(root,'docs/evidence/model-v17-checker-r1-2026-10-17/offline-verification-r1.json');
const sha=value=>createHash('sha256').update(value).digest('hex');
const [reportRaw,planRaw,verificationRaw,offlineRaw]=await Promise.all([reportFile,planFile,verificationFile,offlineFile].map(path=>readFile(path)));
const report=JSON.parse(reportRaw),plan=JSON.parse(planRaw),verification=JSON.parse(verificationRaw),offline=JSON.parse(offlineRaw);
assert.equal(sha(reportRaw),'f88629b8512d5280095d6a04bbeb797f36ca15e5f966696bec360b289c99de7c');
assert.equal(sha(planRaw),'c4eaeccf0e95e11ac1c1780c031e1bd8eca95d5f17c47fe23a4a3d8bf59fea6a');
assert.equal(verification.failed,0);
assert.equal(report.calls.length,20);
assert.equal(report.automaticRetries,0);
assert.deepEqual(report.calls.map(call=>call.caseId),plan.questionOrder);

const cases=plan.suites.flatMap(suite=>suite.cases);
const current=evaluateControlledV17(cases,plan.policy,report.calls);
assert.deepEqual(current.rawModelEvaluation,report.overall);
for(const row of current.records){
 const call=report.calls.find(item=>item.caseId===row.caseId);
 assert.equal(row.delivery.rewritten,false);
 if(row.delivery.status==='blocked')assert.equal(row.delivery.customerOutput,null);
 else assert.equal(row.delivery.customerOutput,call.output);
}

const attribution={
 eligibility:['model_actual_omission: purchase timing is not explicitly stated as unknown','model_actual_violation: proof of purchase is introduced beyond receipt availability'],
 receipt:['legacy_scorer_false_block: labelled policy text was treated as receipt-material collection','model_actual_omission: unknown purchase timing, deterministic ineligibility, receipt-condition failure, and required human review are not all stated'],
 damaged:['model_actual_omission: standard eligibility is not explicitly stated as undetermined'],
 expired:['model_actual_omission: the mentioned 60-day interval is not explicitly separated from purchase age'],
 privacy:['legacy_scorer_false_block: safe non-sensitive clarification was rejected','model_actual_omission: purchase timing is not explicitly stated as unknown'],
 action:['model_actual_omission: purchase timing, human-review requirement, full capability limitation, and explicit purchase-date question are incomplete'],
 missing:['legacy_old_gate_false_block: the calibrated v17 checker passes the unchanged raw answer'],
 escalation:['model_actual_omission: forwarding limitation and explicit purchase-date question are absent'],
 format:['legacy_old_gate_false_block: the calibrated v17 checker passes the unchanged JSON'],
 greeting:['legacy_scorer_false_block: substantive return help was marked missing','model_actual_omission: purchase timing is not explicitly stated as unknown'],
 'extra-eligibility':['legacy_scorer_and_old_gate_false_block: a negated refund-approval statement was treated as an approval/action claim','calibrated_v17_checker: passes unchanged raw answer'],
 'extra-receipt':['business_contradiction: missing receipt is described as unconfirmed eligibility instead of deterministic standard ineligibility','model_actual_omission: receipt-condition failure and purchase-date question are absent','model_actual_violation: claims the case will be sent for review despite no external action capability'],
 'extra-damaged':['legacy_scorer_false_block: privacy wording was treated as a damage deadline','model_actual_omission: 45-day observation interval is not explicitly separated from purchase age and standard eligibility remains unstated'],
 'extra-expired':['model_actual_omission: required human review is not stated'],
 'extra-privacy':['model_actual_omission: purchase timing and standard eligibility are not explicitly stated as unknown'],
 'extra-action':['model_actual_omission: forwarding limitation and explicit purchase-date question are absent'],
 'extra-missing':['legacy_old_gate_false_block: the calibrated v17 checker passes the unchanged raw answer'],
 'extra-escalation':['model_actual_omission: forwarding limitation and explicit purchase-date question are absent'],
 'extra-format':['passed: raw score, old gate, v17 contract checks, and final delivery all pass'],
 'extra-greeting':['legacy_scorer_and_old_gate_false_block: substantive return help and grounded uncertainty were rejected','calibrated_v17_checker: passes unchanged raw answer'],
};

const records=current.records.map(row=>{
 const testCase=cases.find(item=>item.id===row.caseId);
 const call=report.calls.find(item=>item.caseId===row.caseId);
 const rawScore=report.overall.results.find(item=>item.caseId===row.caseId);
 const oldGate=report.independentOldGuard.records.find(item=>item.caseId===row.caseId);
 const frozen=report.controlled.records.find(item=>item.caseId===row.caseId);
 const contractFailures=row.contractValidation.checks.filter(check=>check.status!=='passed').map(check=>({ruleId:check.ruleId,status:check.status,category:check.category,evidence:check.evidence,missing:check.missing}));
 const correctedFalseBlocks=frozen.contractValidation.checks.filter(check=>check.status!=='passed'&&!contractFailures.some(currentFailure=>currentFailure.ruleId===check.ruleId)).map(check=>check.ruleId);
 return {
  caseId:row.caseId,
  customerQuestion:testCase.prompt,
  deterministicDecision:row.decision,
  applicableContract:row.responseContract,
  rawModelAnswer:call.output,
  provider:{httpStatus:call.metadata?.httpStatus,finishReason:call.metadata?.finishReason,requestId:call.metadata?.requestId,latencyMs:call.latencyMs,error:call.error??null},
  originalScoring:{version:report.evaluatorVersion,status:rawScore.status,reason:rawScore.reason,failedChecks:rawScore.checks.filter(check=>!check.passed).map(check=>check.id)},
  independentOldGate:{version:report.independentOldGuard.version,allowed:oldGate.validation.passed,failures:oldGate.validation.failures},
  originalScorePlusOldGateAllowed:report.rawPlusOldGuard.allowedCases.includes(row.caseId),
  frozenV17R1:{status:frozen.contractValidation.status,failedRules:frozen.contractValidation.checks.filter(check=>check.status!=='passed').map(check=>check.ruleId),finalDelivery:frozen.delivery.status},
  postrunV17R2:{status:row.contractValidation.status,failedRules:contractFailures,correctedFalseBlocks,finalDelivery:row.delivery.status},
  finalAllowed:row.delivery.status==='allowed',
  failureAttribution:attribution[row.caseId],
 };
});

const replay={
 createdAt:new Date().toISOString(),
 revision:'v17-checker-r2-postrun-offline-replay',
 status:'REAL_EVALUATION_COMPLETED_WITH_FAILURES',
 claim:'The requested A-F defects and additional observed checker false blocks are regression-tested. The one authorized real run did not meet the unchanged score and delivery gates.',
 realRun:{reportPath:reportFile,reportSha256:sha(reportRaw),planSha256:sha(planRaw),journalSha256:report.journalSha256,totalCalls:20,automaticRetries:0,providerFailures:report.providerFailures,rawScore:report.overall.score,rawGate:report.overall.gate,independentOldGate:{allowed:report.independentOldGuard.allowed,blocked:report.independentOldGuard.blocked},rawPlusOldGate:{allowed:report.rawPlusOldGuard.allowed,blocked:report.rawPlusOldGuard.blocked},frozenV17R1:{allowed:report.controlled.result.deliveryValidation.allowed,blocked:report.controlled.result.deliveryValidation.blocked}},
 postrunOfflineReplay:{providerCalls:0,answersModified:0,tests:{passed:713,failed:0,total:713},checkerSourceSha256:sha(await readFile(resolve(root,'src/response-contract-guard-v17.ts'))),checkerBuildSha256:sha(await readFile(resolve(root,'dist/src/response-contract-guard-v17.js'))),responseContractCompliance:current.result.responseContractCompliance,customerTextSafety:current.result.customerTextSafety,deliveryValidation:current.result.deliveryValidation,finalDeliveryStatus:current.result.finalDeliveryStatus},
 historicalAccounting:offline.history.map(item=>({version:item.version,original:item.original,v210Rescore:item.v210Rescore})),
 fixed20Verified:false,
 limitations:['Same 20 development regression questions, not a held-out benchmark.','The post-run r2 result is an offline replay of unchanged raw answers, not another provider evaluation.','The unchanged v2.10 scorer and old gate still produce false blocks on several semantically compliant answers.','No hidden-set stability or production-release claim.','No deployment, publication, or Git push occurred.'],
 records,
};
await mkdir(outputDir,{recursive:true});
const jsonFile=resolve(outputDir,'postrun-offline-replay-r2-final.json');
await writeFile(jsonFile,JSON.stringify(replay,null,2)+'\n',{flag:'wx'});

const historyLines=replay.historicalAccounting.map(item=>item.v210Rescore
 ?`- ${item.version}: original score ${item.original.score}, independent old gate ${item.original.independentOldGuard.allowed}/20, combined ${item.original.combined.allowed}/20; v2.10 rescore ${item.v210Rescore.score}, independent old gate ${item.v210Rescore.independentOldGuard.allowed}/20, combined ${item.v210Rescore.combined.allowed}/20.`
 :`- ${item.version}: original score ${item.original.score}, independent old gate ${item.original.independentOldGuard.allowed}/20, combined ${item.original.combined.allowed}/20; original scorer is already v2.10, so no separate rescore is reported.`).join('\n');
const caseSections=records.map(record=>{
 const mustState=record.applicableContract.mustState.map(item=>item.ruleId).join(', ')||'none';
 const mustAsk=record.applicableContract.mustAsk.map(item=>item.ruleId).join(', ')||'none';
 const mustNot=record.applicableContract.mustNotClaim.map(item=>item.ruleId).join(', ')||'none';
 const rawFailed=record.originalScoring.failedChecks.join(', ')||'none';
 const oldFailed=record.independentOldGate.failures.join(', ')||'none';
 const v17Failed=record.postrunV17R2.failedRules.map(item=>item.ruleId).join(', ')||'none';
 const corrected=record.postrunV17R2.correctedFalseBlocks.join(', ')||'none';
 return `## ${record.caseId}\n\n- Customer question: ${record.customerQuestion}\n- Deterministic decision: standardEligibility=${record.deterministicDecision.standardEligibility}; disposition=${record.deterministicDecision.disposition}; requiresHumanReview=${record.deterministicDecision.requiresHumanReview}; customer action=${record.applicableContract.customerAction}.\n- Applicable contract: mustState=[${mustState}]; mustAsk=[${mustAsk}]; mustNotClaim=[${mustNot}].\n- Original v2.10 score: ${record.originalScoring.status}; failed checks=[${rawFailed}].\n- Independent old gate: ${record.independentOldGate.allowed?'allowed':'blocked'}; failures=[${oldFailed}].\n- Original score + old gate: ${record.originalScorePlusOldGateAllowed?'allowed':'blocked'}.\n- Frozen real-run v17 r1: ${record.frozenV17R1.status}; failed=[${record.frozenV17R1.failedRules.join(', ')||'none'}].\n- Post-run v17 r2 offline replay: ${record.postrunV17R2.status}; failed=[${v17Failed}]; corrected r1 false blocks=[${corrected}].\n- Final delivery: ${record.finalAllowed?'ALLOWED':'BLOCKED'}; blocked output remains null.\n- Attribution: ${record.failureAttribution.join('; ')}.\n\nRaw model answer (unchanged):\n\n\`\`\`text\n${record.rawModelAnswer}\n\`\`\`\n`;
}).join('\n');
const markdown=`# ReleaseGuard v17 real evaluation and post-run checker review\n\n## Final answer\n\n**Actual status: REAL_EVALUATION_COMPLETED_WITH_FAILURES.** The requested checker defects were fixed and the full offline suite passes, but the single authorized real run scored **${report.overall.score}/100** against the unchanged v2.10 scorer (threshold ${plan.policy.minScore}) and did not satisfy all delivery conditions. Therefore the project must not claim \"fixed 20-case verification\" or production readiness.\n\n## Integrity\n\n- Real provider calls: 20 exactly; automatic retries: 0; provider failures: ${report.providerFailures.length}.\n- Model: ${report.model}; temperature ${plan.configuration.temperature}; reasoning effort ${plan.configuration.reasoningEffort}; max output tokens ${plan.configuration.maxOutputTokens}.\n- Plan SHA-256: ${sha(planRaw)}.\n- Real report SHA-256: ${sha(reportRaw)}.\n- Raw answers modified after the run: 0.\n- Post-run checker replay provider calls: 0.\n- No deployment, publication, or Git push.\n\n## Separated outcome accounting\n\n- Original v2.10 scoring: ${report.overall.passed}/20 passed, score ${report.overall.score}, gate ${report.overall.gate}.\n- Independent old gate: ${report.independentOldGuard.allowed}/20 allowed.\n- Original score + old gate intersection: ${report.rawPlusOldGuard.allowed}/20 allowed.\n- Frozen v17 r1 at invocation: ${report.controlled.result.deliveryValidation.allowed}/20 final-delivery allowed.\n- Calibrated v17 r2 on the **same unchanged raw answers**: ${current.result.responseContractCompliance.passed}/20 contract-compliant; ${current.result.customerTextSafety.passed}/20 text-safe; ${current.result.deliveryValidation.allowed}/20 final-delivery allowed after the unchanged old gate.\n- Full offline tests after post-run checker calibration: 713/713 passed.\n\nThe r2 replay corrects checker false blocks but does not change the frozen real score, old gate, raw answers, or provider evidence. It is not a second real evaluation.\n\n## Historical accounting reproduced\n\n${historyLines}\n\n## Key cases\n\n- damaged: raw score and old gate passed, but v17 correctly blocks because the answer never explicitly states that standard eligibility is undetermined.\n- extra-damaged: legacy deadline false block was corrected; v17 still blocks real omissions about the 45-day observation interval and undetermined standard eligibility.\n- extra-receipt: remains blocked for a real contradiction/omission and the unsupported statement that the case \"will be sent\" for review.\n- extra-format: the only case allowed by the full unchanged chain after r2 calibration.\n\n${caseSections}\n## Conclusion\n\nThe checker defects are demonstrably repaired by red/green regression evidence and 713/713 offline tests. The model/pipeline outcome is **not** repaired to the required acceptance level: the only authorized real run remains 70/100, the unchanged old gate plus calibrated v17 chain allows 1/20, and several answers omit explicit contract duties. No second provider run was made.\n`;
const markdownFile=resolve(outputDir,'FINAL-REPORT-R2.md');
await writeFile(markdownFile,markdown,{flag:'wx'});
console.log(JSON.stringify({jsonFile,markdownFile,status:replay.status,realCalls:20,replayCalls:0,rawScore:report.overall.score,oldGateAllowed:report.independentOldGuard.allowed,rawPlusOldGateAllowed:report.rawPlusOldGuard.allowed,frozenR1Allowed:report.controlled.result.deliveryValidation.allowed,r2ContractPassed:current.result.responseContractCompliance.passed,r2SafetyPassed:current.result.customerTextSafety.passed,r2FinalAllowed:current.result.deliveryValidation.allowed,tests:replay.postrunOfflineReplay.tests}));
