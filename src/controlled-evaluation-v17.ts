import {evaluate,type Case,type Output} from './domain.js';
import {decisionForQuestionV1} from './returns-decision-v1.js';
import {checkExplanationV2} from './output-guard-v2.js';
import {responseModeV8} from './provider.js';
import {compileResponseContractV17} from './response-contract-v17.js';
import {checkResponseContractV17} from './response-contract-guard-v17.js';

export function evaluateControlledV17(cases:Case[],policy:{minScore:number;maxLatencyMs:number|null},outputs:Output[]){
 const rawModelEvaluation=evaluate(cases,policy,outputs);
 const records=cases.map(c=>{
  const output=outputs.find(o=>o.caseId===c.id),decision=decisionForQuestionV1(c.prompt),mode=responseModeV8(c.prompt);
  const responseContract=compileResponseContractV17(c.prompt,decision,mode);
  const legacyValidation=checkExplanationV2(output?.output,decision,mode,output?.error);
  const contractValidation=checkResponseContractV17(output?.output,responseContract,decision,output?.error);
  const rawPassed=rawModelEvaluation.results.find(r=>r.caseId===c.id)?.status==='passed';
  const allowed=Boolean(rawPassed&&legacyValidation.passed&&responseContract.compilationStatus==='ready'&&contractValidation.status==='passed');
  return {caseId:c.id,decision,responseContract,legacyValidation,contractValidation,
   delivery:{status:allowed?'allowed':'blocked',customerOutput:allowed?output?.output??null:null,rewritten:false}};
 });
 const blocked=records.filter(r=>r.delivery.status==='blocked').length;
 const dimensions=(key:'responseContractCompliance'|'businessConsistency'|'customerTextSafety')=>{
  const failed=records.filter(r=>r.contractValidation[key].status!=='passed');
  return {status:failed.length?'blocked':'passed',passed:records.length-failed.length,blocked:failed.length,
   cases:failed.map(r=>({caseId:r.caseId,ruleIds:r.contractValidation[key].ruleIds}))};
 };
 const conflicts=records.filter(r=>r.responseContract.compilationStatus!=='ready');
 const contractCompilationStatus={status:conflicts.length?'CONTRACT_CONFLICT':'ready',ready:records.length-conflicts.length,conflicts:conflicts.map(r=>({caseId:r.caseId,conflicts:r.responseContract.conflicts}))};
 const responseContractCompliance=dimensions('responseContractCompliance'),businessConsistency=dimensions('businessConsistency'),customerTextSafety=dimensions('customerTextSafety');
 const finalDeliveryStatus=rawModelEvaluation.gate==='passed'&&blocked===0?'allowed':'blocked';
 return {rawModelEvaluation,records,result:{...rawModelEvaluation,rawModelScore:rawModelEvaluation.score,rawModelGate:rawModelEvaluation.gate,
  contractCompilationStatus,responseContractCompliance,businessConsistency,customerTextSafety,finalDeliveryStatus,
  gate:finalDeliveryStatus==='allowed'?'passed':'blocked',deliveryValidation:{versions:['explanation-guard-v2','response-contract-guard-v17'],allowed:records.length-blocked,blocked}}};
}
