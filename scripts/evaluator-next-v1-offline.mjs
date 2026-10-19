import fs from 'node:fs';
import crypto from 'node:crypto';
import {evaluateControlledV17} from '../dist/src/controlled-evaluation-v17.js';
import {decisionForQuestionV1} from '../dist/src/returns-decision-v1.js';
import {compileResponseContractV17} from '../dist/src/response-contract-v17.js';
import {responseModeV8} from '../dist/src/provider.js';
import {evaluateResponseNextV1} from '../dist/src/evaluator-next-v1.js';

const root=new URL('../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root),'utf8'),sha=p=>crypto.createHash('sha256').update(fs.readFileSync(new URL(p,root))).digest('hex');
const evidence='docs/evidence/evaluator-next-v1-2026-10-17/';
const r4Path='docs/evidence/model-v17-ab-r4-2026-10-17/ab-real-v17-r4-final.json';
const expectedR4='de31624111012d425ccb789e1fdd1a3d500a0916615ec4c3e4b51a404f259587';
if(sha(r4Path)!==expectedR4)throw new Error('Frozen r4 evidence hash mismatch');
const r4=JSON.parse(read(r4Path)),plan=JSON.parse(read('docs/evidence/model-v17-real-r1-2026-10-17/plan.json'));
const cases=plan.suites.flatMap(x=>x.cases),byCase=new Map(cases.map(x=>[x.id,x]));

const modelIssues={
 'B/eligibility':['presupposes unused status by asking for confirmation rather than asking whether it is unused'],
 'A/damaged':['generic policy overstates standard eligibility as return/refund eligibility'],
 'B/damaged':['asks for a receipt rather than receipt availability','implies an active ongoing review process'],
 'A/expired':['omits the required explanation that the unanchored 60-day interval is not purchase age'],
 'B/expired':['changes the customer-mentioned 60-day interval to 30 days'],
 'A/action':['generic policy overstates standard eligibility as refundable'],
 'B/action':['overstates refund eligibility','promises a support agent will follow up','does not direct the customer to initiate human contact'],
 'B/format':['asserts an unsupported organizational practice about requesting personal data'],
 'A/greeting':['asks the customer to confirm unused status rather than asking whether it is unused'],
 'A/extra-eligibility':['invents a customer-support initiation process'],
 'B/extra-eligibility':['invents store and online-portal return processes'],
 'A/extra-receipt':['omits the required purchase-date question'],
 'B/extra-receipt':['omits the required purchase-date question'],
 'B/extra-damaged':['overstates standard policy as standard refund eligibility'],
 'A/extra-expired':['exposes internal enum OUTSIDE_STANDARD_WINDOW'],
 'B/extra-expired':['exposes internal enum OUTSIDE_STANDARD_WINDOW','overstates policy as refund allowance'],
 'A/extra-privacy':['overstates policy as return/refund eligibility'],
 'A/extra-action':['overstates refund eligibility','requests receipt information rather than receipt availability'],
 'B/extra-action':['overstates refund eligibility','does not tell the customer to contact a human','implies an active ongoing review process'],
 'B/extra-missing':['presupposes unused status by asking for confirmation'],
 'A/extra-escalation':['overstates standard eligibility as refund eligibility'],
 'A/extra-format':['omits a case-specific within-window conclusion','omits an explicit standard-eligibility conclusion','asserts unsupported data handling','invents a support initiation process'],
 'B/extra-format':['invents a store return process'],
 'A/extra-greeting':['presupposes unused status by asking for confirmation'],
};
const semanticAllowed=new Set([
 'A/eligibility','A/receipt','B/receipt','A/privacy','B/privacy','A/missing','B/missing','A/escalation','A/format','B/greeting','A/extra-damaged','A/extra-missing','B/extra-privacy','B/extra-escalation','B/extra-greeting'
]);
const candidateKnownGaps={
 'A/damaged':['refund-entitlement wording is outside the current approval/execution detector'],
 'B/expired':['numeric fidelity between customer interval and answer interval is not implemented'],
 'A/action':['refund-entitlement wording is outside the current approval/execution detector'],
 'A/greeting':['presupposition versus open question remains a bounded pattern decision'],
 'B/extra-damaged':['refund-entitlement wording is outside the current approval/execution detector'],
 'A/extra-privacy':['refund-entitlement wording is outside the current approval/execution detector'],
 'B/extra-missing':['presupposition versus open question remains a bounded pattern decision'],
 'A/extra-escalation':['refund-entitlement wording is outside the current approval/execution detector'],
 'A/extra-greeting':['presupposition versus open question remains a bounded pattern decision'],
};
const ambiguity={
 'A/damaged':['generic “eligible for a return or refund” sits between policy description and customer entitlement; this project treats it as unsupported entitlement'],
 'A/action':['generic “can be refunded” is treated as unsupported entitlement, not an execution claim'],
 'B/extra-damaged':['“eligible for a standard refund” is treated as unsupported entitlement'],
 'A/extra-privacy':['“eligible for a return or refund” is treated as unsupported entitlement'],
 'A/extra-escalation':['“eligible for a refund” is treated as unsupported entitlement'],
};

const arms=[];const diagnostics=[];
for(const arm of ['A','B']){
 const calls=r4.calls.filter(x=>x.arm===arm),outputs=calls.map(x=>({caseId:x.caseId,output:x.output,latencyMs:x.latencyMs}));
 const historical=evaluateControlledV17(cases,{minScore:95,maxLatencyMs:null},outputs);
 const oldAllowed=historical.records.filter(x=>x.delivery.status==='allowed').length;
 const expectedScore=arm==='A'?70:75,expectedAllowed=arm==='A'?5:1;
 if(historical.rawModelEvaluation.score!==expectedScore||oldAllowed!==expectedAllowed)throw new Error(`Historical reproduction mismatch for ${arm}: ${historical.rawModelEvaluation.score}, ${oldAllowed}`);
 let candidateAllowed=0,referenceAgreements=0,falseAllows=0,falseBlocks=0;
 for(const call of calls){const c=byCase.get(call.caseId);if(!c)throw new Error('Unknown case '+call.caseId);const decision=decisionForQuestionV1(c.prompt),mode=responseModeV8(c.prompt),contract=compileResponseContractV17(c.prompt,decision,mode),candidate=evaluateResponseNextV1(call.output,contract,decision);if(candidate.finalDeliveryStatus==='allowed')candidateAllowed++;
  const key=`${arm}/${call.caseId}`,referenceAllowed=semanticAllowed.has(key),candidateReferenceAgreement=(candidate.finalDeliveryStatus==='allowed')===referenceAllowed;if(candidateReferenceAgreement)referenceAgreements++;else if(candidate.finalDeliveryStatus==='allowed')falseAllows++;else falseBlocks++;
  const legacyFailures=historical.records.find(x=>x.caseId===call.caseId);
  diagnostics.push({arm,model:call.model,caseId:call.caseId,question:c.prompt,rawAnswer:call.output,rawV210:r4.results.find(x=>x.arm===arm)?.perCase.find(x=>x.caseId===call.caseId)?.rawV210,legacyOldGuard:legacyFailures?.legacyValidation,legacyContractGuard:legacyFailures?.contractValidation,legacyFinalDelivery:legacyFailures?.delivery.status,
   semanticReference:{source:'project semantic reference annotation from frozen evaluation-spec-next-v1; not a verified human-review record',expectedDelivery:referenceAllowed?'allowed':'blocked',modelIssues:modelIssues[key]??[],policyAmbiguity:ambiguity[key]??[]},
   candidate:{finalDelivery:candidate.finalDeliveryStatus,checks:candidate.checks,agreementWithSemanticReference:candidateReferenceAgreement,knownSupportGap:candidateKnownGaps[key]??[],classification:candidateReferenceAgreement?'agreement':candidate.finalDeliveryStatus==='allowed'?'checker_false_allow':'checker_false_block'},
   provenance:{postHoc:true,newProviderCall:false,rawAnswerModified:false}});
 }
 arms.push({arm,model:calls[0]?.model,historical:{rawV210Score:historical.rawModelEvaluation.score,rawV210Gate:historical.rawModelEvaluation.gate,legacyFinalAllowed:oldAllowed,legacyFinalBlocked:20-oldAllowed},candidatePostHoc:{allowed:candidateAllowed,blocked:20-candidateAllowed,semanticReferenceAgreements:referenceAgreements,falseAllows,falseBlocks},fixedDenominator:20});
}
const report={version:'evaluator-next-v1-offline-report',generatedAt:new Date().toISOString(),status:'PENDING_HOLDOUT',constraints:{providerInferenceCalls:0,judgeModelCalls:0,deployment:false,publication:false,gitPush:false,answersModified:false},frozenEvidence:{r4Path,r4Sha256:sha(r4Path),expectedR4Sha256:expectedR4},arms,diagnosticCount:diagnostics.length,notes:['Candidate results are post-hoc diagnostics on unchanged r4 outputs, not a new model run.','A higher candidate allow count is not a model-quality improvement.','Semantic reference annotations are project labels, not a verified independent human-review record.']};
fs.writeFileSync(new URL(evidence+'R4-POSTHOC-DIAGNOSTICS-v1.json',root),JSON.stringify({version:'r4-posthoc-diagnostics-v1',diagnostics},null,2)+'\n');
fs.writeFileSync(new URL(evidence+'OFFLINE-REPORT-v1.json',root),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
