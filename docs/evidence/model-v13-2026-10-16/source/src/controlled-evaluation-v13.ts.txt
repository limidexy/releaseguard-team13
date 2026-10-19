import { evaluate, type Case, type Output } from './domain.js';
import { decisionForQuestionV1 } from './returns-decision-v1.js';
import {checkExplanationV1} from './output-guard-v1.js';
import {responseModeV8} from './provider.js';
export function evaluateControlledV13(cases:Case[],policy:{minScore:number;maxLatencyMs:number|null},outputs:Output[]) {
  const rawModelEvaluation=evaluate(cases,policy,outputs);
  const records=cases.map(c=>{
    const output=outputs.find(o=>o.caseId===c.id),decision=decisionForQuestionV1(c.prompt);
    const validation=checkExplanationV1(output?.output,decision,responseModeV8(c.prompt),output?.error);
    const rawPassed=rawModelEvaluation.results.find(r=>r.caseId===c.id)?.status==='passed';
    return {caseId:c.id,decision,validation,delivery:{status:validation.passed&&rawPassed?'allowed':'blocked',customerOutput:validation.passed&&rawPassed?output?.output??null:null,rewritten:false}};
  });
  const blocked=records.filter(r=>r.delivery.status==='blocked').length;
  return {rawModelEvaluation,records,result:{...rawModelEvaluation,rawModelGate:rawModelEvaluation.gate,
    gate:rawModelEvaluation.gate==='passed'&&blocked===0?'passed':'blocked',
    deliveryValidation:{version:'explanation-guard-v1',allowed:records.length-blocked,blocked}}};
}
