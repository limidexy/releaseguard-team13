import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {decisionForQuestionV1} from '../src/returns-decision-v1.js';
import {compileResponseContractV17} from '../src/response-contract-v17.js';
import {responseModeV8} from '../src/provider.js';
import {evaluateResponseNextV1} from '../src/evaluator-next-v1.js';

type Fixture={fixtureId:string;caseId:string;responseMode:'plain'|'json';variantKind:string;response:string;expectedAllowed:boolean;expectedRuleFamilies:string[]};
const holdout=JSON.parse(fs.readFileSync('tests/evaluator-next-v1-holdout-fixtures.json','utf8')) as {fixtures:Fixture[]};
const plan=JSON.parse(fs.readFileSync('docs/evidence/model-v17-real-r1-2026-10-17/plan.json','utf8'));
const prompts=new Map<string,string>(plan.suites.flatMap((x:any)=>x.cases).map((x:any)=>[x.id,x.prompt]));

test('independently authored pre-freeze holdout matches final decisions and failure families',()=>{
 assert.equal(holdout.fixtures.length,80);const mismatches:string[]=[];
 for(const fixture of holdout.fixtures){const question=prompts.get(fixture.caseId);assert.ok(question,fixture.caseId);assert.equal(responseModeV8(question!),fixture.responseMode,fixture.fixtureId);
  const decision=decisionForQuestionV1(question!),contract=compileResponseContractV17(question!,decision,fixture.responseMode),result=evaluateResponseNextV1(fixture.response,contract,decision),actualAllowed=result.finalDeliveryStatus==='allowed',failed=result.checks.filter(x=>x.status!=='passed').map(x=>x.ruleId);
  if(actualAllowed!==fixture.expectedAllowed)mismatches.push(`${fixture.fixtureId}: expectedAllowed=${fixture.expectedAllowed}, actual=${actualAllowed}, failures=${failed}`);
  for(const expected of fixture.expectedRuleFamilies)if(!failed.includes(expected))mismatches.push(`${fixture.fixtureId}: missing reason ${expected}, actual=${failed}`);
 }
 assert.deepEqual(mismatches,[],'\n'+mismatches.join('\n'));
});
