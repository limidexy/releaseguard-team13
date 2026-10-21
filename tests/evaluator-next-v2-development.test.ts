import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {decisionForQuestionV1} from '../src/returns-decision-v1.js';
import {compileResponseContractV17} from '../src/response-contract-v17.js';
import {evaluateResponseNextV2} from '../src/evaluator-next-v2.js';

type Fixture={fixtureId:string;caseId:string;responseMode:'plain'|'json';response:string;expectedAllowed:boolean;expectedRuleFamilies:string[]};
const plan=JSON.parse(fs.readFileSync('docs/evidence/model-v17-real-r1-2026-10-17/plan.json','utf8'));
const prompts=new Map<string,string>(plan.suites.flatMap((x:any)=>x.cases).map((x:any)=>[x.id,x.prompt]));
// Both old fixture sets are development data for v2. Neither is its holdout.
for(const file of ['tests/evaluator-next-v1-holdout-fixtures.json','tests/evaluator-next-v1-holdout-v2-fixtures.json']){
 const fixtures=JSON.parse(fs.readFileSync(file,'utf8')).fixtures as Fixture[];
 for(const fixture of fixtures)test('v2 development: '+fixture.fixtureId,()=>{
  const question=prompts.get(fixture.caseId);assert.ok(question);
  const decision=decisionForQuestionV1(question),contract=compileResponseContractV17(question,decision,fixture.responseMode);
  const result=evaluateResponseNextV2(fixture.response,contract,decision),failed=result.checks.filter(x=>x.status!=='passed').map(x=>x.ruleId);
  assert.equal(result.finalDeliveryStatus==='allowed',fixture.expectedAllowed,failed.join(','));
  for(const id of fixture.expectedRuleFamilies)assert.ok(failed.includes(id),'Missing expected reason '+id+': '+failed.join(','));
  assert.equal(result.delivery.customerOutput,fixture.expectedAllowed?fixture.response:null);
 });
}
