import test from 'node:test';
import assert from 'node:assert/strict';
import {decisionForQuestionV1} from '../src/returns-decision-v1.js';
import {compileResponseContractV17} from '../src/response-contract-v17.js';
import {compileGenerationViewV17R3,generationPromptV17R3,generationViewContextV17R3,generationViewCoverageV17R3} from '../src/generation-view-v17.js';

const make=(question:string,mode:'plain'|'json'='plain')=>{const decision=decisionForQuestionV1(question),contract=compileResponseContractV17(question,decision,mode);return {decision,contract,view:compileGenerationViewV17R3(decision,contract)};};

test('generation view excludes audit metadata and rule identifiers',()=>{
 const {decision,contract,view}=make('My item arrived damaged. What should I do?');
 const text=generationViewContextV17R3(decision,contract).text;
 for(const forbidden of ['mustState','mustAsk','mustNotClaim','appliesBecause','ruleId','AUTHORITATIVE RESPONSE CONTRACT'])assert.doesNotMatch(text,new RegExp(forbidden,'i'));
 assert.match(generationPromptV17R3,/one sentence may satisfy multiple compatible requirements/i);
 assert.equal(view.businessConclusion.requiresHumanReview,true);
 assert.ok(view.requiredExpressionOrder.some(x=>/damaged item/i.test(x)));
});

test('generation view keeps privacy conditional and does not invent a data policy',()=>{
 const ordinary=make('Can I return this?').view,privacy=make('Should I send my password and card number?').view;
 assert.equal(ordinary.requiredExpressionOrder.some(x=>/passwords/i.test(x)),false);
 assert.equal(privacy.requiredExpressionOrder.some(x=>/passwords/i.test(x)),true);
 assert.ok(privacy.applicableBoundaries.some(x=>/data storage or data sharing/i.test(x)));
});

test('every full-contract duty maps to one concise generation-view field',()=>{
 for(const question of ['Can I return this?','My item arrived damaged. What should I do?','The item is unused and I bought it 12 days ago. I have the receipt.']){
  const {contract}=make(question);const coverage=generationViewCoverageV17R3(contract);
  assert.ok(coverage.length>0);assert.deepEqual(coverage.filter(x=>!x.covered),[]);
 }
});

test('plain and JSON use the same business view and differ only by response mode',()=>{
 const plain=make('Can I return this?','plain').view,json=make('Can I return this?','json').view;
 assert.deepEqual({...plain,responseMode:'json'},json);
});

test('mustAsk duties are required clarifications and review does not replace them',()=>{
 const {view,contract}=make('My item arrived damaged. What should I do?');
 assert.ok(Array.isArray(view.requiredClarifications));
 assert.ok(view.requiredClarifications.some(x=>/purchase date/i.test(x)));
 assert.equal(view.requiredClarifications.length,contract.mustAsk.length);
 assert.ok(view.applicableBoundaries.some(x=>/must be asked|ask every/i.test(x)&&/human[- ]review/i.test(x)));
 assert.match(generationPromptV17R3,/every required clarification/i);
 assert.doesNotMatch(JSON.stringify(view),/permittedClarifications/);
});

test('bare intervals stay origin-neutral while supported damage intervals keep their meaning',()=>{
 const bare=make('Can I return something after 60 days?').view;
 const damaged=make('The product arrived cracked, but I only noticed after 45 days. Can I return it?').view;
 const bareLine=bare.requiredExpressionOrder.find(x=>/interval/i.test(x))??'';
 const damagedLine=damaged.requiredExpressionOrder.find(x=>/interval/i.test(x))??'';
 assert.match(bareLine,/mentioned interval/i);
 assert.doesNotMatch(bareLine,/delivery|discovery|arrival|damage/i);
 assert.match(damagedLine,/arrival|discover/i);
});
